require('dotenv').config();
const mongoose = require('mongoose');
const { Schema } = mongoose;

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  console.log('Connected to DB');
  
  const Ticket = mongoose.model('Ticket', new Schema({}, { strict: false }));
  const Event = mongoose.model('Event', new Schema({}, { strict: false }));
  
  const tenantId = '6a795ed129b9220ed4886533';
  const eventId = '6a795ed229b9220ed488653e';
  
  const ticketsByTenant = await Ticket.countDocuments({ tenantId });
  const ticketsByEvent = await Ticket.countDocuments({ eventId });
  const allTickets = await Ticket.countDocuments({});
  
  console.log('Tickets by tenant:', ticketsByTenant);
  console.log('Tickets by event:', ticketsByEvent);
  console.log('All tickets in DB:', allTickets);
  
  process.exit(0);
});
