const { MongoClient, ObjectId } = require('mongodb');
async function run() {
  const uri = "mongodb+srv://abahmarquis_db_user:Y7LjtjJtZrrm5qIV@ticketr.t0qfay8.mongodb.net/?appName=ticketr";
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db('test');
    
    // Find tickets
    const orderId = new ObjectId('6a81d0dce2b70b2b137b19db');
    const tickets = await db.collection('tickets').find({ orderId: orderId }).toArray();
    console.log(`Found ${tickets.length} tickets for order`);
    
    if (tickets.length > 0) {
      const delTix = await db.collection('tickets').deleteMany({ orderId: orderId });
      console.log(`Deleted ${delTix.deletedCount} tickets.`);
    }

    // Delete order
    const res = await db.collection('orders').deleteOne({ _id: orderId });
    console.log(`Deleted ${res.deletedCount} orders.`);
  } catch (err) {
    console.error(err);
  } finally {
    await client.close();
  }
}
run();
