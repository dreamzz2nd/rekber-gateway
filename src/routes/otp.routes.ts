import { Router } from 'express';
import { otpController } from '../controllers/otp.controller.js';
import { multiTierRateLimiter } from '../middlewares/rateLimiter.js';

const router = Router();

// Multi-tier Rate Limiter applied to OTP request
router.post('/request', multiTierRateLimiter(), (req, res, next) => otpController.requestOtp(req, res, next));
router.post('/verify', (req, res, next) => otpController.verifyOtp(req, res, next));

export default router;
