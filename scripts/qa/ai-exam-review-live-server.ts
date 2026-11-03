/**
 * The app with its real AI providers (Gemini, Cloudflare Workers AI) for the
 * live answer-review run. Start it only on the disposable harness: database
 * nx_qa on :5460, Redis :6392, port 3101, every other external service
 * blanked by the caller.
 */
// Real provider keys come from .env; dotenv never overrides the blanks the
// caller set, so every other external service stays off.
import 'dotenv/config';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from '../../src/app.module';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';
import { TransformInterceptor } from '../../src/common/interceptors/transform.interceptor';

async function bootstrap() {
  const database = process.env.DATABASE_URL ?? '';
  if (!/127\.0\.0\.1:5460\/nx_qa\b/.test(database))
    throw new Error('Refusing to start: DATABASE_URL is not the harness nx_qa');
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication({ rawBody: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new TransformInterceptor());
  app.enableCors({ origin: true, credentials: true });
  await app.listen(Number(process.env.PORT ?? 3101), '127.0.0.1');
  console.log('live answer-review server ready');
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
