const mongoose = require('mongoose');
require('dotenv').config();

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  
  const result = await db.collection('users').updateOne(
    { email: 'admin@ulsesa.ticketr.org' },
    { $set: { email: 'thebig5@ticketr.org' } }
  );
  
  console.log('Update email result:', result);
  process.exit(0);
}
run();
