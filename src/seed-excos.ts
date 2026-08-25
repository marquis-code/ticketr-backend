import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { OrderService } from './order/order.service';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { TicketTierDocument } from './schemas/ticket-tier.schema';
import { EventDocument } from './schemas/event.schema';
import { TenantDocument } from './schemas/tenant.schema';
import { UserDocument } from './schemas/user.schema';

const excos = [
  { name: "Korede Ridwan Temidayo", email: "Korederidwan1@gmail.com", departmentCode: "TVESA" },
  { name: "EMELA Samson Kelvin", email: "Samsonkevin111@gmail.com", departmentCode: "TVESA" },
  { name: "Lawal Ajarat Ajoke", email: "lawalajarat87@gmail.com", departmentCode: "TVESA" },
  { name: "Robert Ezekiel Nduka", email: "robertezekiel1234@gmail.com", departmentCode: "TVESA" },
  { name: "Ukadike Bright Chigozie", email: "brightchigozie801@gmail.com", departmentCode: "TVESA" },
  { name: "Micheal Peters", email: "mmpeters626@gmail.com", departmentCode: "TVESA" },
  { name: "Disu Zainab Oluwatosin", email: "zainabdisu120@gmail.com", departmentCode: "TVESA" },
  { name: "Egberongbe Nimah Mojisola", email: "egberongbenimah2020@gmail.com", departmentCode: "TVESA" },
  { name: "Fadeyi Babatunde Daud", email: "Kingfad760@gmail.com", departmentCode: "NAAES" },
  { name: "Olayinka Damilola Adesola", email: "damilolaolayinka797@gmail.com", departmentCode: "NAAES" },
  { name: "Ajide Mariam Tope", "email": "maryamajide@gmail.com", departmentCode: "NAAES" },
  { name: "Adebayo Oluwapelumi Joy", "email": "pels.adebayo@gmail.com", departmentCode: "NAAES" },
  { name: "Julius Priscilla Archengimaw", "email": "Priscillaju150@gmail.com", departmentCode: "NAAES" },
  { name: "Abioye Oluwafunmilayo", "email": "abioyef70@gmail.com", departmentCode: "NAAES" }
];

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const orderService = app.get(OrderService);
  
  const TenantModel = app.get<Model<TenantDocument>>(getModelToken('Tenant'));
  const EventModel = app.get<Model<EventDocument>>(getModelToken('Event'));
  const TicketTierModel = app.get<Model<TicketTierDocument>>(getModelToken('TicketTier'));
  const UserModel = app.get<Model<UserDocument>>(getModelToken('User'));

  const tenant = await TenantModel.findOne({ slug: 'thebig5' });
  if (!tenant) throw new Error('Tenant not found');

  const event = await EventModel.findOne({ tenantId: tenant._id });
  if (!event) throw new Error('Event not found');

  const adminUser = await UserModel.findOne({ tenantId: tenant._id });
  
  // Check if Excos tier exists
  let tier = await TicketTierModel.findOne({ eventId: event._id, name: 'Excos Ticket' });
  if (!tier) {
    tier = await TicketTierModel.create({
      eventId: event._id,
      name: 'Excos Ticket',
      description: 'Special tier for executives',
      price: 10000,
      capacity: 100,
      soldCount: 0,
      maxPerPurchase: 5,
      isActive: true, // we can set false later
      templateImageUrl: 'https://res.cloudinary.com/marquis/image/upload/v1786348758/ticketr/templates_ulsesa/TICKET-REGULAR.png'
    });
    console.log('Created Excos Ticket tier:', tier._id);
  }

  for (const exco of excos) {
    console.log(`Processing order for ${exco.name}...`);
    try {
      const orderRes = await orderService.createOrder({
        tenantId: tenant._id.toString(),
        eventId: event._id.toString(),
        customerName: exco.name,
        customerEmail: exco.email.toLowerCase().trim(),
        departmentCode: exco.departmentCode,
        items: [{
          tierId: tier._id.toString(),
          quantity: 1,
          attendees: [{ name: exco.name, email: exco.email }]
        }],
        callbackUrl: 'http://localhost'
      });

      if (orderRes.isAlreadyPaid) {
        console.log(`Order already paid for ${exco.email}`);
        continue;
      }

      const orderId = orderRes.orderId;
      console.log(`Created order ${orderId}, force approving...`);
      
      const OrderModel = app.get<Model<any>>(getModelToken('Order'));
      await OrderModel.findByIdAndUpdate(orderId, { proofOfPaymentUrl: 'https://res.cloudinary.com/marquis/image/upload/v1723200000/ticketr/receipts/mock-receipt.png' });
      
      const adminId = adminUser ? adminUser._id.toString() : null;
      await orderService.forceApproveOrder(
        orderId, 
        adminId as string, 
        { reason: 'Excos registration', bankReference: `EXCO-${Date.now()}-${exco.email}` }
      );
      console.log(`Successfully completed order for ${exco.email}`);
    } catch (err) {
      console.error(`Error processing ${exco.email}:`, err.message);
    }
  }

  console.log('Done!');
  await app.close();
}

bootstrap();
