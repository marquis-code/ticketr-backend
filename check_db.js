const { MongoClient } = require('mongodb');
const uri = "mongodb+srv://abahmarquis_db_user:Y7LjtjJtZrrm5qIV@ticketr.t0qfay8.mongodb.net/?appName=ticketr";
const client = new MongoClient(uri);

async function run() {
  try {
    await client.connect();
    const db = client.db('test');
    const tenant = await db.collection('tenants').findOne({ slug: 'thebig5' });
    console.log("Payment Method is:", tenant.paymentMethod);
  } finally {
    await client.close();
  }
}
run().catch(console.dir);
