import { TransactionStatus, Role, FeePayer, Prisma } from '@prisma/client';
import { nanoid } from 'nanoid';
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
import { sanitizePhoneNumber, isValidIndonesianPhone } from '../utils/phone.js';
import { logger } from '../utils/logger.js';
import { botQueue } from './queue.service.js';

// Define Allowed State Transitions for strict state-machine enforcement
const ALLOWED_TRANSITIONS: Record<TransactionStatus, TransactionStatus[]> = {
  PENDING_VERIFICATION: ['GROUP_CREATED', 'CANCELLED'],
  GROUP_CREATED: ['WAITING_PAYMENT', 'CANCELLED', 'DISPUTED'],
  WAITING_PAYMENT: ['PAID_HELD', 'CANCELLED', 'DISPUTED'],
  PAID_HELD: ['IN_DELIVERY', 'DISPUTED', 'COMPLETED'],
  IN_DELIVERY: ['COMPLETED', 'DISPUTED'],
  DISPUTED: ['COMPLETED', 'REFUNDED', 'CANCELLED'],
  COMPLETED: [],
  REFUNDED: [],
  CANCELLED: [],
};

export class TransactionService {
  /**
   * Calculate Escrow Fee based on amount and payer type
   */
  calculateFee(amount: number, feePayer: FeePayer): { feeAmount: number; totalAmount: number } {
    const rawFee = (amount * env.ESCROW_FEE_PERCENTAGE) / 100;
    const feeAmount = Math.max(rawFee, env.ESCROW_MIN_FEE_IDR);

    let totalAmount = amount;
    if (feePayer === 'BUYER' || feePayer === 'SPLIT_50_50') {
      const buyerFeePortion = feePayer === 'BUYER' ? feeAmount : feeAmount / 2;
      totalAmount = amount + buyerFeePortion;
    }

    return {
      feeAmount: Math.round(feeAmount),
      totalAmount: Math.round(totalAmount),
    };
  }

  /**
   * Initiates a new Rekber Escrow Transaction
   */
  async initiateTransaction(params: {
    initiatorPhone: string;
    initiatorRole: Role;
    partnerPhone: string;
    title: string;
    description?: string;
    amount: number;
    feePayer: FeePayer;
    sellerBankCode?: string;
    sellerAccountNumber?: string;
    sellerAccountName?: string;
  }) {
    const initPhone = sanitizePhoneNumber(params.initiatorPhone);
    const partPhone = sanitizePhoneNumber(params.partnerPhone);

    if (!isValidIndonesianPhone(initPhone)) {
      throw new Error('Nomor WhatsApp inisiator tidak valid (format: 628xxxxxxxxxx).');
    }
    if (!isValidIndonesianPhone(partPhone)) {
      throw new Error('Nomor WhatsApp rekan transaksi tidak valid (format: 628xxxxxxxxxx).');
    }
    if (initPhone === partPhone) {
      throw new Error('Nomor inisiator dan rekan transaksi tidak boleh sama.');
    }

    const buyerPhone = params.initiatorRole === 'BUYER' ? initPhone : partPhone;
    const sellerPhone = params.initiatorRole === 'SELLER' ? initPhone : partPhone;

    const { feeAmount, totalAmount } = this.calculateFee(params.amount, params.feePayer);
    const shortCode = nanoid(8).toUpperCase();

    // Create / ensure user exists
    await prisma.user.upsert({
      where: { phoneNumber: initPhone },
      update: {},
      create: { phoneNumber: initPhone },
    });

    const trx = await prisma.transaction.create({
      data: {
        shortCode,
        initiatorPhone: initPhone,
        initiatorRole: params.initiatorRole,
        buyerPhone,
        sellerPhone,
        title: params.title,
        description: params.description,
        amount: new Prisma.Decimal(params.amount),
        feeAmount: new Prisma.Decimal(feeAmount),
        feePayer: params.feePayer,
        totalAmount: new Prisma.Decimal(totalAmount),
        status: 'PENDING_VERIFICATION',
        payoutBeneficiaryBank: params.sellerBankCode,
        payoutBeneficiaryAccount: params.sellerAccountNumber,
        payoutBeneficiaryName: params.sellerAccountName,
      },
    });

    await prisma.auditLog.create({
      data: {
        transactionId: trx.id,
        action: 'TRANSACTION_INITIATED',
        actor: initPhone,
        metadata: { shortCode, amount: params.amount, totalAmount },
      },
    });

    return trx;
  }

  /**
   * Transitions transaction status atomically with state machine validation
   */
  async transitionStatus(
    transactionId: string,
    targetStatus: TransactionStatus,
    audit: { actor: string; action: string; reason?: string; metadata?: any }
  ) {
    return await prisma.$transaction(async (tx) => {
      const trx = await tx.transaction.findUnique({
        where: { id: transactionId },
      });

      if (!trx) throw new Error('Transaksi tidak ditemukan.');

      // Check Allowed Transitions
      const allowed = ALLOWED_TRANSITIONS[trx.status];
      if (!allowed.includes(targetStatus)) {
        throw new Error(
          `Invalid state transition: tidak dapat mengubah status dari ${trx.status} ke ${targetStatus}.`
        );
      }

      const updated = await tx.transaction.update({
        where: { id: transactionId },
        data: { status: targetStatus },
      });

      await tx.auditLog.create({
        data: {
          transactionId: trx.id,
          action: audit.action,
          actor: audit.actor,
          metadata: {
            fromStatus: trx.status,
            toStatus: targetStatus,
            reason: audit.reason,
            ...audit.metadata,
          },
        },
      });

      logger.info(
        { transactionId, from: trx.status, to: targetStatus, actor: audit.actor },
        'Transaction state transition applied successfully'
      );

      return updated;
    });
  }

  /**
   * Finalizes OTP verification and triggers WhatsApp Group Creation Job
   */
  async completeVerificationAndCreateGroup(transactionId: string) {
    const trx = await prisma.transaction.findUnique({
      where: { id: transactionId },
    });

    if (!trx) throw new Error('Transaksi tidak ditemukan');

    // Queue WhatsApp group creation
    await botQueue.add('create-escrow-group', {
      transactionId: trx.id,
      shortCode: trx.shortCode,
      buyerPhone: trx.buyerPhone,
      sellerPhone: trx.sellerPhone,
      title: trx.title,
      totalAmount: trx.totalAmount.toString(),
    });

    return { queued: true, shortCode: trx.shortCode };
  }

  /**
   * Get Transaction by shortCode or ID
   */
  async getTransactionDetails(identifier: string) {
    return await prisma.transaction.findFirst({
      where: {
        OR: [{ id: identifier }, { shortCode: identifier.toUpperCase() }],
      },
      include: {
        disputes: true,
        auditLogs: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });
  }
}

export const transactionService = new TransactionService();
