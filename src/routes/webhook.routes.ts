import { Router } from 'express';
import { webhookController } from '../controllers/webhook.controller.js';

const router = Router();

router.post('/midtrans', (req, res, next) =>
  webhookController.handleMidtransWebhook(req, res, next)
);

router.post('/mock-simulate', (req, res, next) =>
  webhookController.handleMockWebhook(req, res, next)
);

export default router;
