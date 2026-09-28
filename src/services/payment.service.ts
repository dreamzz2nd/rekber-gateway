import axios from 'axios';
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { transactionService } from './transaction.service.js';
import { whatsappService } from './whatsapp.service.js';

export class PaymentService {
  /**
   * Create Invoice / QRIS for a Transaction
   */
  async createPaymentInvoice(transactionId: string): Promise<{
    paymentId: string;
    qrString?: string;
    vaNumber?: string;
    paymentUrl: string;
  }> {
    const trx = await prisma.transaction.findUnique({
      where: { id: transactionId },
    });

    if (!trx) throw new Error('Transaction not found');

    const paymentId = `INV-${trx.shortCode}-${Date.now()}`;
    const amount = Number(trx.totalAmount);

    // If using live Midtrans or mock
    if (env.PAYMENT_GATEWAY_PROVIDER === 'midtrans' && env.PAYMENT_SERVER_KEY !== 'SB-Mid-server-demo') {
      try {
        const authHeader = Buffer.from(`${env.PAYMENT_SERVER_KEY}:`).toString('base64');
        const res = await axios.post(
          'https://api.sandbox.midtrans.com/v2/charge',
          {
            payment_type: 'qris',
            transaction_details: {
              order_id: paymentId,
              gross_amount: amount,
            },
            qris: {
              acquirer: 'gopay',
            },
          },
          {
            headers: {
              Authorization: `Basic ${authHeader}`,
              'Content-Type': 'application/json',
            },
          }
        );

        const qrString = res.data.qr_string || res.data.actions?.[0]?.url;
        await prisma.transaction.update({
          where: { id: transactionId },
          data: {
            paymentId,
            paymentMethod: 'QRIS',
            paymentQrString: qrString,
            paymentStatus: 'PENDING',
          },
        });

        return {
          paymentId,
          qrString,
          paymentUrl: `${env.APP_URL}/pay/${trx.shortCode}`,
        };
      } catch (e: any) {
        logger.error({ err: e.response?.data || e.message }, 'Midtrans API error, falling back to dynamic mock QRIS');
      }
    }

    // Dynamic Mock QRIS / Virtual Account for local development & testing
    const mockQrString = `00020101021226590014ID.LINKAJA.WWW0118936009990000000000520458125303360540${amount}5802ID5914REKBER_GATEWAY6007JAKARTA6304ABCD`;
    const mockVaNumber = `8808${trx.buyerPhone.slice(-8)}`;

    await prisma.transaction.update({
      where: { id: transactionId },
      data: {
        paymentId,
        paymentMethod: 'QRIS_STATIC',
        paymentQrString: mockQrString,
        paymentVaNumber: mockVaNumber,
        paymentStatus: 'PENDING',
      },
    });

    return {
      paymentId,
      qrString: mockQrString,
      vaNumber: mockVaNumber,
      paymentUrl: `${env.CLIENT_URL}/trx/${trx.shortCode}`,
    };
  }

  /**
   * Process Settlement Webhook Idempotently
   */
  async processPaymentWebhook(payload: {
    orderId: string;
    statusCode: string;
    transactionStatus: string;
    grossAmount: string;
    signatureKey?: string;
    rawPayload: any;
    provider: string;
  }): Promise<{ handled: boolean; message: string }> {
    const { orderId, transactionStatus, rawPayload, provider } = payload;
    const idempotencyKey = `${provider}:${orderId}:${transactionStatus}`;

    // 1. Check if this webhook notification was already processed
    const existingLog = await prisma.paymentWebhookLog.findUnique({
      where: { idempotencyKey },
    });

    if (existingLog) {
      logger.info({ idempotencyKey }, 'Webhook already processed (Idempotency check passed)');
      return { handled: true, message: 'Already processed' };
    }

    // 2. Find Transaction
    const trx = await prisma.transaction.findFirst({
      where: { paymentId: orderId },
    });

    if (!trx) {
      logger.warn({ orderId }, 'Payment webhook received for non-existent order ID');
      return { handled: false, message: 'Order ID not found' };
    }

    // 3. Log the Webhook
    await prisma.paymentWebhookLog.create({
      data: {
        transactionId: trx.id,
        idempotencyKey,
        provider,
        eventType: transactionStatus,
        payload: JSON.stringify(rawPayload),
        status: 'SUCCESS',
      },
    });

    // 4. Handle Payment Success (Settlement / Capture)
    const isSuccess =
      transactionStatus === 'settlement' ||
      transactionStatus === 'capture' ||
      transactionStatus === 'PAID' ||
      transactionStatus === 'SUCCESS';

    if (isSuccess && (trx.status === 'WAITING_PAYMENT' || trx.status === 'GROUP_CREATED' || trx.status === 'PENDING_VERIFICATION')) {
      logger.info({ transactionId: trx.id, shortCode: trx.shortCode }, 'Payment confirmed! Updating to PAID_HELD');

      // Update database status atomically
      await transactionService.transitionStatus(trx.id, 'PAID_HELD', {
        actor: 'PAYMENT_GATEWAY_WEBHOOK',
        action: 'PAYMENT_SETTLED',
        metadata: {
          settledAmount: payload.grossAmount,
          settledAt: new Date().toISOString(),
        },
      });

      await prisma.transaction.update({
        where: { id: trx.id },
        data: {
          paymentStatus: 'SETTLED',
          paymentSettledAt: new Date(),
        },
      });

      // WhatsApp Bot Actions:
      // A. Unlock Group Chat
      if (trx.waGroupId) {
        await whatsappService.unlockGroupChat(trx.waGroupId);

        const paymentSuccessMessage =
          `💰 *PEMBAYARAN DITERIMA & DITAMPUNG DALAM ESCROW VAULT*\n\n` +
          `• Total: *Rp ${Number(trx.totalAmount).toLocaleString('id-ID')}*\n` +
          `• Status: *Dana Diamankan Sistem*\n\n` +
          `🔓 *Chat grup sekarang telah DIBUKA.*\n\n` +
          `👉 *INSTRUKSI PENJUAL (@${trx.sellerPhone}):*\n` +
          `Silakan serahkan data akun / barang / bukti pengiriman kepada Pembeli di grup ini.\n` +
          `Setelah selesai menyerahkan, ketik */kirim*.\n\n` +
          `👉 *INSTRUKSI PEMBELI (@${trx.buyerPhone}):*\n` +
          `Periksa keaslian dan keamanan barang. Jika pesanan sudah diterima sesuai kesepakatan, ketik */selesai*.`;

        await whatsappService.sendGroupMessage(trx.waGroupId, paymentSuccessMessage);
      }
    }

    return { handled: true, message: 'Payment status updated' };
  }
}

export const paymentService = new PaymentService();
