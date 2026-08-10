const mongoose = require('mongoose');
require('dotenv').config();
const { TenantSchema } = require('./dist/schemas/tenant.schema.js');
const { UserSchema } = require('./dist/schemas/user.schema.js');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const Tenant = mongoose.model('Tenant', TenantSchema);
  const User = mongoose.model('User', UserSchema);
  
  const user = await User.findOne({ email: 'admin@ulsesa.cmultickets.com' }).populate('tenantId');
  console.log(JSON.stringify(user.tenantId, null, 2));
  process.exit(0);
}
run();
