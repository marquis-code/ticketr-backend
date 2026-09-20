require('dotenv').config();
const mongoose = require('mongoose');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || "mongodb://localhost:27017/ticketr-backend");
  console.log('Connected to DB');

  const db = mongoose.connection.db;
  const orderNumber = "CMT-MU72583C-7KQ5";

  // Find the order
  const order = await db.collection("orders").findOne({ orderNumber });
  if (!order) {
    console.log(`Order ${orderNumber} not found.`);
    process.exit(0);
  }

  console.log(`Found Order: ${order._id}`);

  // Delete tickets associated with this order
  const delTix = await db.collection("tickets").deleteMany({ orderId: order._id });
  console.log(`Deleted ${delTix.deletedCount} tickets associated with the order.`);

  // Delete the order itself
  const delOrder = await db.collection("orders").deleteOne({ _id: order._id });
  console.log(`Deleted ${delOrder.deletedCount} order.`);

  // (Optional) Delete email logs associated with this order to clean up completely
  // The metadata in email-log usually stores payload.ticketNumber or similar. We can leave this or delete by recipientEmail if we want.
  // We'll leave email logs as they are harmless and good for audit trails.

  console.log('Successfully removed the order and its tickets. The total revenue will now recalculate properly.');
  
  process.exit(0);
}

run().catch(console.error);
