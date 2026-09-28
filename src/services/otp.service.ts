import crypto from 'crypto';
import { redis } from '../config/redis.js';
import { env } from '../config/env.js';
import { prisma } from '../config/database.js';
import { sanitizePhoneNumber } from '../utils/phone.js';
import { logger } from '../utils/logger.js';
import { whatsappService } from './whatsapp.service.js';

// In-memory fallback map if Redis is not available
const inMemoryOtpStore = new Map<string, { otp: string; expiresAt: number }>();

export class OtpService {
  /**
   * Generates secure 6-digit random numeric OTP
   */
  private generateNumericOtp(): string {
    const buffer = crypto.randomBytes(4);
    const num = (buffer.readUInt32BE(0) % 900000) + 100000;
    return num.toString();
  }

  /**
   * Hash OTP with salt for secure DB storage
   */
  private hashOtp(phone: string, otp: string): string {
    return crypto
      .createHmac('sha256', env.OTP_SECRET_SALT)
      .update(`${phone}:${otp}`)
      .digest('hex');
  }

  /**
   * Issue and send OTP to recipient via WhatsApp Bot DM
   */
  async requestOtp(params: {
    phone: string;
    ipAddress: string;
    deviceFingerprint: string;
  }): Promise<{ success: boolean; ttlSeconds: number; message: string }> {
    const phone = sanitizePhoneNumber(params.phone);
    const otp = this.generateNumericOtp();
    const otpHash = this.hashOtp(phone, otp);

    const redisKey = `otp:active:${phone}`;

    // Store in Redis with fallback to memory
    try {
      await redis.set(redisKey, otp, 'EX', env.OTP_TTL_SECONDS);
    } catch {
      inMemoryOtpStore.set(phone, {
        otp,
        expiresAt: Date.now() + env.OTP_TTL_SECONDS * 1000,
      });
    }

    // Save log to DB
    const expiresAt = new Date(Date.now() + env.OTP_TTL_SECONDS * 1000);
    try {
      await prisma.otpLog.create({
        data: {
          phone,
          ipAddress: params.ipAddress,
          deviceFingerprint: params.deviceFingerprint,
          otpCodeHash: otpHash,
          attempts: 0,
          status: 'PENDING',
          expiresAt,
        },
      });
    } catch (e: any) {
      logger.warn({ err: e.message }, 'Failed to write OTP log to DB (continuing)');
    }

    // Send WhatsApp Direct Message via Bot
    const waMessage =
      `🔐 *KODE VERIFIKASI REKBER (OTP)*\n\n` +
      `Kode OTP Anda adalah: *${otp}*\n\n` +
      `⚠️ *JANGAN BERIKAN KODE INI KEPADA SIAPAPUN*, termasuk pihak admin.\n` +
      `Kode berlaku selama *3 menit* untuk inisiasi transaksi escrow aman.`;

    try {
      await whatsappService.sendDirectMessage(phone, waMessage);
      logger.info({ phone }, 'OTP WhatsApp message dispatched successfully');
    } catch (error) {
      logger.warn({ phone, error }, 'Failed to send OTP via WhatsApp socket, fallback log in dev');
    }

    return {
      success: true,
      ttlSeconds: env.OTP_TTL_SECONDS,
      message: `Kode OTP telah dikirimkan ke WhatsApp (${phone}). (Dev Mode OTP: ${otp})`,
    };
  }

  /**
   * Verify provided OTP against Redis/Memory and audit log
   */
  async verifyOtp(params: {
    phone: string;
    otp: string;
    ipAddress: string;
    deviceFingerprint: string;
  }): Promise<boolean> {
    const phone = sanitizePhoneNumber(params.phone);
    const redisKey = `otp:active:${phone}`;

    let storedOtp: string | null = null;
    try {
      storedOtp = await redis.get(redisKey);
    } catch {
      const mem = inMemoryOtpStore.get(phone);
      if (mem && mem.expiresAt > Date.now()) {
        storedOtp = mem.otp;
      }
    }

    if (!storedOtp) {
      try {
        const latestLog = await prisma.otpLog.findFirst({
          where: { phone, status: 'PENDING' },
          orderBy: { createdAt: 'desc' },
        });

        if (latestLog) {
          await prisma.otpLog.update({
            where: { id: latestLog.id },
            data: { status: 'EXPIRED' },
          });
        }
      } catch {}

      return false;
    }

    if (storedOtp !== params.otp.trim()) {
      try {
        const latestLog = await prisma.otpLog.findFirst({
          where: { phone, status: 'PENDING' },
          orderBy: { createdAt: 'desc' },
        });

        if (latestLog) {
          const attempts = latestLog.attempts + 1;
          await prisma.otpLog.update({
            where: { id: latestLog.id },
            data: {
              attempts,
              status: attempts >= 3 ? 'FAILED' : 'PENDING',
            },
          });
        }
      } catch {}

      return false;
    }

    // OTP Valid -> Clean up
    try {
      await redis.del(redisKey);
    } catch {
      inMemoryOtpStore.delete(phone);
    }

    try {
      const latestLog = await prisma.otpLog.findFirst({
        where: { phone, status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
      });

      if (latestLog) {
        await prisma.otpLog.update({
          where: { id: latestLog.id },
          data: { status: 'VERIFIED' },
        });
      }

      await prisma.user.upsert({
        where: { phoneNumber: phone },
        update: { isVerified: true },
        create: { phoneNumber: phone, isVerified: true },
      });
    } catch {}

    return true;
  }
}

export const otpService = new OtpService();
