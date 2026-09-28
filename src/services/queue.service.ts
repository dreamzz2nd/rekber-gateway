import { Queue } from 'bullmq';
import { redisConfig } from '../config/redis.js';

export const BOT_QUEUE_NAME = 'rekber-bot-queue';

export const botQueue = new Queue(BOT_QUEUE_NAME, {
  connection: redisConfig,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: 100,
    removeOnFail: 200,
  },
});
