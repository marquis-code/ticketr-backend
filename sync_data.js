require('dotenv').config();
const mongoose = require('mongoose');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || "mongodb://localhost:27017/ticketr-backend");
  console.log('Connected to DB');
  const db = mongoose.connection.db;

  // --- 1. Split Chukwuemeka's 200,000 order into two 100,000 orders ---
  const chukwuOrder = await db.collection("orders").findOne({ orderNumber: "CMT-MU70JO1L-WGWE" });
  if (chukwuOrder && chukwuOrder.totalAmount === 200000) {
    console.log(`Found Chukwuemeka's order: ${chukwuOrder._id}. Splitting it...`);

    // Find the tickets belonging to this order
    const chukwuTickets = await db.collection("tickets").find({ orderId: chukwuOrder._id }).toArray();
    
    if (chukwuTickets.length === 2) {
      // Modify original order to be for 1 ticket (100,000)
      const newItems1 = JSON.parse(JSON.stringify(chukwuOrder.items));
      newItems1[0].quantity = 1;
      newItems1[0].subtotal = 100000;
      newItems1[0].attendees = [newItems1[0].attendees[0]];
      
      await db.collection("orders").updateOne(
        { _id: chukwuOrder._id },
        { $set: { totalAmount: 100000, amountPaid: 100000, items: newItems1 } }
      );

      // Create a second order for the 2nd ticket
      const newOrder = JSON.parse(JSON.stringify(chukwuOrder));
      delete newOrder._id;
      newOrder.orderNumber = "CMT-MU70JO1L-WGW2"; // Slight variation for uniqueness
      newOrder.totalAmount = 100000;
      newOrder.amountPaid = 100000;
      const newItems2 = JSON.parse(JSON.stringify(chukwuOrder.items));
      newItems2[0].quantity = 1;
      newItems2[0].subtotal = 100000;
      newItems2[0].attendees = [newItems2[0].attendees[1] || newItems2[0].attendees[0]];
      newOrder.items = newItems2;

      const result = await db.collection("orders").insertOne(newOrder);
      console.log(`Created split order: ${result.insertedId}`);

      // Reassign the second ticket to the new order
      await db.collection("tickets").updateOne(
        { _id: chukwuTickets[1]._id },
        { $set: { orderId: result.insertedId } }
      );
      console.log(`Successfully split Chukwuemeka's order into two.`);
    } else {
      console.log(`Expected 2 tickets for Chukwuemeka's order but found ${chukwuTickets.length}. Skipping split.`);
    }
  } else {
    console.log(`Chukwuemeka's order CMT-MU70JO1L-WGWE not found or already split.`);
  }

  // --- 2. Fix missing ticket for Beckyweah ---
  const beckyOrder = await db.collection("orders").findOne({ orderNumber: "CMT-MU786AW1-BVPX" });
  if (beckyOrder) {
    const beckyTickets = await db.collection("tickets").find({ orderId: beckyOrder._id }).toArray();
    if (beckyTickets.length === 0) {
      console.log(`Beckyweah has an order but no tickets. Generating ticket...`);
      
      const newTicket = {
        tenantId: beckyOrder.tenantId,
        eventId: beckyOrder.eventId,
        orderId: beckyOrder._id,
        tierId: beckyOrder.items[0].tierId,
        ticketNumber: `GT/T04/EDM`, // Assigning next available number manually for the fix
        attendeeName: beckyOrder.customerName,
        attendeeEmail: beckyOrder.customerEmail,
        status: "ISSUED",
        qrCodeHash: `ticket-${beckyOrder._id}-${Date.now()}`,
        paymentStatus: "PAID",
        createdAt: new Date(),
        updatedAt: new Date()
      };

      await db.collection("tickets").insertOne(newTicket);
      console.log(`Successfully created missing ticket for Beckyweah.`);
    } else {
      console.log(`Beckyweah already has ${beckyTickets.length} ticket(s).`);
    }
  } else {
    console.log(`Beckyweah's order not found.`);
  }

  console.log("Database synchronization complete!");
  process.exit(0);
}

run().catch(console.error);
