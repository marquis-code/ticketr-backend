const mongoose = require('./node_modules/mongoose');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/ticketr-backend');
  console.log('Connected to DB');
  const db = mongoose.connection.db;

  // Find the broken order that was created as a string instead of ObjectId
  const badOrders = await db.collection('orders').find({ orderNumber: { $regex: /-B$/ } }).toArray();

  for (const badOrder of badOrders) {
    console.log(`Fixing invisible order: ${badOrder.orderNumber}`);

    const updateFields = {};

    if (typeof badOrder.eventId === 'string') {
      updateFields.eventId = new mongoose.Types.ObjectId(badOrder.eventId);
    }
    if (typeof badOrder.tenantId === 'string') {
      updateFields.tenantId = new mongoose.Types.ObjectId(badOrder.tenantId);
    }
    
    if (badOrder.items && badOrder.items.length > 0) {
      badOrder.items.forEach(item => {
        if (typeof item.tierId === 'string') item.tierId = new mongoose.Types.ObjectId(item.tierId);
        if (typeof item._id === 'string') item._id = new mongoose.Types.ObjectId(item._id);
      });
      updateFields.items = badOrder.items;
    }

    if (typeof badOrder.customer === 'string') {
        updateFields.customer = new mongoose.Types.ObjectId(badOrder.customer);
    }

    // Convert dates if they became strings
    if (typeof badOrder.createdAt === 'string') updateFields.createdAt = new Date(badOrder.createdAt);
    if (typeof badOrder.updatedAt === 'string') updateFields.updatedAt = new Date(badOrder.updatedAt);

    await db.collection('orders').updateOne(
      { _id: badOrder._id },
      { $set: updateFields }
    );
    console.log(`Successfully restored order ${badOrder.orderNumber} visibility!`);
  }

  console.log('Done restoring financials.');
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
