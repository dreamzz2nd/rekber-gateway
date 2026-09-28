import crypto from 'crypto';
import { env } from '../config/env.js';

/**
 * Verifies Midtrans signature key:
 * SHA512(order_id + status_code + gross_amount + ServerKey)
 */
export function verifyMidtransSignature(
  orderId: string,
  statusCode: string,
  grossAmount: string,
  receivedSignature: string
): boolean {
  const payload = `${orderId}${statusCode}${grossAmount}${env.PAYMENT_SERVER_KEY}`;
  const computed = crypto.createHash('sha512').update(payload).digest('hex');
  return computed.toLowerCase() === receivedSignature.toLowerCase();
}

/**
 * Computes generic HMAC SHA256 signature for webhooks
 */
export function computeHmacSha256(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Verifies generic HMAC SHA256 signature
 */
export function verifyHmacSignature(
  payload: string,
  receivedSignature: string,
  secret: string = env.PAYMENT_WEBHOOK_SECRET
): boolean {
  const expected = computeHmacSha256(payload, secret);
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(receivedSignature, 'hex'));
  } catch {
    return false;
  }
}
