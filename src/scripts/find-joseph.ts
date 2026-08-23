import * as mongoose from 'mongoose';

async function run() {
  const uri = "mongodb+srv://abahmarquis_db_user:Y7LjtjJtZrrm5qIV@ticketr.t0qfay8.mongodb.net/?appName=ticketr";
  await mongoose.connect(uri);

  const ticketSchema = new mongoose.Schema({}, { strict: false });
  const Ticket = mongoose.model('Ticket', ticketSchema);
  const Tier = mongoose.model('TicketTier', new mongoose.Schema({}, { strict: false }));

  const tickets = await Ticket.find({ attendeeName: { $regex: /Joseph/i } }).exec();
  
  for(const t of tickets) {
      const tierId = t.get('tierId');
      const tier = await Tier.findById(tierId);
      console.log(`Found ticket ${t._id}, attendee: ${t.get('attendeeName')}, email: ${t.get('attendeeEmail')}, Tier: ${tier ? tier.get('name') : 'Unknown'}`);
  }
  
  process.exit(0);
}

run();
