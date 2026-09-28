import { app } from './app.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { prisma } from './config/database.js';
import { whatsappService } from './services/whatsapp.service.js';
import { startBotWorker } from './queues/bot.worker.js';

async function bootstrap() {
  try {
    logger.info('Starting Automated WhatsApp Escrow (Rekber) Platform...');

    // Test DB connection
    await prisma.$connect();
    logger.info('Database connected successfully');

    // Start background queue worker
    startBotWorker();
    logger.info('BullMQ Bot Worker started');

    // Initialize WhatsApp Baileys Engine
    whatsappService.initialize().catch((err) => {
      logger.error({ err }, 'WhatsApp initialization error in background');
    });

    // Start Express Web Server
    const server = app.listen(Number(env.PORT), () => {
      logger.info(`Server is running at http://localhost:${env.PORT}`);
    });

    // Graceful Shutdown
    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}, shutting down gracefully...`);
      server.close(async () => {
        await prisma.$disconnect();
        logger.info('All connections closed. Exiting process.');
        process.exit(0);
      });
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (error) {
    logger.fatal({ error }, 'Fatal error during server bootstrap');
    process.exit(1);
  }
}

bootstrap();
