import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import mongoSanitize from 'express-mongo-sanitize';

import authRoutes from './routes/authRoutes.js';
import claimRoutes from './routes/claimRoutes.js';
import masterRoutes from './routes/masterRoutes.js';
import userRoutes from './routes/userRoutes.js';
import dashboardRoutes from './routes/dashboardRoutes.js';
import reportRoutes from './routes/reportRoutes.js';
import budgetRoutes from './routes/budgetRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';
import { maxUploadMb } from './middleware/upload.js';

const app = express();

app.set('trust proxy', 1);

app.use(
  helmet({
    // Files are streamed to the SPA on another origin during development.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

/**
 * CLIENT_URL may hold several comma-separated origins, which is how the
 * deployed site and local development coexist.
 */
const allowed = (process.env.CLIENT_URL || 'http://localhost:5173,http://localhost:5174')
  .split(',')
  .map((o) => o.trim().replace(/\/$/, ''))
  .filter(Boolean);

/** Vercel gives every deployment its own hostname, so previews are matched. */
const isVercelPreview = (origin) =>
  /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin);

app.use(
  cors({
    origin: (origin, cb) => {
      // Same-origin requests and tools like curl send no Origin header.
      if (!origin) return cb(null, true);
      const clean = origin.replace(/\/$/, '');
      if (allowed.includes(clean) || isVercelPreview(clean)) return cb(null, true);
      cb(new Error(`Origin ${origin} is not allowed by CORS.`));
    },
    credentials: true,
    exposedHeaders: ['Content-Disposition'],
  })
);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(mongoSanitize());
app.use(compression());

if (process.env.NODE_ENV !== 'test') {
  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
}

app.use(
  '/api',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many requests. Please slow down.' },
  })
);

app.get('/', (_req, res) =>
  res.json({
    success: true,
    service: 'Vidyaposhan API',
    docs: '/api/health',
  })
);

// The client reads this so it can reject an oversized file before uploading.
app.get('/api/limits', (_req, res) =>
  res.json({ success: true, maxUploadMb, acceptedTypes: ['application/pdf', 'image/jpeg', 'image/png'] })
);

app.get('/api/health', (_req, res) =>
  res.json({
    success: true,
    service: 'Vidyaposhan API',
    status: 'ok',
    time: new Date().toISOString(),
  })
);

app.use('/api/auth', authRoutes);
app.use('/api/claims', claimRoutes);
app.use('/api/master', masterRoutes);
app.use('/api/users', userRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/budget', budgetRoutes);
app.use('/api/admin', adminRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;
