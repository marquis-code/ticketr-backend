import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  // rawBody is required so Paystack webhook signatures are verified against the
  // exact bytes Paystack signed, not a re-serialised JSON object.
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
    bodyParser: true,
  });

  const allowedOrigins = (
    process.env.CORS_ORIGINS ||
    [process.env.FRONTEND_URL, process.env.ADMIN_URL, process.env.SUPER_ADMIN_URL]
      .filter(Boolean)
      .join(',') ||
    ''
  )
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean);

  if (process.env.NODE_ENV !== 'production') {
    allowedOrigins.push('http://localhost:3002', 'http://localhost:3003', 'http://localhost:3004');
  }

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.length === 0) {
        // Fail closed in production rather than allowing credentialed any-origin.
        return callback(
          process.env.NODE_ENV === 'production'
            ? new Error('CORS origins are not configured')
            : null,
          process.env.NODE_ENV !== 'production',
        );
      }
      const isAllowed =
        allowedOrigins.includes(origin) ||
        allowedOrigins.some((allowed) => {
          try {
            const host = new URL(allowed).hostname.replace(/^www\./, '');
            const originHost = new URL(origin).hostname;
            return originHost === host || originHost.endsWith(`.${host}`);
          } catch {
            return false;
          }
        });
      return callback(isAllowed ? null : new Error('Origin not allowed'), isAllowed);
    },
    credentials: true,
  });

  app.setGlobalPrefix('api/v1');
  // Railway/Render terminate TLS in front of the app; without this every request
  // looks like it comes from the proxy IP and rate limits hit everyone at once.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );

  const port = process.env.PORT || 3005;
  await app.listen(port);
  console.log(`🚀 Ticketr API running on port ${port} (Prefix: /api/v1) [v2]`);
}
bootstrap();
