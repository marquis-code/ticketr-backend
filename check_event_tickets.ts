import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { getModelToken } from '@nestjs/mongoose';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const ticketModel = app.get(getModelToken('Ticket'));
  const tickets = await ticketModel.find({ eventId: "6a795ed229b9220ed488653e" }).exec();
  console.log("Total tickets found:", tickets.length);
  if (tickets.length > 0) {
    console.log("Sample depts:", tickets.slice(0, 10).map(t => t.departmentCode));
  }
  process.exit(0);
}
bootstrap();
