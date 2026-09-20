require('dotenv').config();
const mongoose = require('mongoose');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || "mongodb://localhost:27017/ticketr-backend");
  console.log('Connected to DB');
  const db = mongoose.connection.db;

  const orders = await db.collection("orders").find({ status: "PAID" }).toArray();
  console.log(`PAID Orders:`);
  for (let o of orders) {
    console.log(`- ${o.customerName} | ${o.orderNumber} | Amt: ${o.totalAmount} | Qty: ${o.items[0]?.quantity}`);
  }

  const tickets = await db.collection("tickets").find({}).toArray();
  console.log(`\nTickets:`);
  for (let t of tickets) {
    console.log(`- ${t.attendeeName} | ${t.ticketNumber} | OrderID: ${t.orderId}`);
  }

  process.exit(0);
}

run().catch(console.error);
