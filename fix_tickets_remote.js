const mongoose = require('./node_modules/mongoose');
const crypto = require('crypto');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/ticketr-backend');
  console.log('Connected to DB');
  const db = mongoose.connection.db;

  const chukwuOrder = await db.collection('orders').findOne({ orderNumber: 'CMT-MU70JO1L-WGWE' });
  if (chukwuOrder && chukwuOrder.totalAmount === 200000) {
    const chukwuTickets = await db.collection('tickets').find({ orderId: chukwuOrder._id }).toArray();
    if (chukwuTickets.length === 2) {
      const items = JSON.parse(JSON.stringify(chukwuOrder.items));
      items[0].quantity = 1; items[0].subtotal = 100000;
      await db.collection('orders').updateOne({ _id: chukwuOrder._id }, { $set: { totalAmount: 100000, amountPaid: 100000, items } });

      const newOrder = JSON.parse(JSON.stringify(chukwuOrder));
      delete newOrder._id;
      newOrder.orderNumber = 'CMT-MU70JO1L-WGW2';
      newOrder.totalAmount = 100000; newOrder.amountPaid = 100000;
      const res = await db.collection('orders').insertOne(newOrder);
      await db.collection('tickets').updateOne({ _id: chukwuTickets[1]._id }, { $set: { orderId: res.insertedId } });
      console.log('Split Chukwuemeka order.');
    }
  }

  const beckyOrder = await db.collection('orders').findOne({ orderNumber: 'CMT-MU786AW1-BVPX' });
  if (beckyOrder) {
    const beckyTickets = await db.collection('tickets').find({ orderId: beckyOrder._id }).toArray();
    if (beckyTickets.length === 0) {
      const qrCodeHash = crypto.randomBytes(16).toString('hex');
      const ticketNumber = 'GT/T04/EDM';
      
      const newTicket = {
        tenantId: beckyOrder.tenantId, eventId: beckyOrder.eventId,
        orderId: beckyOrder._id, tierId: beckyOrder.items[0].tierId, ticketNumber: ticketNumber,
        attendeeName: beckyOrder.customerName, attendeeEmail: beckyOrder.customerEmail,
        status: 'ISSUED', qrCodeHash: qrCodeHash, paymentStatus: 'PAID',
        createdAt: new Date(), updatedAt: new Date()
      };
      await db.collection('tickets').insertOne(newTicket);

      const event = await db.collection('events').findOne({ _id: beckyOrder.eventId });
      const eventTitle = event && event.title ? event.title : 'Event';
      const eventDate = event && event.startDate ? new Date(event.startDate).toDateString() : 'TBD';

      const html = `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #eaeaea; border-radius: 8px; overflow: hidden;">
          <div style="background-color: #000; color: #fff; padding: 20px; text-align: center;">
            <img src="https://res.cloudinary.com/v6cmhap8/image/upload/v1789751565/logo.png" alt="Ticketr Logo" style="height: 40px;" />
            <h1 style="margin: 10px 0 0 0; font-size: 24px;">Your Ticket is Confirmed</h1>
          </div>
          <div style="padding: 20px; background-color: #fff;">
            <p>Hi <strong>${beckyOrder.customerName}</strong>,</p>
            <p>You are all set for <strong>${eventTitle}</strong>.</p>
            <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <p style="margin: 5px 0;"><strong>Ticket Number:</strong> ${ticketNumber}</p>
              <p style="margin: 5px 0;"><strong>Ticket Type:</strong> ${beckyOrder.items[0].tierName}</p>
              <p style="margin: 5px 0;"><strong>Event Date:</strong> ${eventDate}</p>
            </div>
            <div style="text-align: center; margin: 30px 0;">
              <p style="font-size: 14px; color: #666; margin-bottom: 10px;">Please present this QR code at the event entrance:</p>
              <img src="https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=https://admin.ticketr.org/verify/${qrCodeHash}" alt="Ticket QR Code" style="border: 1px solid #ccc; padding: 10px; border-radius: 5px;" />
            </div>
          </div>
        </div>
      `;

      try {
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.RESEND_API_KEY }`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: process.env.RESEND_FROM_EMAIL || 'Ticketr <tickets@ticketr.org>',
            to: beckyOrder.customerEmail,
            subject: `🎟 Your Ticket for ${eventTitle} - ${ticketNumber}`,
            html: html
          })
        });
        const data = await response.json();
        console.log('Fixed Beckyweah ticket and sent email. Resend API:', data.id ? 'Success' : data);
      } catch (err) { console.error('Failed email:', err.message); }
    }
  }
  console.log('All done.');
  process.exit(0);
}
run().catch(() => process.exit(1));
