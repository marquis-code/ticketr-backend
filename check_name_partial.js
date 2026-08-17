const { MongoClient } = require('mongodb');
async function run() {
  const uri = "mongodb+srv://abahmarquis_db_user:Y7LjtjJtZrrm5qIV@ticketr.t0qfay8.mongodb.net/?appName=ticketr";
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db('test');
    
    // Check just 'Junaid' or 'Abisola' in customerName
    const orders = await db.collection('orders').find({ 
      $or: [
        { customerName: { $regex: /Junaid/i } },
        { customerName: { $regex: /Abisola/i } }
      ]
    }).toArray();
    console.log(`Found ${orders.length} orders for partial matches:`);
    orders.forEach(o => console.log(` - Num: ${o.orderNumber}, Name: ${o.customerName}, Email: ${o.customerEmail}`));

  } catch (err) {
    console.error(err);
  } finally {
    await client.close();
  }
}
run();
