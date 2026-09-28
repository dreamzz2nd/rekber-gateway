import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { otpService } from '../services/otp.service.js';

const requestOtpSchema = z.object({
  phone: z.string().min(8, 'Nomor telepon minimal 8 digit'),
  visitorId: z.string().optional().default('anonymous_device'),
});

const verifyOtpSchema = z.object({
  phone: z.string().min(8),
  otp: z.string().length(6, 'OTP harus 6 digit angka'),
  visitorId: z.string().optional().default('anonymous_device'),
});

export class OtpController {
  async requestOtp(req: Request, res: Response, next: NextFunction) {
    try {
      const { phone, visitorId } = requestOtpSchema.parse(req.body);
      const ipAddress =
        (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() ||
        req.socket.remoteAddress ||
        '127.0.0.1';

      const result = await otpService.requestOtp({
        phone,
        ipAddress,
        deviceFingerprint: visitorId,
      });

      res.status(200).json({
        success: true,
        message: result.message,
        data: {
          ttlSeconds: result.ttlSeconds,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async verifyOtp(req: Request, res: Response, next: NextFunction) {
    try {
      const { phone, otp, visitorId } = verifyOtpSchema.parse(req.body);
      const ipAddress =
        (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() ||
        req.socket.remoteAddress ||
        '127.0.0.1';

      const isValid = await otpService.verifyOtp({
        phone,
        otp,
        ipAddress,
        deviceFingerprint: visitorId,
      });

      if (!isValid) {
        return res.status(400).json({
          success: false,
          errorCode: 'INVALID_OR_EXPIRED_OTP',
          message: 'Kode OTP salah atau telah kadaluarsa. Silakan minta kode baru.',
        });
      }

      res.status(200).json({
        success: true,
        message: 'Verifikasi OTP berhasil.',
      });
    } catch (error) {
      next(error);
    }
  }
}

export const otpController = new OtpController();
