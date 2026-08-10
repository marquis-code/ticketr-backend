import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) {
        return callback(null, true);
      }
      const allowedDomains = [
        /^https?:\/\/localhost(:\d+)?$/,
        /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
        /^https?:\/\/ticketr\.org$/,
        /^https?:\/\/www\.ticketr\.org$/,
        /^https?:\/\/[a-zA-Z0-9-]+\.ticketr\.org$/, // all dynamic subdomains
        /^https?:\/\/ticketr-admin\.onrender\.com$/,
        /^https?:\/\/ticketr-superadmin\.onrender\.com$/,
        'http://localhost:3001',
        'http://localhost:3002',
        'http://localhost:3003',
        'http://localhost:3001/',
        'http://localhost:3002/',
        'http://localhost:3003/',
      ];

      const isAllowed = allowedDomains.some((domain) => 
        domain instanceof RegExp ? domain.test(origin) : domain === origin
      );
      
      if (isAllowed) {
        callback(null, true);
      } else {
        callback(new Error(`Not allowed by CORS: ${origin}`));
      }
    },
    credentials: true,
  });

  app.setGlobalPrefix('api/v1');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`🚀 Ticketr API running on port ${port} (Prefix: /api/v1)`);
}
bootstrap();
