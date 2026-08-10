const mongoose = require('mongoose');
require('dotenv').config();

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const events = await db.collection('events').find({}).toArray();
  const tiers = await db.collection('ticket-tiers').find({}).toArray();
  const tickettiers = await db.collection('tickettiers').find({}).toArray();
  console.log("EVENTS: ", JSON.stringify(events, null, 2));
  console.log("TICKET TIERS: ", JSON.stringify(tickettiers, null, 2));
  process.exit(0);
}
run();
