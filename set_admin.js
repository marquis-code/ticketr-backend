require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const { Schema } = mongoose;

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to DB');

  const User = mongoose.model('User', new Schema({}, { strict: false }));

  const email = 'abahmarquis@gmail.com';
  const plainPassword = 'password123';
  const passwordHash = await bcrypt.hash(plainPassword, 10);

  let user = await User.findOne({ email });

  if (user) {
    console.log('User found, updating role and password...');
    await User.updateOne({ email }, { $set: { role: 'SUPER_ADMIN', passwordHash } });
    console.log('User updated successfully.');
  } else {
    console.log('User not found, creating new super admin...');
    await User.create({
      name: 'Super Admin',
      email,
      passwordHash,
      role: 'SUPER_ADMIN',
      isActive: true
    });
    console.log('Super admin created successfully.');
  }

  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
