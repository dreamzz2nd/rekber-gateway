import { Queue } from 'bullmq';
import { redisConfig, redis } from '../config/redis.js';
import { logger } from '../utils/logger.js';
import { whatsappService } from './whatsapp.service.js';
import { transactionService } from './transaction.service.js';
import { paymentService } from './payment.service.js';
import { payoutService } from './payout.service.js';
import { prisma } from '../config/database.js';

export const BOT_QUEUE_NAME = 'rekber-bot-queue';

let isRedisAvailable = false;

redis.on('connect', () => {
  isRedisAvailable = true;
});

// Direct in-process job processor for standalone mode
export async function executeBotJob(jobName: string, data: any) {
  logger.info({ jobName, data }, 'Executing bot task');

  switch (jobName) {
    case 'create-escrow-group': {
      const { transactionId, shortCode, buyerPhone, sellerPhone, title, totalAmount } = data;

      const groupResult = await whatsappService.createEscrowGroup({
        transactionId,
        shortCode,
        buyerPhone,
        sellerPhone,
        title,
        totalAmount,
      });

      await prisma.transaction.update({
        where: { id: transactionId },
        data: {
          waGroupId: groupResult.groupId,
          waGroupInviteLink: groupResult.inviteLink,
        },
      });

      await transactionService.transitionStatus(transactionId, 'GROUP_CREATED', {
        actor: 'BOT_WORKER',
        action: 'WHATSAPP_GROUP_CREATED',
        metadata: { groupId: groupResult.groupId, inviteLink: groupResult.inviteLink },
      });
      break;
    }

    case 'send-payment-invoice': {
      const { transactionId } = data;
      const trx = await prisma.transaction.findUnique({
        where: { id: transactionId },
      });

      if (!trx || !trx.waGroupId) return;

      const invoice = await paymentService.createPaymentInvoice(transactionId);

      await transactionService.transitionStatus(transactionId, 'WAITING_PAYMENT', {
        actor: 'BOT_WORKER',
        action: 'INVOICE_ISSUED',
        metadata: { paymentId: invoice.paymentId },
      });

      const invoiceMessage =
        `🧾 *TAGIHAN PEMBAYARAN REKBER (INVOICE)*\n\n` +
        `• ID Tagihan: *${invoice.paymentId}*\n` +
        `• Total Transfer: *Rp ${Number(trx.totalAmount).toLocaleString('id-ID')}*\n` +
        `• Pembeli: @${trx.buyerPhone}\n` +
        `• Penjual: @${trx.sellerPhone}\n\n` +
        `💳 *Instruksi Pembayaran:*\n` +
        `Silakan selesaikan pembayaran via QRIS / VA pada link resmi berikut:\n` +
        `👉 ${invoice.paymentUrl}\n\n` +
        `⏳ *Status Chat:* Chat grup masih dikunci hingga dana berhasil diamankan di rekening escrow.`;

      await whatsappService.sendGroupMessage(trx.waGroupId, invoiceMessage);
      break;
    }

    case 'process-payout': {
      const { transactionId, actorPhone } = data;
      await payoutService.disburseSellerFunds(transactionId, actorPhone);
      break;
    }
  }
}

// Queue abstraction with automatic in-process fallback
export const botQueue = {
  add: async (name: string, data: any) => {
    if (isRedisAvailable) {
      try {
        const q = new Queue(BOT_QUEUE_NAME, { connection: redisConfig });
        return await q.add(name, data);
      } catch {
        // Fallback to direct execution
      }
    }
    // Asynchronous in-process dispatch
    setImmediate(() => {
      executeBotJob(name, data).catch((err) => {
        logger.error({ err }, 'Error in fallback job execution');
      });
    });
    return { id: `local-${Date.now()}` };
  },
};
