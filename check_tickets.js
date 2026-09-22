const { MongoClient, ObjectId } = require('mongodb');

async function main() {
  const uri = "mongodb+srv://abahmarquis_db_user:Y7LjtjJtZrrm5qIV@ticketr.t0qfay8.mongodb.net/?appName=ticketr";
  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db('test');
    
    const tickets = await db.collection('tickets').find({
      orderId: "6ab247c679fb91dc10d74af1"
    }).toArray();
    
    console.log("Tickets for order 6ab247c679fb91dc10d74af1:");
    console.log(JSON.stringify(tickets, null, 2));
    
  } catch (e) {
    console.error(e);
  } finally {
    await client.close();
  }
}

main().catch(console.error);
