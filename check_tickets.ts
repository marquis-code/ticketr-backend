import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { getModelToken } from '@nestjs/mongoose';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const ticketModel = app.get(getModelToken('Ticket'));
  const tickets = await ticketModel.find({}).limit(10).exec();
  console.log(tickets.map(t => ({ code: t.ticketCode, dept: t.departmentCode })));
  process.exit(0);
}
bootstrap();
