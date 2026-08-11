import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
dotenv.config();

async function run() {
  await mongoose.connect(process.env.MONGODB_URI as string);
  const db = mongoose.connection;
  const tenant = await db.collection('tenants').findOne({ slug: 'thebig5' });
  console.log('primaryRemittanceAccount:', tenant?.primaryRemittanceAccount);
  console.log('remittanceAccount:', tenant?.remittanceAccount);
  process.exit(0);
}
run();
