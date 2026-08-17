const { MongoClient } = require('mongodb');
async function run() {
  const uri = "mongodb+srv://abahmarquis_db_user:Y7LjtjJtZrrm5qIV@ticketr.t0qfay8.mongodb.net/?appName=ticketr";
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const adminDb = client.db('admin');
    const dbs = await adminDb.admin().listDatabases();
    console.log("Databases:");
    dbs.databases.forEach(db => console.log(` - ${db.name}`));
    
    // Check ticketr or test
    for (const dbInfo of dbs.databases) {
      if (dbInfo.name === 'admin' || dbInfo.name === 'local') continue;
      const db = client.db(dbInfo.name);
      const order = await db.collection('orders').findOne({ orderNumber: 'CMT-MSVXMVDG-OMDZ' });
      if (order) {
        console.log(`Found order in DB: ${dbInfo.name}`);
        const res = await db.collection('orders').deleteOne({ _id: order._id });
        console.log(`Deleted ${res.deletedCount} orders from ${dbInfo.name}`);
      }
    }
  } catch (err) {
    console.error(err);
  } finally {
    await client.close();
  }
}
run();
