require('dotenv').config();
const mongoose = require('mongoose');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || "mongodb://localhost:27017/ticketr-backend");
  const db = mongoose.connection.db;

  const orders = await db.collection("orders").find({ status: "PAID" }).toArray();
  console.log(`Found ${orders.length} PAID orders:`);
  for (let o of orders) {
    console.log(`- ${o.customerName} (${o.orderNumber}): ${o.totalAmount}`);
    console.log(`  Items:`, JSON.stringify(o.items));
  }

  const tickets = await db.collection("tickets").find({}).toArray();
  console.log(`\nFound ${tickets.length} tickets:`);
  for (let t of tickets) {
    console.log(`- ${t.attendeeName} (${t.ticketNumber}): OrderID ${t.orderId}`);
  }

  process.exit(0);
}

run().catch(console.error);
