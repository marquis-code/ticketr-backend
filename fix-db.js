require('dotenv').config();
const mongoose = require('mongoose');

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  console.log('Connected to DB');
  
  const TicketTier = mongoose.model('TicketTier', new mongoose.Schema({}, { strict: false }));
  const result = await TicketTier.updateMany({}, { $set: { soldCount: 0 } });
  
  console.log('Update result:', result);
  
  process.exit(0);
});
