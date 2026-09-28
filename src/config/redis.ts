import { Redis } from 'ioredis';
// @ts-ignore
import Redlock from 'redlock';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

export const redisConfig = {
  host: env.REDIS_HOST,
  port: Number(env.REDIS_PORT),
  password: env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  retryStrategy(times: number) {
    if (times > 3) {
      logger.warn('Redis connection retries exceeded, running in standalone mode');
      return null;
    }
    return Math.min(times * 100, 2000);
  },
};

export const redis = new Redis(redisConfig);

redis.on('connect', () => {
  logger.info('Connected to Redis server');
});

redis.on('error', (err: any) => {
  logger.warn({ message: err.message }, 'Redis server offline or connection failed (will fallback)');
});

// Distributed Lock using Redlock
export const redlock = new Redlock(
  [redis],
  {
    driftFactor: 0.01,
    retryCount: 3,
    retryDelay: 150,
    retryJitter: 150,
    automaticExtensionThreshold: 500,
  }
);

redlock.on('error', (error: any) => {
  if (error.name !== 'ResourceLockedError') {
    logger.debug({ message: error.message }, 'Redlock notice');
  }
});
