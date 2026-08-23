import * as mongoose from 'mongoose';
import * as jwt from 'jsonwebtoken';
import { execSync } from 'child_process';

async function run() {
  const uri = "mongodb+srv://abahmarquis_db_user:Y7LjtjJtZrrm5qIV@ticketr.t0qfay8.mongodb.net/?appName=ticketr";
  await mongoose.connect(uri);

  const ticketSchema = new mongoose.Schema({}, { strict: false });
  const Ticket = mongoose.model('Ticket', ticketSchema);
  const userSchema = new mongoose.Schema({}, { strict: false });
  const User = mongoose.model('User', userSchema);

  const admin = await User.findOne({ role: 'SUPER_ADMIN' }).exec();
  if(!admin) return;

  const tickets = await Ticket.find({ attendeeName: { $regex: /Joseph/i } }).exec();
  
  for(const t of tickets) {
      if(!t.get('attendeeName').includes('Joseph Solomon')) continue;
      
      const token = jwt.sign(
        { userId: (admin as any)._id.toString(), email: admin.get('email'), role: 'SUPER_ADMIN' },
        'super_secret_jwt_key_ticketr_2026_change_in_prod',
        { expiresIn: '1h' }
      );
      
      console.log(`Curling ticket ${t._id}`);
      
      try {
        const out = execSync(`curl -s -X POST http://localhost:3001/api/v1/tickets/${t._id}/resend-email \\
          -H "Authorization: Bearer ${token}" \\
          -H "Content-Type: application/json" \\
          -d '{"newEmail": "josephsolo2019@gmail.com"}'`).toString();
        
        console.log("CURL output:", out);
      } catch (e) {
        console.error("CURL failed", e);
      }
  }
  
  process.exit(0);
}

run();
