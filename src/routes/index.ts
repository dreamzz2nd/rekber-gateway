import { Router } from 'express';
import otpRoutes from './otp.routes.js';
import transactionRoutes from './transaction.routes.js';
import webhookRoutes from './webhook.routes.js';
import disputeRoutes from './dispute.routes.js';

const apiRouter = Router();

apiRouter.use('/otp', otpRoutes);
apiRouter.use('/transactions', transactionRoutes);
apiRouter.use('/webhooks', webhookRoutes);
apiRouter.use('/disputes', disputeRoutes);

apiRouter.get('/health', (req, res) => {
  res.status(200).json({
    status: 'UP',
    timestamp: new Date().toISOString(),
    service: 'Automated WhatsApp Escrow Gateway',
  });
});

export default apiRouter;
