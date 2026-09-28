import { Redis } from 'ioredis';
import Redlock from 'redlock';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

export const redisConfig = {
  host: env.REDIS_HOST,
  port: Number(env.REDIS_PORT),
  password: env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null, // Required by BullMQ
  enableReadyCheck: false,
};

export const redis = new Redis(redisConfig);

redis.on('connect', () => {
  logger.info('Connected to Redis server');
});

redis.on('error', (err) => {
  logger.error({ err }, 'Redis connection error');
});

// Distributed Lock using Redlock
export const redlock = new Redlock(
  [redis],
  {
    driftFactor: 0.01,
    retryCount: 10,
    retryDelay: 200, // time in ms
    retryJitter: 200, // time in ms
    automaticExtensionThreshold: 500, // time in ms
  }
);

redlock.on('error', (error) => {
  // Ignore resource locked errors as they are expected under contention
  if (error.name !== 'ResourceLockedError') {
    logger.error({ error }, 'Redlock unexpected error');
  }
});
