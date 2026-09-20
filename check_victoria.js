const mongoose = require('mongoose');
require('dotenv').config({ path: __dirname + '/.env' });
async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const order = await db.collection('orders').findOne({ customerEmail: 'abidoyevictoria063@gmail.com' });
  console.log('Order:', order);
  const tickets = await db.collection('tickets').find({ orderId: order._id }).toArray();
  console.log('Tickets count:', tickets.length);
  process.exit(0);
}
run();
