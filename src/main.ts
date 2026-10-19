import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import {
  WinstonModule,
  utilities as nestWinstonModuleUtilities,
} from 'nest-winston';
import * as winston from 'winston';
import { ValidationPipe } from '@nestjs/common';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { monitorEventLoopDelay } from 'node:perf_hooks';

function startPhase812RuntimeMetrics() {
  if (process.env.PHASE812_RUNTIME_METRICS !== 'true') return;

  const eventLoop = monitorEventLoopDelay({ resolution: 20 });
  eventLoop.enable();
  let previousCpu = process.cpuUsage();
  let previousAt = process.hrtime.bigint();

  const timer = setInterval(() => {
    const now = process.hrtime.bigint();
    const elapsedMicros = Number(now - previousAt) / 1_000;
    const cpu = process.cpuUsage(previousCpu);
    previousCpu = process.cpuUsage();
    previousAt = now;
    const cpuMicros = cpu.user + cpu.system;
    const memory = process.memoryUsage();

    console.log(
      `[PHASE812_RUNTIME] ${JSON.stringify({
        pid: process.pid,
        cpuPercent: Number(((cpuMicros / elapsedMicros) * 100).toFixed(2)),
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
        heapTotalBytes: memory.heapTotal,
        eventLoopP50Ms: Number((eventLoop.percentile(50) / 1e6).toFixed(3)),
        eventLoopP95Ms: Number((eventLoop.percentile(95) / 1e6).toFixed(3)),
        eventLoopMaxMs: Number((eventLoop.max / 1e6).toFixed(3)),
      })}`,
    );
    eventLoop.reset();
  }, 5000);
  timer.unref();
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
    logger: WinstonModule.createLogger({
      transports: [
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.timestamp(),
            nestWinstonModuleUtilities.format.nestLike('KLTN', {
              colors: true,
              prettyPrint: true,
            }),
          ),
        }),
      ],
    }),
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new TransformInterceptor());

  const config = new DocumentBuilder()
    .setTitle('BreadTrans API')
    .setDescription('API documentation for the BreadTrans E-Learning platform')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const documentFactory = () => SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, documentFactory);

  // ─── CORS Configuration ───────────────────────────────────────────────────
  // Development: mở toàn bộ để dễ test (localhost, tunnel URL, Vercel preview...)
  // Production: chỉ cho phép các origin trong CORS_ORIGIN (phân cách bởi dấu phẩy)
  const isDev = process.env.NODE_ENV !== 'production';

  if (isDev) {
    // Mở toàn bộ trong development — không cần quan tâm origin
    app.enableCors({ origin: true, credentials: true });
  } else {
    // Production: whitelist từ biến môi trường CORS_ORIGIN
    // Ví dụ CORS_ORIGIN=https://breadtrans.vercel.app,https://app.breadtrans.edu.vn
    const allowedOrigins = (process.env.CORS_ORIGIN ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);

    app.enableCors({
      origin: (
        origin: string | undefined,
        callback: (err: Error | null, allow?: boolean) => void,
      ) => {
        // Cho phép request không có origin (Postman, mobile app, server-to-server)
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error(`Origin "${origin}" not allowed by CORS policy`));
        }
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    });
  }

  startPhase812RuntimeMetrics();

  // Lắng nghe trên 0.0.0.0 — cần thiết để Cloudflare Tunnel / Docker kết nối được
  await app.listen(process.env.PORT ?? 3001, '0.0.0.0');
}

bootstrap().catch((err) => {
  console.error('Error starting server', err);
});
