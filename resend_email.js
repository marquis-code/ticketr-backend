const mongoose = require('./node_modules/mongoose');
const dotenv = require('./node_modules/dotenv');

dotenv.config({ path: '/app/.env' });

async function run() {
  const targetEmail = process.argv[2];
  if (!targetEmail) {
    console.error('Please provide an email address. Example: node resend_email.js Ayomidekayla70@gmail.com');
    process.exit(1);
  }

  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/ticketr-backend');
    const db = mongoose.connection.db;

    const order = await db.collection('orders').findOne({ 
      customerEmail: { $regex: new RegExp(`^${targetEmail}$`, 'i') } 
    });

    if (!order) {
      console.log(`Order not found for email: ${targetEmail}`);
      return process.exit(1);
    }
    
    const ticket = await db.collection('tickets').findOne({ orderId: order._id });
    if (!ticket) {
      console.log('Ticket not found for this order!');
      return process.exit(1);
    }

    const event = await db.collection('events').findOne({ _id: order.eventId });
    const eventTitle = event && event.title ? event.title : 'Event';
    const eventDate = event && event.startDate ? new Date(event.startDate).toDateString() : 'TBD';

    const html = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #eaeaea; border-radius: 8px; overflow: hidden;">
        <div style="background-color: #000; color: #fff; padding: 20px; text-align: center;">
          <img src="https://res.cloudinary.com/v6cmhap8/image/upload/v1789751565/logo.png" alt="Ticketr Logo" style="height: 40px;" />
          <h1 style="margin: 10px 0 0 0; font-size: 24px;">Your Ticket is Confirmed</h1>
        </div>
        <div style="padding: 20px; background-color: #fff;">
          <p>Hi <strong>${order.customerName}</strong>,</p>
          <p>You are all set for <strong>${eventTitle}</strong>.</p>
          <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <p style="margin: 5px 0;"><strong>Ticket Number:</strong> ${ticket.ticketNumber}</p>
            <p style="margin: 5px 0;"><strong>Ticket Type:</strong> ${order.items[0].tierName}</p>
            <p style="margin: 5px 0;"><strong>Event Date:</strong> ${eventDate}</p>
          </div>
          <div style="text-align: center; margin: 30px 0;">
            <p style="font-size: 14px; color: #666; margin-bottom: 10px;">Please present this QR code at the event entrance:</p>
            <img src="https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=https://admin.ticketr.org/verify/${ticket.qrCodeHash}" alt="Ticket QR Code" style="border: 1px solid #ccc; padding: 10px; border-radius: 5px;" />
          </div>
        </div>
      </div>
    `;

    console.log(`Sending email to ${order.customerEmail}...`);

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL || 'Ticketr <tickets@ticketr.org>',
        to: order.customerEmail,
        subject: `🎟 Your Ticket for ${eventTitle} - ${ticket.ticketNumber}`,
        html: html
      })
    });
    
    const data = await response.json();
    console.log('Resend API Response:', data);
  } catch (err) {
    console.error('Error:', err);
  }
  process.exit(0);
}
run();
