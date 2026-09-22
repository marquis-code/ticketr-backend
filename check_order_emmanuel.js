const { MongoClient } = require('mongodb');

async function main() {
  const uri = "mongodb+srv://abahmarquis_db_user:Y7LjtjJtZrrm5qIV@ticketr.t0qfay8.mongodb.net/?appName=ticketr";
  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db('test');
    
    // Find ticket tiers that are 100k or 50k
    const tiers = await db.collection('tickettiers').find({
      price: { $in: [100000, 50000] }
    }).toArray();
    
    console.log("\nMatching Ticket Tiers (100k or 50k):");
    console.log(JSON.stringify(tiers, null, 2));
    
    // Find latest 10 orders
    const latestOrders = await db.collection('orders').find().sort({ createdAt: -1 }).limit(10).toArray();
    console.log("\nLatest 10 Orders:");
    console.log(JSON.stringify(latestOrders, null, 2));
    
  } catch (e) {
    console.error(e);
  } finally {
    await client.close();
  }
}

main().catch(console.error);
