import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { login, me, changePassword } from '../controllers/authController.js';
import { protect } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { loginSchema, changePasswordSchema } from '../config/schemas.js';

const router = Router();

// Throttles credential stuffing without inconveniencing real users. Only
// failed attempts count, so a busy office signing people in is never blocked.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many sign-in attempts. Try again in 15 minutes.' },
});

router.post('/login', loginLimiter, validate(loginSchema), login);
router.get('/me', protect, me);
router.post('/change-password', protect, validate(changePasswordSchema), changePassword);

export default router;
