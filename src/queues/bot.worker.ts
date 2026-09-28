import { Worker, Job } from 'bullmq';
import { BOT_QUEUE_NAME, executeBotJob } from '../services/queue.service.js';
import { redisConfig, redis } from '../config/redis.js';
import { logger } from '../utils/logger.js';

export function startBotWorker() {
  redis.on('connect', () => {
    try {
      const worker = new Worker(
        BOT_QUEUE_NAME,
        async (job: Job) => {
          await executeBotJob(job.name, job.data);
        },
        {
          connection: redisConfig,
          concurrency: 5,
        }
      );

      worker.on('completed', (job) => {
        logger.info({ jobId: job.id, jobName: job.name }, 'Job completed successfully');
      });

      worker.on('failed', (job, err) => {
        logger.error({ jobId: job?.id, jobName: job?.name, error: err.message }, 'Job failed');
      });
    } catch (e: any) {
      logger.warn({ message: e.message }, 'BullMQ Worker initialization deferred');
    }
  });
}
