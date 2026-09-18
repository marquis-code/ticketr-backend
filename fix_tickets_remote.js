const mongoose = require('./node_modules/mongoose');
const crypto = require('crypto');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/ticketr-backend');
  console.log('Connected to DB');
  const db = mongoose.connection.db;

  const orders = await db.collection('orders').find({ status: 'PAID' }).toArray();
  const allTickets = await db.collection('tickets').find().toArray();
  
  let ticketCount = allTickets.length;

  for (const order of orders) {
    const orderTickets = await db.collection('tickets').find({ orderId: order._id }).toArray();
    
    // 1. Missing Tickets (Ernest, Beckyweah, etc.)
    const expectedQuantity = order.items.reduce((sum, item) => sum + item.quantity, 0);
    if (orderTickets.length < expectedQuantity) {
      console.log(`Order ${order.orderNumber} (${order.customerName}) is missing tickets! Expected ${expectedQuantity}, found ${orderTickets.length}. Fixing...`);
      
      for (let i = orderTickets.length; i < expectedQuantity; i++) {
        ticketCount++;
        const ticketNumber = `GT/T${ticketCount.toString().padStart(2, '0')}/EDM`;
        const qrCodeHash = crypto.randomBytes(16).toString('hex');
        
        const newTicket = {
          tenantId: order.tenantId, 
          eventId: order.eventId,
          orderId: order._id, 
          tierId: order.items[0].tierId, 
          ticketNumber: ticketNumber,
          attendeeName: order.customerName, 
          attendeeEmail: order.customerEmail,
          status: 'ISSUED', 
          qrCodeHash: qrCodeHash, 
          paymentStatus: 'PAID',
          createdAt: new Date(), 
          updatedAt: new Date()
        };
        await db.collection('tickets').insertOne(newTicket);
        console.log(`Created missing ticket ${ticketNumber} for ${order.customerName}`);

        // Send Email
        try {
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
                  <p style="margin: 5px 0;"><strong>Ticket Number:</strong> ${ticketNumber}</p>
                  <p style="margin: 5px 0;"><strong>Ticket Type:</strong> ${order.items[0].tierName}</p>
                  <p style="margin: 5px 0;"><strong>Event Date:</strong> ${eventDate}</p>
                </div>
                <div style="text-align: center; margin: 30px 0;">
                  <p style="font-size: 14px; color: #666; margin-bottom: 10px;">Please present this QR code at the event entrance:</p>
                  <img src="https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=https://admin.ticketr.org/verify/${qrCodeHash}" alt="Ticket QR Code" style="border: 1px solid #ccc; padding: 10px; border-radius: 5px;" />
                </div>
              </div>
            </div>
          `;

          const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${process.env.RESEND_API_KEY }`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              from: process.env.RESEND_FROM_EMAIL || 'Ticketr <tickets@ticketr.org>',
              to: order.customerEmail,
              subject: `🎟 Your Ticket for ${eventTitle} - ${ticketNumber}`,
              html: html
            })
          });
          const data = await response.json();
          console.log(`Sent email to ${order.customerEmail}. Resend API:`, data.id ? 'Success' : data);
        } catch (err) { console.error('Failed email:', err.message); }
      }
    }

    // 2. Split Chukwuemeka's 200k order into two 100k orders
    if (order.totalAmount === 200000 && expectedQuantity === 2) {
      console.log(`Splitting ${order.customerName}'s 200k order into two 100k orders...`);
      const ticketsToSplit = await db.collection('tickets').find({ orderId: order._id }).toArray();
      
      if (ticketsToSplit.length === 2) {
        // Update original order to 100k
        const items = JSON.parse(JSON.stringify(order.items));
        items[0].quantity = 1; 
        items[0].subtotal = 100000;
        await db.collection('orders').updateOne(
          { _id: order._id }, 
          { $set: { totalAmount: 100000, amountPaid: 100000, items } }
        );

        // Create new order for the second 100k
        const newOrder = JSON.parse(JSON.stringify(order));
        delete newOrder._id;
        newOrder.orderNumber = order.orderNumber + '-B'; // Append -B to make it unique
        newOrder.totalAmount = 100000; 
        newOrder.amountPaid = 100000;
        newOrder.items = items;
        
        const res = await db.collection('orders').insertOne(newOrder);
        
        // Link second ticket to the new order
        await db.collection('tickets').updateOne(
          { _id: ticketsToSplit[1]._id }, 
          { $set: { orderId: res.insertedId } }
        );
        console.log(`Successfully split ${order.customerName}'s order.`);
      }
    }
  }

  console.log('Database synced! All done.');
  process.exit(0);
}
run().catch((e) => {
  console.error(e);
  process.exit(1);
});
