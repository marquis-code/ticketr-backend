require('dotenv').config();
const mongoose = require('mongoose');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || "mongodb://localhost:27017/ticketr-backend");
  console.log('Connected to DB');

  const db = mongoose.connection.db;
  
  // Find users with tenantId as string "partywithifyzzyandcee63"
  const users = await db.collection("users").find({ tenantId: "partywithifyzzyandcee63" }).toArray();
  console.log('Users with invalid tenantId:', users.length);
  
  if (users.length > 0) {
    const tenant = await db.collection("tenants").findOne({ slug: "partywithifyzzyandcee63" });
    if (tenant) {
      console.log('Found tenant, updating users...', tenant._id);
      await db.collection("users").updateMany(
        { tenantId: "partywithifyzzyandcee63" },
        { $set: { tenantId: tenant._id } }
      );
      console.log('Fixed users.');
    } else {
      console.log('Tenant not found. Unsetting tenantId...');
      await db.collection("users").updateMany(
        { tenantId: "partywithifyzzyandcee63" },
        { $unset: { tenantId: "" } }
      );
      console.log('Fixed users by unsetting.');
    }
  }

  process.exit(0);
}

run().catch(console.error);
