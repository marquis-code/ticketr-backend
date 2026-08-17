const { MongoClient } = require('mongodb');
async function run() {
  const uri = "mongodb+srv://abahmarquis_db_user:Y7LjtjJtZrrm5qIV@ticketr.t0qfay8.mongodb.net/?appName=ticketr";
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db('test');
    const orders = await db.collection('orders').find({ customerName: { $regex: /Ogunmola Babalola/i } }).toArray();
    console.log(`Found ${orders.length} orders for Ogunmola Babalola:`);
    orders.forEach(o => console.log(` - ID: ${o._id}, Num: ${o.orderNumber}, Status: ${o.status}`));
  } catch (err) {
    console.error(err);
  } finally {
    await client.close();
  }
}
run();
