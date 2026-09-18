const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('./dist/app.module');
const { getModelToken } = require('@nestjs/mongoose');

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const eventModel = app.get(getModelToken('Event'));
  
  const res = await eventModel.updateMany({ status: 'DRAFT' }, { $set: { status: 'PUBLISHED' } });
  console.log(`Updated ${res.modifiedCount} events to PUBLISHED status`);
  
  await app.close();
}
bootstrap();
