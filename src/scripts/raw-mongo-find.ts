import * as mongoose from 'mongoose';
import * as dotenv from 'dotenv';

dotenv.config();

const orderSchema = new mongoose.Schema({
  orderNumber: String,
  paystackReference: String,
  customerEmail: String,
  status: String,
  items: Array,
});

const ticketSchema = new mongoose.Schema({
  orderId: String,
  attendeeEmail: String,
});

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/tix-booking');
  console.log('Connected to MongoDB');

  const OrderModel = mongoose.model('Order', orderSchema);
  const TicketModel = mongoose.model('Ticket', ticketSchema);

  const paidOrders = await OrderModel.find({ status: 'PAID' }).exec();
  console.log(`Found ${paidOrders.length} PAID orders.`);

  let missingCount = 0;
  for (const order of paidOrders) {
    if (!order.items || order.items.length === 0) continue;
    
    const existingTickets = await TicketModel.find({ orderId: order._id }).exec();
    const expectedTicketCount = order.items.reduce((sum: number, item: any) => sum + item.quantity, 0);
    
    if (existingTickets.length < expectedTicketCount) {
      console.log(`Order ${order.orderNumber} (Ref: ${order.paystackReference}) has ${existingTickets.length}/${expectedTicketCount} tickets. Email: ${order.customerEmail}`);
      missingCount++;
    }
  }

  console.log(`Total missing orders: ${missingCount}`);
  await mongoose.disconnect();
}

main().catch(console.error);
