const { MongoClient } = require('mongodb');
require('dotenv').config();

async function run() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db();
  const collections = await db.collections();
  for (let c of collections) {
    try {
      const stats = await db.command({ collStats: c.collectionName });
      console.log(c.collectionName, (stats.size / 1024 / 1024).toFixed(2), 'MB');
    } catch (e) {}
  }
  await client.close();
}
run();
