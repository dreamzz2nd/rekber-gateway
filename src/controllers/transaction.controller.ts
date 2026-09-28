import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { transactionService, Role, FeePayer } from '../services/transaction.service.js';
import { otpService } from '../services/otp.service.js';
import { whatsappService } from '../services/whatsapp.service.js';

const initiateTransactionSchema = z.object({
  initiatorRole: z.enum(['BUYER', 'SELLER']),
  initiatorPhone: z.string().min(8, 'Nomor inisiator minimal 8 digit'),
  partnerPhone: z.string().min(8, 'Nomor rekan transaksi minimal 8 digit'),
  title: z.string().min(3, 'Judul transaksi minimal 3 karakter'),
  description: z.string().optional(),
  amount: z.coerce.number().positive('Nominal harus lebih besar dari 0'),
  feePayer: z.enum(['BUYER', 'SELLER', 'SPLIT_50_50']),
  sellerBankCode: z.string().optional(),
  sellerAccountNumber: z.string().optional(),
  sellerAccountName: z.string().optional(),
  visitorId: z.string().optional().default('anonymous_device'),
});

const verifyAndStartSchema = z.object({
  transactionId: z.string(),
  otp: z.string().length(6, 'OTP harus 6 digit angka'),
  visitorId: z.string().optional().default('anonymous_device'),
});

export class TransactionController {
  async initiate(req: Request, res: Response, next: NextFunction) {
    try {
      const data = initiateTransactionSchema.parse(req.body);
      const ipAddress =
        (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() ||
        req.socket.remoteAddress ||
        '127.0.0.1';

      // 1. Create Transaction in PENDING_VERIFICATION state
      const trx = await transactionService.initiateTransaction({
        initiatorPhone: data.initiatorPhone,
        initiatorRole: data.initiatorRole as Role,
        partnerPhone: data.partnerPhone,
        title: data.title,
        description: data.description,
        amount: data.amount,
        feePayer: data.feePayer as FeePayer,
        sellerBankCode: data.sellerBankCode,
        sellerAccountNumber: data.sellerAccountNumber,
        sellerAccountName: data.sellerAccountName,
      });

      // 2. Automatically dispatch OTP to Initiator's WhatsApp
      await otpService.requestOtp({
        phone: data.initiatorPhone,
        ipAddress,
        deviceFingerprint: data.visitorId,
      });

      res.status(201).json({
        success: true,
        message: 'Transaksi dibuat. Silakan masukkan kode OTP yang telah dikirim ke WhatsApp Anda.',
        data: {
          transactionId: trx.id,
          shortCode: trx.shortCode,
          initiatorPhone: trx.initiatorPhone,
          amount: trx.amount,
          feeAmount: trx.feeAmount,
          totalAmount: trx.totalAmount,
          feePayer: trx.feePayer,
          status: trx.status,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async verifyAndStart(req: Request, res: Response, next: NextFunction) {
    try {
      const { transactionId, otp, visitorId } = verifyAndStartSchema.parse(req.body);
      const ipAddress =
        (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() ||
        req.socket.remoteAddress ||
        '127.0.0.1';

      const trx = await transactionService.getTransactionDetails(transactionId);
      if (!trx) {
        return res.status(404).json({
          success: false,
          errorCode: 'TRANSACTION_NOT_FOUND',
          message: 'Transaksi tidak ditemukan.',
        });
      }

      // Verify OTP
      const isOtpValid = await otpService.verifyOtp({
        phone: trx.initiatorPhone,
        otp,
        ipAddress,
        deviceFingerprint: visitorId,
      });

      if (!isOtpValid) {
        return res.status(400).json({
          success: false,
          errorCode: 'INVALID_OTP',
          message: 'Kode OTP tidak valid atau sudah kadaluarsa.',
        });
      }

      // Trigger bot group creation in background
      await transactionService.completeVerificationAndCreateGroup(trx.id);

      res.status(200).json({
        success: true,
        message: 'Verifikasi berhasil! Bot sedang membuat WhatsApp Group Escrow...',
        data: {
          transactionId: trx.id,
          shortCode: trx.shortCode,
          status: 'GROUP_CREATED',
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async getDetails(req: Request, res: Response, next: NextFunction) {
    try {
      const { identifier } = req.params;
      const trx = await transactionService.getTransactionDetails(identifier);

      if (!trx) {
        return res.status(404).json({
          success: false,
          errorCode: 'NOT_FOUND',
          message: 'Transaksi tidak ditemukan.',
        });
      }

      res.status(200).json({
        success: true,
        data: trx,
      });
    } catch (error) {
      next(error);
    }
  }

  async getWhatsAppStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const status = whatsappService.getStatus();
      res.status(200).json({
        success: true,
        data: status,
      });
    } catch (error) {
      next(error);
    }
  }
}

export const transactionController = new TransactionController();
