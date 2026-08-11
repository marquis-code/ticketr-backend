const { MongoClient } = require('mongodb');
const uri = "mongodb+srv://abahmarquis_db_user:Y7LjtjJtZrrm5qIV@ticketr.t0qfay8.mongodb.net/?appName=ticketr";
const client = new MongoClient(uri);

async function run() {
  try {
    await client.connect();
    const db = client.db('test');
    const tenants = await db.collection('tenants').find({}).toArray();
    for (const t of tenants) {
      console.log(`Slug: ${t.slug}, PaymentMethod: ${t.paymentMethod}`);
    }
  } finally {
    await client.close();
  }
}
run().catch(console.dir);
