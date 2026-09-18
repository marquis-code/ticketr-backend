const mongoose = require('mongoose');
const { Schema } = mongoose;

const uri = "mongodb+srv://abahmarquis_db_user:Y7LjtjJtZrrm5qIV@ticketr.t0qfay8.mongodb.net/?appName=ticketr";

async function run() {
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  const orders = await db.collection('orders').find({ proofOfPaymentUrl: { $exists: true, $ne: '' } }).sort({ _id: -1 }).limit(10).toArray();
  console.log("Recent proofOfPaymentUrls:");
  orders.forEach(o => console.log(o.proofOfPaymentUrl));
  process.exit(0);
}
run().catch(console.error);
