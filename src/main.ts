import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  // The bare apex currently has no web service; www is the live storefront.
  // Normalise a stale env value so ticket emails never link to a dead host.
  if (
    process.env.FRONTEND_URL === 'https://ticketr.org' ||
    process.env.FRONTEND_URL === 'http://ticketr.org'
  ) {
    process.env.FRONTEND_URL = 'https://www.ticketr.org';
  }

  // rawBody is required so Paystack webhook signatures are verified against the
  // exact bytes Paystack signed, not a re-serialised JSON object.
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
    bodyParser: true,
  });

  const normalizeOrigin = (value: string): string => {
    let origin = value.trim().replace(/^['"]|['"]$/g, '').replace(/\/+$/, '');
    if (!origin || origin === '*') return origin;
    if (origin.startsWith('//')) origin = `https:${origin}`;
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(origin)) origin = `https://${origin}`;
    try {
      const parsed = new URL(origin);
      return `${parsed.protocol}//${parsed.host}`;
    } catch {
      return '';
    }
  };

  const configuredOrigins = (
    process.env.CORS_ORIGINS ||
    [process.env.FRONTEND_URL, process.env.ADMIN_URL, process.env.SUPER_ADMIN_URL]
      .filter(Boolean)
      .join(',') ||
    ''
  )
    .split(',')
    .map(normalizeOrigin)
    .filter((origin) => origin && origin !== '*');

  // A safe baseline for a multi-tenant ticketr deployment. Tenant storefronts
  // are covered by the subdomain check below. Never fall back to `*` while
  // credentialed CORS is enabled.
  const allowedOrigins = Array.from(
    new Set([
      ...configuredOrigins,
      'https://ticketr.org',
      'https://www.ticketr.org',
      'https://admin.ticketr.org',
      'https://superadmin.ticketr.org',
      ...(process.env.NODE_ENV !== 'production'
        ? [
            'http://localhost:3001',
            'http://localhost:3002',
            'http://localhost:3003',
            'http://localhost:3004',
            'http://127.0.0.1:3001',
            'http://127.0.0.1:3002',
            'http://127.0.0.1:3003',
            'http://127.0.0.1:3004',
          ]
        : []),
    ]),
  );

  app.enableCors({
    origin: (origin, callback) => {
      // SSR, curl, health checks and native clients send no Origin.
      if (!origin) return callback(null, true);

      let originHost = '';
      try {
        const parsed = new URL(origin);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          return callback(null, false);
        }
        originHost = parsed.hostname.toLowerCase();
      } catch {
        return callback(null, false);
      }

      const isAllowed =
        allowedOrigins.includes(origin.replace(/\/+$/, '')) ||
        allowedOrigins.some((allowed) => {
          try {
            const allowedHost = new URL(allowed).hostname
              .toLowerCase()
              .replace(/^www\./, '');
            return (
              originHost === allowedHost ||
              (allowedHost === 'ticketr.org' && originHost.endsWith('.ticketr.org'))
            );
          } catch {
            return false;
          }
        });

      // Never throw here: a rejected preflight must be a clean CORS rejection,
      // not an unhandled 500 for the whole API.
      return callback(null, isAllowed);
    },
    credentials: true,
    optionsSuccessStatus: 204,
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
