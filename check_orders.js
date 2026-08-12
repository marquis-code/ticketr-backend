const mongoose = require('mongoose');
require('dotenv').config();

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to DB');

  const tenantSchema = new mongoose.Schema({ slug: String, name: String });
  const Tenant = mongoose.model('Tenant', tenantSchema);

  const orderSchema = new mongoose.Schema({ tenantId: mongoose.Schema.Types.ObjectId, customerName: String, status: String });
  const Order = mongoose.model('Order', orderSchema);

  const tenant = await Tenant.findOne({ slug: 'thebig5' });
  if (!tenant) {
    console.log('Tenant thebig5 not found');
  } else {
    console.log('Tenant:', tenant);
    const orders = await Order.find({ tenantId: tenant._id });
    console.log(`Found ${orders.length} orders for ${tenant.slug}`);
    console.log(orders);
  }

  mongoose.connection.close();
}
main().catch(console.error);
