import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { OrderService } from '../order/order.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const orderService = app.get(OrderService);

  const refs = ['CMT-MT4GIQ1N-9H39', 'CMT-MT4W21MK-U33K'];

  for (const ref of refs) {
    try {
      console.log(`Fulfilling order ${ref}...`);
      await orderService.verifyAndFulfillOrder(`FORCE-PAID-${ref}`);
      console.log(`Success for ${ref}`);
    } catch (err) {
      console.error(`Error for ${ref}:`, err.message);
    }
  }
  
  await app.close();
}

bootstrap();
