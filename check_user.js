const mongoose = require('mongoose');
require('dotenv').config();

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to DB');

  const userSchema = new mongoose.Schema({ email: String, role: String, tenantId: mongoose.Schema.Types.ObjectId });
  const User = mongoose.model('User', userSchema);

  const user = await User.findOne({ email: 'abahmarquis@gmail.com' });
  console.log(user);

  mongoose.connection.close();
}
main().catch(console.error);
