import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../config/database.js';
import { transactionService } from '../services/transaction.service.js';
import { payoutService } from '../services/payout.service.js';
import { sanitizePhoneNumber } from '../utils/phone.js';

const createDisputeSchema = z.object({
  transactionId: z.string(),
  initiatorPhone: z.string().min(8),
  reason: z.string().min(5, 'Alasan sengketa minimal 5 karakter'),
});

const resolveDisputeSchema = z.object({
  disputeId: z.string(),
  resolution: z.enum(['RELEASE_SELLER', 'REFUND_BUYER', 'CANCEL']),
  adminNotes: z.string().optional(),
});

export class DisputeController {
  async raiseDispute(req: Request, res: Response, next: NextFunction) {
    try {
      const { transactionId, initiatorPhone, reason } = createDisputeSchema.parse(req.body);
      const sanitizedPhone = sanitizePhoneNumber(initiatorPhone);

      const trx = await prisma.transaction.findUnique({
        where: { id: transactionId },
      });

      if (!trx) {
        return res.status(404).json({ success: false, message: 'Transaksi tidak ditemukan' });
      }

      // Create Dispute entry
      const dispute = await prisma.dispute.create({
        data: {
          transactionId: trx.id,
          initiatorPhone: sanitizedPhone,
          reason,
          status: 'OPEN',
        },
      });

      // Update Transaction status to DISPUTED
      await transactionService.transitionStatus(trx.id, 'DISPUTED', {
        actor: sanitizedPhone,
        action: 'DISPUTE_CREATED_WEB',
        reason,
      });

      res.status(201).json({
        success: true,
        message: 'Sengketa berhasil diajukan. Tim admin/mediator akan segera menangani kasus ini.',
        data: dispute,
      });
    } catch (error) {
      next(error);
    }
  }

  async resolveDispute(req: Request, res: Response, next: NextFunction) {
    try {
      const { disputeId, resolution, adminNotes } = resolveDisputeSchema.parse(req.body);

      const dispute = await prisma.dispute.findUnique({
        where: { id: disputeId },
        include: { transaction: true },
      });

      if (!dispute) {
        return res.status(404).json({ success: false, message: 'Sengketa tidak ditemukan' });
      }

      if (resolution === 'RELEASE_SELLER') {
        // Disburse to seller
        await payoutService.disburseSellerFunds(dispute.transactionId, 'ADMIN_RESOLVER');
        await prisma.dispute.update({
          where: { id: disputeId },
          data: {
            status: 'RESOLVED_RELEASE_SELLER',
            adminNotes,
            resolvedAt: new Date(),
          },
        });
      } else if (resolution === 'REFUND_BUYER') {
        // Mark as refunded
        await transactionService.transitionStatus(dispute.transactionId, 'REFUNDED', {
          actor: 'ADMIN_RESOLVER',
          action: 'DISPUTE_REFUND_BUYER',
          reason: adminNotes,
        });

        await prisma.dispute.update({
          where: { id: disputeId },
          data: {
            status: 'RESOLVED_REFUND_BUYER',
            adminNotes,
            resolvedAt: new Date(),
          },
        });
      }

      res.status(200).json({
        success: true,
        message: 'Sengketa berhasil diselesaikan.',
      });
    } catch (error) {
      next(error);
    }
  }
}

export const disputeController = new DisputeController();
