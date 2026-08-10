require('dotenv').config({ path: '/Users/marquis/tix-booking/backend/.env' });
const mongoose = require('mongoose');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to DB');

  const Tenant = mongoose.model("Tenant", new mongoose.Schema({}, {strict: false}), "tenants");

  // The ULSESA tenant slug
  const targetSlug = 'ulsesa';

  const emails = [
    'ulsesa01@gmail.com',
    'efsaunilag@gmail.com',
    'emsaunilag0@gmail.com',
    'naaes.universityoflagos@gmail.com'
  ];

  const result = await Tenant.updateOne(
    { slug: targetSlug },
    { $set: { notificationEmails: emails } }
  );

  console.log('Update result:', result);
  console.log('Finished updating ULSESA tenant with notification emails');
  mongoose.disconnect();
}

main().catch(console.error);
