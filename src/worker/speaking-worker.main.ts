import * as dotenv from 'dotenv';
dotenv.config();

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { SpeakingWorkerModule } from './speaking-worker.module';

async function bootstrap() {
  const logger = new Logger('SpeakingWorkerMain');
  logger.log('Starting standalone BreadTrans Speaking Worker...');

  const app = await NestFactory.createApplicationContext(SpeakingWorkerModule, {
    logger: ['log', 'error', 'warn', 'debug', 'verbose'],
  });

  app.enableShutdownHooks();

  const handleTermination = async (signal: string) => {
    logger.log(`Received ${signal}. Gracefully terminating Speaking Worker...`);
    try {
      await app.close();
      logger.log('Speaking Worker terminated gracefully.');
      process.exit(0);
    } catch (err: any) {
      logger.error(
        `Error during Speaking Worker shutdown: ${err.message}`,
        err.stack,
      );
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => {
    void handleTermination('SIGTERM');
  });
  process.on('SIGINT', () => {
    void handleTermination('SIGINT');
  });
  process.on('message', (msg) => {
    if (msg === 'SIGTERM' || msg === 'SIGINT') {
      void handleTermination(msg);
    }
  });

  logger.log(
    'Standalone BreadTrans Speaking Worker is running and awaiting BullMQ jobs.',
  );
}

bootstrap().catch((err) => {
  console.error('Fatal error starting Speaking Worker:', err);
  process.exit(1);
});
