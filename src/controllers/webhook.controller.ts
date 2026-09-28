import { Request, Response, NextFunction } from 'express';
import { paymentService } from '../services/payment.service.js';
import { verifyMidtransSignature } from '../utils/signature.js';
import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';

export class WebhookController {
  /**
   * Midtrans Payment Notification Webhook
   */
  async handleMidtransWebhook(req: Request, res: Response, next: NextFunction) {
    try {
      const payload = req.body;
      logger.info({ payload }, 'Received Midtrans payment webhook');

      const {
        order_id,
        status_code,
        gross_amount,
        signature_key,
        transaction_status,
      } = payload;

      // Validate signature in production
      if (env.NODE_ENV === 'production') {
        const isValidSignature = verifyMidtransSignature(
          order_id,
          status_code,
          gross_amount,
          signature_key
        );

        if (!isValidSignature) {
          logger.warn({ order_id }, 'Invalid Midtrans webhook signature received');
          return res.status(403).json({ success: false, message: 'Invalid signature' });
        }
      }

      const result = await paymentService.processPaymentWebhook({
        orderId: order_id,
        statusCode: status_code,
        transactionStatus: transaction_status,
        grossAmount: gross_amount,
        signatureKey: signature_key,
        rawPayload: payload,
        provider: 'midtrans',
      });

      res.status(200).json({
        success: true,
        message: result.message,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Generic / Mock Simulation Webhook endpoint for quick testing
   */
  async handleMockWebhook(req: Request, res: Response, next: NextFunction) {
    try {
      const { paymentId, status = 'settlement', grossAmount = '0' } = req.body;

      if (!paymentId) {
        return res.status(400).json({ success: false, message: 'paymentId is required' });
      }

      const result = await paymentService.processPaymentWebhook({
        orderId: paymentId,
        statusCode: '200',
        transactionStatus: status,
        grossAmount: String(grossAmount),
        rawPayload: req.body,
        provider: 'mock',
      });

      res.status(200).json({
        success: true,
        message: result.message,
      });
    } catch (error) {
      next(error);
    }
  }
}

export const webhookController = new WebhookController();
