import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.string().default('3000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  APP_URL: z.string().default('http://localhost:3000'),
  CLIENT_URL: z.string().default('http://localhost:5173'),

  DATABASE_URL: z.string().default('postgresql://postgres:postgres@localhost:5432/rekber_db?schema=public'),

  REDIS_HOST: z.string().default('127.0.0.1'),
  REDIS_PORT: z.string().default('6379'),
  REDIS_PASSWORD: z.string().optional(),

  OTP_SECRET_SALT: z.string().default('rekber_super_secure_otp_salt_2026'),
  OTP_TTL_SECONDS: z.coerce.number().default(180),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().default(3600),

  PAYMENT_GATEWAY_PROVIDER: z.enum(['midtrans', 'xendit', 'tripay', 'mock']).default('midtrans'),
  PAYMENT_SERVER_KEY: z.string().default('SB-Mid-server-demo'),
  PAYMENT_CLIENT_KEY: z.string().default('SB-Mid-client-demo'),
  PAYMENT_WEBHOOK_SECRET: z.string().default('secret_mock_webhook'),

  DISBURSEMENT_API_KEY: z.string().default('xnd_development_mock'),
  DISBURSEMENT_API_URL: z.string().default('https://api.xendit.co/disbursements'),

  WA_SESSION_AUTH_FOLDER: z.string().default('./auth_info_baileys'),
  WA_ADMIN_PHONE_ALERT: z.string().default('6281234567890'),
  ESCROW_FEE_PERCENTAGE: z.coerce.number().default(1.5),
  ESCROW_MIN_FEE_IDR: z.coerce.number().default(5000),
});

export const env = envSchema.parse(process.env);
