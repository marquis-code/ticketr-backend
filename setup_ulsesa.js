require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  
  const Tenant = mongoose.model("Tenant", new mongoose.Schema({}, {strict: false}));
  const User = mongoose.model("User", new mongoose.Schema({}, {strict: false}));
  
  // 1. Update ULSESA Tenant
  const tenant = await Tenant.findOne({ slug: 'ulsesa' });
  if (tenant) {
    await Tenant.updateOne({ _id: tenant._id }, {
      $set: {
        customDomain: 'ulsesa.ticketr.org',
        remittanceAccount: {
          accountNumber: '9036380108',
          bankName: 'Moniepoint',
          accountName: 'Joy Sylvester Nsikanabasi'
        }
      }
    });
    console.log("Tenant ulsesa updated.");
  } else {
    console.log("Tenant ulsesa not found.");
  }

  // 2. Create User for ULSESA
  const email = 'Joysylvester200@gmail.com';
  let user = await User.findOne({ email });
  if (!user && tenant) {
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash('Password123!', salt);
    
    await User.create({
      email,
      password: hash,
      name: 'Joy Sylvester Nsikanabasi',
      role: 'ADMIN',
      tenantId: tenant._id,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    console.log(`User ${email} created for tenant ulsesa.`);
  } else {
    console.log(`User ${email} already exists or tenant not found.`);
  }

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
