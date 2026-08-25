require('dotenv').config();
const mongoose = require('mongoose');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection;
  
  // Fix TVESA
  const t01 = await db.collection('tickets').findOne({ ticketNumber: 'CT/T01/TVESA' });
  if (t01 && !t01.attendeeName.includes('(Male)')) {
    await db.collection('tickets').updateOne({ _id: t01._id }, { $set: { attendeeName: t01.attendeeName + ' (Male)' } });
    console.log("Updated T01 to Male");
  }
  
  const t04 = await db.collection('tickets').findOne({ ticketNumber: 'CT/T04/TVESA' });
  if (t04 && !t04.attendeeName.includes('(Female)')) {
    await db.collection('tickets').updateOne({ _id: t04._id }, { $set: { attendeeName: t04.attendeeName + ' (Female)' } });
    console.log("Updated T04 to Female");
  }

  // Fix ULSESA
  const t02 = await db.collection('tickets').findOne({ ticketNumber: 'CT/T02/ULSESA' });
  if (t02 && !t02.attendeeName.includes('(Male)')) {
    await db.collection('tickets').updateOne({ _id: t02._id }, { $set: { attendeeName: t02.attendeeName + ' (Male)' } });
    console.log("Updated T02 to Male");
  }

  const t03 = await db.collection('tickets').findOne({ ticketNumber: 'CT/T03/ULSESA' });
  if (t03 && !t03.attendeeName.includes('(Female)')) {
    await db.collection('tickets').updateOne({ _id: t03._id }, { $set: { attendeeName: t03.attendeeName + ' (Female)' } });
    console.log("Updated T03 to Female");
  }
  
  process.exit(0);
}
run();
