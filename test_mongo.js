const mongoose = require('mongoose');
const uri = "mongodb+srv://abahmarquis_db_user:Y7LjtjJtZrrm5qIV@ticketr.t0qfay8.mongodb.net/?appName=ticketr";

async function run() {
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 3000 });
    console.log("Connected to MongoDB successfully");
    const db = mongoose.connection.db;
    const order = await db.collection('orders').findOne({ orderNumber: "CMT-MU72583C-7KQ5" });
    if (order) {
      console.log("Order found: ", order._id);
    } else {
      console.log("Order not found");
    }
    process.exit(0);
  } catch (err) {
    console.error("Connection failed:", err.message);
    process.exit(1);
  }
}
run();
