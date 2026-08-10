const mongoose = require('mongoose');
require('dotenv').config();

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const tiers = await db.collection('tiers').find({}).toArray();
  console.log(JSON.stringify(tiers, null, 2));
  process.exit(0);
}
run();
