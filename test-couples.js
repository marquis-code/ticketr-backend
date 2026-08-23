require('dotenv').config();
const mongoose = require('mongoose');
async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection;
  const tiers = await db.collection('tickettiers').find({ name: /couple/i }).toArray();
  console.log(tiers.map(t => ({ id: t._id, name: t.name, isCoupleTicket: t.isCoupleTicket })));
  process.exit(0);
}
run();
