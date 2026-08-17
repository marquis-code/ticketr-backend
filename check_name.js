const { MongoClient } = require('mongodb');
async function run() {
  const uri = "mongodb+srv://abahmarquis_db_user:Y7LjtjJtZrrm5qIV@ticketr.t0qfay8.mongodb.net/?appName=ticketr";
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db('test');
    
    const regex = new RegExp('Junaid Abisola', 'i');
    
    const orders = await db.collection('orders').find({ customerName: { $regex: regex } }).toArray();
    console.log(`Found ${orders.length} orders for name matching 'Junaid Abisola':`);
    orders.forEach(o => console.log(` - ID: ${o._id}, Num: ${o.orderNumber}, Status: ${o.status}, Email: ${o.customerEmail}`));

    const users = await db.collection('users').find({
      $or: [
        { firstName: { $regex: regex } },
        { lastName: { $regex: regex } }
      ]
    }).toArray();
    console.log(`Found ${users.length} users for name matching 'Junaid Abisola':`);
    users.forEach(u => console.log(` - ID: ${u._id}, Name: ${u.firstName} ${u.lastName}, Email: ${u.email}`));

  } catch (err) {
    console.error(err);
  } finally {
    await client.close();
  }
}
run();
