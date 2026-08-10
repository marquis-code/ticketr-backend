const mongoose = require('mongoose');
const cloudinary = require('cloudinary').v2;
require('dotenv').config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  
  // Update Tenant Name
  await db.collection('tenants').updateOne(
    { slug: 'thebig5' },
    { $set: { name: 'The Big 5' } }
  );

  // Upload image
  const result = await cloudinary.uploader.upload('/Users/marquis/tix-booking/cover-dinner-image.jpeg', {
    folder: 'ticketr/templates_ulsesa'
  });
  
  console.log('Uploaded to cloudinary:', result.secure_url);
  
  // Find tenant ID
  const tenant = await db.collection('tenants').findOne({ slug: 'thebig5' });
  if (tenant) {
    // Update Event
    await db.collection('events').updateOne(
      { tenantId: tenant._id.toString() }, // might be ObjectId
      { $set: { bannerUrl: result.secure_url } }
    );
    // Try ObjectId if string failed
    await db.collection('events').updateOne(
      { tenantId: tenant._id },
      { $set: { bannerUrl: result.secure_url } }
    );
    console.log('Event updated!');
  }
  
  process.exit(0);
}
run();
