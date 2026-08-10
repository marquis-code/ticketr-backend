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
        /^https?:\/\/ticketr\.org$/,
        /^https?:\/\/www\.ticketr\.org$/,
        /^https?:\/\/[a-zA-Z0-9-]+\.ticketr\.org$/, // all dynamic subdomains
        /^https?:\/\/ticketr-admin\.onrender\.com$/,
        /^https?:\/\/ticketr-superadmin\.onrender\.com$/,
      ];

      const isAllowed = allowedDomains.some((regex) => regex.test(origin));
      if (isAllowed) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
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
