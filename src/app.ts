import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import apiRouter from './routes/index.js';
import { errorHandler } from './middlewares/errorHandler.js';

export const app = express();

app.use(
  helmet({
    contentSecurityPolicy: false, // Enable scripts & images for client dashboard
  })
);

app.use(
  cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Visitor-Id', 'X-Forwarded-For'],
  })
);

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve frontend static assets
const publicDir = path.resolve(process.cwd(), 'public');
app.use(express.static(publicDir));

// API Routes
app.use('/api', apiRouter);

// Fallback for SPA routing
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) {
    return next();
  }
  res.sendFile(path.join(publicDir, 'index.html'));
});

// Centralized Error Handler
app.use(errorHandler);
