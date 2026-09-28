import { Router } from 'express';
import { disputeController } from '../controllers/dispute.controller.js';

const router = Router();

router.post('/raise', (req, res, next) => disputeController.raiseDispute(req, res, next));
router.post('/resolve', (req, res, next) => disputeController.resolveDispute(req, res, next));

export default router;
