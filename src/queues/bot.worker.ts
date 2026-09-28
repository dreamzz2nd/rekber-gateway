import { Worker, Job } from 'bullmq';
import { BOT_QUEUE_NAME } from '../services/queue.service.js';
import { redisConfig } from '../config/redis.js';
import { logger } from '../utils/logger.js';
import { whatsappService } from '../services/whatsapp.service.js';
import { transactionService } from '../services/transaction.service.js';
import { paymentService } from '../services/payment.service.js';
import { payoutService } from '../services/payout.service.js';
import { prisma } from '../config/database.js';

export function startBotWorker() {
  const worker = new Worker(
    BOT_QUEUE_NAME,
    async (job: Job) => {
      logger.info({ jobName: job.name, jobId: job.id, data: job.data }, 'Processing bot queue job');

      switch (job.name) {
        case 'create-escrow-group': {
          const { transactionId, shortCode, buyerPhone, sellerPhone, title, totalAmount } = job.data;

          const groupResult = await whatsappService.createEscrowGroup({
            transactionId,
            shortCode,
            buyerPhone,
            sellerPhone,
            title,
            totalAmount,
          });

          // Save group details & update state
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
          const { transactionId } = job.data;
          const trx = await prisma.transaction.findUnique({
            where: { id: transactionId },
          });

          if (!trx || !trx.waGroupId) return;

          // Generate Invoice
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
          const { transactionId, actorPhone } = job.data;
          await payoutService.disburseSellerFunds(transactionId, actorPhone);
          break;
        }

        default:
          logger.warn({ jobName: job.name }, 'Unknown job name in bot queue');
      }
    },
    {
      connection: redisConfig,
      concurrency: 5,
    }
  );

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id, jobName: job.name }, 'Job completed successfully');
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, jobName: job?.name, error: err.message }, 'Job failed');
  });

  return worker;
}
