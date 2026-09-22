const { MongoClient } = require('mongodb');

async function main() {
  const uri = "mongodb+srv://abahmarquis_db_user:Y7LjtjJtZrrm5qIV@ticketr.t0qfay8.mongodb.net/ticketr?appName=ticketr"; // added /ticketr
  const client = new MongoClient(uri);

  try {
    await client.connect();
    
    // Check if the order is in ticketr
    const db = client.db('ticketr'); // Force ticketr
    const orders = await db.collection('orders').find({
      $or: [
        { customerEmail: { $regex: /emmanuel/i } },
        { totalAmount: 150000 }
      ]
    }).toArray();
    
    console.log("Found in ticketr DB:");
    console.log(JSON.stringify(orders, null, 2));

    // Also check 'test' DB just in case
    const dbTest = client.db('test');
    const ordersTest = await dbTest.collection('orders').find({
      $or: [
        { customerEmail: { $regex: /emmanuel/i } },
        { totalAmount: 150000 }
      ]
    }).toArray();
    
    console.log("\nFound in test DB:");
    console.log(JSON.stringify(ordersTest, null, 2));

  } catch (e) {
    console.error(e);
  } finally {
    await client.close();
  }
}

main().catch(console.error);
