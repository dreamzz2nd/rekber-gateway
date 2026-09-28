import { app } from './app.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { prisma } from './config/database.js';
import { whatsappService } from './services/whatsapp.service.js';
import { startBotWorker } from './queues/bot.worker.js';

async function bootstrap() {
  try {
    logger.info('Starting Automated WhatsApp Escrow (Rekber) Platform...');

    // 1. Connect Database
    await prisma.$connect();
    logger.info('✅ SQLite Database connected successfully');

    // 2. Start Express Web Server FIRST
    const port = Number(env.PORT) || 3000;
    const server = app.listen(port, () => {
      logger.info(`🚀 Rekber Gateway Web Server is running at http://localhost:${port}`);
    });

    // 3. Start background queue worker in non-blocking try-catch
    try {
      startBotWorker();
      logger.info('✅ BullMQ Bot Worker initialized');
    } catch (err: any) {
      logger.warn({ message: err.message }, 'BullMQ Worker running in fallback mode');
    }

    // 4. Initialize WhatsApp Baileys Engine in background
    setTimeout(() => {
      whatsappService.initialize().catch((err) => {
        logger.warn({ message: err.message }, 'WhatsApp initialization notice');
      });
    }, 1000);

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
