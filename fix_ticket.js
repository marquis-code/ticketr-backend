require('dotenv').config();
const mongoose = require('mongoose');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection;
  
  const ticket = await db.collection('tickets').findOne({ ticketNumber: 'CT/T05/EDF' });
  console.log("Original ticket found:", ticket ? ticket.ticketNumber : 'Not found');
  
  if (ticket) {
     // Check if we already created a clone
     const cloneExists = await db.collection('tickets').findOne({ orderId: ticket.orderId, _id: { $ne: ticket._id } });
     if (cloneExists) {
        console.log("Clone already exists:", cloneExists.ticketNumber);
     } else {
        // Clone it
        const newTicket = { ...ticket };
        delete newTicket._id;
        newTicket.ticketNumber = 'CT/T06/EDF'; // Example or generate new
        // We'll update the name
        await db.collection('tickets').updateOne({ _id: ticket._id }, { $set: { attendeeName: ticket.attendeeName + ' (Male)' }});
        newTicket.attendeeName = ticket.attendeeName + ' (Female)';
        newTicket.qrCodeHash = require('crypto').randomBytes(32).toString('hex');
        
        await db.collection('tickets').insertOne(newTicket);
        console.log("Created second ticket:", newTicket.ticketNumber);
     }
  }
  process.exit(0);
}
run();
