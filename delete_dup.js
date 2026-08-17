const { MongoClient } = require('mongodb');

async function run() {
  const uri = "mongodb+srv://abahmarquis_db_user:Y7LjtjJtZrrm5qIV@ticketr.t0qfay8.mongodb.net/?appName=ticketr";
  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db();
    
    // Check if the order exists
    const order = await db.collection('orders').findOne({ orderNumber: 'CMT-MSVXMVDG-OMDZ' });
    console.log('Order found:', order ? 'Yes' : 'No');
    
    if (order) {
      const res = await db.collection('orders').deleteOne({ _id: order._id });
      console.log('Order deleted:', res.deletedCount);
    }
  } catch (err) {
    console.error(err);
  } finally {
    await client.close();
  }
}

run();
