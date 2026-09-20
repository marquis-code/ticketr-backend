require('dotenv').config();
const mongoose = require('mongoose');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || "mongodb://localhost:27017/ticketr-backend");
  const db = mongoose.connection.db;
  const count = await db.collection("orders").countDocuments({ orderNumber: "CMT-MU72583C-7KQ5" });
  console.log("Count for CMT-MU72583C-7KQ5:", count);
  
  // also delete ALL of them just in case
  const res = await db.collection("orders").deleteMany({ orderNumber: "CMT-MU72583C-7KQ5" });
  console.log("Deleted", res.deletedCount);
  
  process.exit(0);
}

run().catch(console.error);
