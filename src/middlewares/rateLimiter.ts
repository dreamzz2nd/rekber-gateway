import { Request, Response, NextFunction } from 'express';
import { redis } from '../config/redis.js';
import { env } from '../config/env.js';
import { sanitizePhoneNumber } from '../utils/phone.js';
import { logger } from '../utils/logger.js';

interface RateLimitConfig {
  maxIpRequests: number;
  maxDeviceRequests: number;
  maxPhoneRequests: number;
  windowSeconds: number;
}

const DEFAULT_CONFIG: RateLimitConfig = {
  maxIpRequests: 5,         // Max 5 OTP requests per hour per IP
  maxDeviceRequests: 5,     // Max 5 OTP requests per hour per Device Fingerprint
  maxPhoneRequests: 3,      // Max 3 OTP requests per hour per Target Phone
  windowSeconds: env.RATE_LIMIT_WINDOW_SECONDS || 3600,
};

/**
 * Atomic sliding window / fixed window counter with Redis TTL
 */
async function checkAndIncrementLimit(
  key: string,
  limit: number,
  ttlSeconds: number
): Promise<{ allowed: boolean; remaining: number; resetTime: number }> {
  const current = await redis.incr(key);

  if (current === 1) {
    await redis.expire(key, ttlSeconds);
  }

  const ttl = await redis.ttl(key);
  const resetTime = Date.now() + Math.max(0, ttl) * 1000;
  const remaining = Math.max(0, limit - current);

  return {
    allowed: current <= limit,
    remaining,
    resetTime,
  };
}

/**
 * Multi-Tier Anti-Abuse Rate Limiter for OTP & Transaction Initiation
 */
export function multiTierRateLimiter(config: Partial<RateLimitConfig> = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const clientIp =
        (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() ||
        req.socket.remoteAddress ||
        'unknown_ip';

      const visitorId = (req.body?.visitorId || req.headers['x-visitor-id'] || 'anonymous_fingerprint') as string;
      const phoneInput = (req.body?.initiatorPhone || req.body?.phone || req.body?.phoneNumber || '') as string;
      const targetPhone = sanitizePhoneNumber(phoneInput);

      const ipKey = `ratelimit:ip:${clientIp}`;
      const deviceKey = `ratelimit:device:${visitorId}`;
      const phoneKey = targetPhone ? `ratelimit:phone:${targetPhone}` : null;

      // 1. Check IP Limit
      const ipLimit = await checkAndIncrementLimit(ipKey, cfg.maxIpRequests, cfg.windowSeconds);
      if (!ipLimit.allowed) {
        logger.warn({ clientIp }, 'Rate limit exceeded: IP Address Throttling');
        res.status(429).json({
          success: false,
          errorCode: 'RATE_LIMIT_IP_EXCEEDED',
          message: `Terlalu banyak permintaan dari IP ini. Silakan coba lagi setelah ${Math.ceil(
            (ipLimit.resetTime - Date.now()) / 60000
          )} menit.`,
          retryAfterSeconds: Math.ceil((ipLimit.resetTime - Date.now()) / 1000),
        });
        return;
      }

      // 2. Check Device Fingerprint Limit
      if (visitorId && visitorId !== 'anonymous_fingerprint') {
        const deviceLimit = await checkAndIncrementLimit(deviceKey, cfg.maxDeviceRequests, cfg.windowSeconds);
        if (!deviceLimit.allowed) {
          logger.warn({ visitorId }, 'Rate limit exceeded: Device Fingerprint Throttling');
          res.status(429).json({
            success: false,
            errorCode: 'RATE_LIMIT_DEVICE_EXCEEDED',
            message: `Batas permintaan untuk perangkat ini telah tercapai. Coba lagi dalam 1 jam.`,
            retryAfterSeconds: Math.ceil((deviceLimit.resetTime - Date.now()) / 1000),
          });
          return;
        }
      }

      // 3. Check Target Phone Limit
      if (phoneKey) {
        const phoneLimit = await checkAndIncrementLimit(phoneKey, cfg.maxPhoneRequests, cfg.windowSeconds);
        if (!phoneLimit.allowed) {
          logger.warn({ targetPhone }, 'Rate limit exceeded: Target Phone Throttling');
          res.status(429).json({
            success: false,
            errorCode: 'RATE_LIMIT_PHONE_EXCEEDED',
            message: `Nomor WhatsApp ini sudah mencapai batas request OTP (maks. 3x per jam). Coba lagi nanti.`,
            retryAfterSeconds: Math.ceil((phoneLimit.resetTime - Date.now()) / 1000),
          });
          return;
        }
      }

      // Pass remaining header info
      res.setHeader('X-RateLimit-Limit-IP', cfg.maxIpRequests);
      res.setHeader('X-RateLimit-Remaining-IP', ipLimit.remaining);

      next();
    } catch (error) {
      logger.error({ error }, 'Rate limiter middleware internal error');
      // In case of redis failure, allow request but log warning to prevent hard downtime
      next();
    }
  };
}
