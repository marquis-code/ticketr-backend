import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { Model } from 'mongoose';
import { getModelToken } from '@nestjs/mongoose';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const orderModel = app.get<Model<any>>(getModelToken('Order'));

  const emails = [
    'oluwoleakanni2000@gmail.com',
    'preciousoladipupo97@gmail.com',
    'ajoy40734@gmail.com',
    'ayegbusidelaide@gmail.com'
  ];

  for (const email of emails) {
    const orders = await orderModel.find({ customerEmail: { $regex: new RegExp(`^${email}$`, 'i') } });
    console.log(`\nEmail: ${email}`);
    if (orders.length === 0) {
      console.log('  Order Status: Not found');
    } else {
      for (const o of orders) {
        console.log(`  Order ID: ${o._id}, Status: ${o.status}`);
        console.log(`  Items: ${JSON.stringify(o.items.map(i => ({ tier: i.tierName, qty: i.quantity })))}`);
      }
    }
  }

  await app.close();
  process.exit(0);
}
bootstrap();
