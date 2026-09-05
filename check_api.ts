import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { EventService } from './src/event/event.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const eventService = app.get(EventService);
  // eventId from screenshot: 6a795ed229b9220ed488653e
  try {
    const res = await eventService.getEventAttendees("6a795ed229b9220ed488653e", "someTenantId");
    console.log(res.attendees.metadata.statistics);
  } catch (e) {
    console.error(e.message);
  }
  process.exit(0);
}
bootstrap();
