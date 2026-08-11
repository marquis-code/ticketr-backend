const { MongoClient } = require('mongodb');
const uri = "mongodb+srv://abahmarquis_db_user:Y7LjtjJtZrrm5qIV@ticketr.t0qfay8.mongodb.net/?appName=ticketr";
const client = new MongoClient(uri);

async function run() {
  try {
    await client.connect();
    const db = client.db('test');
    const events = await db.collection('events').find({}).toArray();
    for (const e of events) {
      console.log(`Event Slug: ${e.slug}, Title: ${e.title}`);
    }
  } finally {
    await client.close();
  }
}
run().catch(console.dir);
