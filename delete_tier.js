const { MongoClient } = require('mongodb');
require('dotenv').config();

async function run() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db();
  console.log('Deleting the specified tier...');
  
  const result = await db.collection('tickettiers').deleteMany({
    name: 'dsff'
  });
  
  console.log(`Deleted ${result.deletedCount} ticket tiers.`);
  await client.close();
}
run();
