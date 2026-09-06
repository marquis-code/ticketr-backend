const { MongoClient } = require('mongodb');
require('dotenv').config();

async function run() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db();
  console.log('Deleting email logs...');
  // Delete all email logs older than 7 days, or just delete a huge chunk
  // Because it's 519MB, it's better to just drop it or delete everything to restore service immediately.
  const result = await db.collection('emaillogs').deleteMany({});
  console.log(`Deleted ${result.deletedCount} email logs.`);
  await client.close();
}
run();
