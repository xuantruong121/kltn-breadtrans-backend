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

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
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

  // Lắng nghe trên 0.0.0.0 — cần thiết để Cloudflare Tunnel / Docker kết nối được
  await app.listen(process.env.PORT ?? 3001, '0.0.0.0');
}

bootstrap().catch((err) => {
  console.error('Error starting server', err);
});
