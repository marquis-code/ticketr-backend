require('dotenv').config();
const mongoose = require('mongoose');
const { Schema } = mongoose;

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to DB');

  const Tenant = mongoose.model('Tenant', new Schema({}, { strict: false }));
  const User = mongoose.model('User', new Schema({}, { strict: false }));

  // Find the target tenant by slug
  const targetTenant = await Tenant.findOne({ slug: 'partywithifyzzyandcee63' });
  
  if (!targetTenant) {
    console.log('Target tenant not found by slug.');
    process.exit(1);
  }

  console.log(`Found tenant: ${targetTenant.name} (${targetTenant._id})`);

  // Update the admin user's tenantId to the target tenant
  await User.updateOne(
    { email: 'abahmarquis@gmail.com' },
    { $set: { tenantId: targetTenant._id } }
  );

  console.log('Successfully switched abahmarquis@gmail.com to the new tenant.');
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
