import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { logger } from '../utils/logger.js';

export function errorHandler(err: any, req: Request, res: Response, next: NextFunction) {
  logger.error({ err, path: req.path, method: req.method }, 'Unhandled API Error');

  if (err instanceof ZodError) {
    return res.status(400).json({
      success: false,
      errorCode: 'VALIDATION_ERROR',
      message: 'Validasi payload gagal.',
      errors: err.errors.map((e) => ({
        path: e.path.join('.'),
        message: e.message,
      })),
    });
  }

  if (err.name === 'PrismaClientKnownRequestError') {
    return res.status(400).json({
      success: false,
      errorCode: 'DATABASE_ERROR',
      message: 'Operasi database gagal.',
      details: err.meta,
    });
  }

  const statusCode = err.statusCode || 500;
  const message = err.message || 'Terjadi kesalahan internal server.';

  res.status(statusCode).json({
    success: false,
    errorCode: err.errorCode || 'INTERNAL_SERVER_ERROR',
    message,
  });
}
