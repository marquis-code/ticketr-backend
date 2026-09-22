const { MongoClient } = require('mongodb');

async function main() {
  const uri = "mongodb+srv://abahmarquis_db_user:Y7LjtjJtZrrm5qIV@ticketr.t0qfay8.mongodb.net/?appName=ticketr";
  const client = new MongoClient(uri);

  try {
    await client.connect();
    
    let databases = await client.db().admin().listDatabases();
    const dbName = databases.databases.find(d => d.name === 'test') ? 'test' : databases.databases[0].name;
    const db = client.db(dbName);
    
    const collections = await db.listCollections().toArray();
    console.log(`Collections in ${dbName}:`);
    collections.forEach(c => console.log(c.name));
    
    if (collections.some(c => c.name === 'orders')) {
        const orderDoc = await db.collection('orders').find({}).limit(5).toArray();
        console.log("\nSome Orders:");
        console.log(JSON.stringify(orderDoc, null, 2));
    }
    
  } catch (e) {
    console.error(e);
  } finally {
    await client.close();
  }
}

main().catch(console.error);
