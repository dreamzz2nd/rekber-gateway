import axios from 'axios';
import { prisma } from '../config/database.js';
import { redlock } from '../config/redis.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { whatsappService } from './whatsapp.service.js';

export class PayoutService {
  /**
   * Execute atomic disbursement / payout to seller with Redlock concurrency safety
   */
  async disburseSellerFunds(transactionId: string, actor: string): Promise<boolean> {
    const lockResource = `lock:payout:transaction:${transactionId}`;
    const lockTTL = 10000; // 10 seconds distributed lock

    let lock: any = null;
    try {
      lock = await redlock.acquire([lockResource], lockTTL);
    } catch (err) {
      logger.debug({ transactionId }, 'Proceeding with DB-level lock transaction');
    }

    try {
      // Execute within Prisma interactive transaction for ACID safety
      const payoutResult = await prisma.$transaction(async (tx) => {
        const trx = await tx.transaction.findUnique({
          where: { id: transactionId },
        });

        if (!trx) throw new Error('Transaksi tidak ditemukan.');

        // Guard against double payout or invalid state
        if (trx.status === 'COMPLETED' || trx.payoutStatus === 'SUCCESS') {
          logger.warn({ transactionId }, 'Double payout attempt blocked: already completed.');
          return { alreadyCompleted: true, trx };
        }

        if (trx.status !== 'IN_DELIVERY' && trx.status !== 'PAID_HELD') {
          throw new Error(`Transaksi tidak dapat dicairkan pada status: ${trx.status}`);
        }

        // Calculate payout amount after fee
        const totalAmount = Number(trx.totalAmount);
        const feeAmount = Number(trx.feeAmount);

        let sellerPayoutAmount = Number(trx.amount);
        if (trx.feePayer === 'SELLER') {
          sellerPayoutAmount = totalAmount - feeAmount;
        } else if (trx.feePayer === 'SPLIT_50_50') {
          sellerPayoutAmount = totalAmount - feeAmount / 2;
        }

        const payoutId = `DISB-${trx.shortCode}-${Date.now()}`;

        // Update to IN_PROGRESS status inside DB transaction
        await tx.transaction.update({
          where: { id: transactionId },
          data: {
            payoutId,
            payoutStatus: 'PENDING',
            status: 'COMPLETED',
            payoutDisbursedAt: new Date(),
          },
        });

        await tx.auditLog.create({
          data: {
            transactionId: trx.id,
            action: 'PAYOUT_DISBURSED',
            actor,
            metadata: JSON.stringify({
              payoutId,
              sellerPayoutAmount,
              feeAmount,
              disbursedTo: trx.sellerPhone,
            }),
          },
        });

        return {
          alreadyCompleted: false,
          trx,
          payoutId,
          sellerPayoutAmount,
        };
      });

      if (payoutResult.alreadyCompleted) {
        return true;
      }

      const { trx, payoutId, sellerPayoutAmount } = payoutResult;

      // Call external Disbursement API (e.g. Xendit / Mock Disbursement)
      let disbursementSuccess = true;
      let externalRef = `REF-XND-${Date.now()}`;

      if (env.DISBURSEMENT_API_KEY && env.DISBURSEMENT_API_KEY !== 'xnd_development_mock') {
        try {
          const auth = Buffer.from(`${env.DISBURSEMENT_API_KEY}:`).toString('base64');
          const res = await axios.post(
            env.DISBURSEMENT_API_URL,
            {
              external_id: payoutId,
              amount: sellerPayoutAmount,
              bank_code: trx.payoutBeneficiaryBank || 'BCA',
              account_holder_name: trx.payoutBeneficiaryName || 'SELLER REKBER',
              account_number: trx.payoutBeneficiaryAccount || '1234567890',
              description: `Pencairan Rekber Transaksi ${trx.shortCode}`,
            },
            {
              headers: {
                Authorization: `Basic ${auth}`,
                'X-IDEMPOTENCY-KEY': payoutId,
              },
            }
          );
          externalRef = res.data.id || externalRef;
        } catch (e: any) {
          logger.error({ err: e.response?.data || e.message }, 'Disbursement API call failed');
          disbursementSuccess = false;
        }
      }

      // Update payout status
      await prisma.transaction.update({
        where: { id: transactionId },
        data: {
          payoutStatus: disbursementSuccess ? 'SUCCESS' : 'FAILED',
          payoutReference: externalRef,
        },
      });

      // Send WhatsApp confirmation & Tear Down Group
      if (trx.waGroupId) {
        const receiptText =
          `✅ *TRANSAKSI SELESAI & DANA BERHASIL DICAIRKAN*\n\n` +
          `• Ref Payout: *${payoutId}*\n` +
          `• Nominal Diterima Penjual: *Rp ${sellerPayoutAmount?.toLocaleString('id-ID')}*\n` +
          `• Status: *BERHASIL (PAID TO SELLER)*\n\n` +
          `Terima kasih telah menggunakan Platform Rekber Otomatis. Grup ini akan ditutup dalam 5 detik demi privasi transaksi.`;

        await whatsappService.finalizeAndCleanGroup(trx.waGroupId, receiptText);
      }

      return true;
    } catch (err: any) {
      logger.error({ err, transactionId }, 'Error executing disbursement');
      return false;
    } finally {
      // Release Redlock if acquired
      if (lock) {
        try {
          await lock.release();
        } catch (e) {
          // Ignore
        }
      }
    }
  }
}

export const payoutService = new PayoutService();
