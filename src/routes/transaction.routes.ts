import { Router } from 'express';
import { transactionController } from '../controllers/transaction.controller.js';
import { multiTierRateLimiter } from '../middlewares/rateLimiter.js';

const router = Router();

// Transaction Initiation protected by multi-tier rate limiter
router.post('/initiate', multiTierRateLimiter(), (req, res, next) =>
  transactionController.initiate(req, res, next)
);

// Verify OTP and launch automated WhatsApp escrow group
router.post('/verify-and-start', (req, res, next) =>
  transactionController.verifyAndStart(req, res, next)
);

// Get WhatsApp bot connection status & QR code
router.get('/bot/status', (req, res, next) =>
  transactionController.getWhatsAppStatus(req, res, next)
);

// Get Transaction real-time state & tracking details
router.get('/:identifier', (req, res, next) =>
  transactionController.getDetails(req, res, next)
);

export default router;
