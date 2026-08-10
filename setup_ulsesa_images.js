require('dotenv').config({ path: '/Users/marquis/tix-booking/backend/.env' });
const cloudinary = require('cloudinary').v2;
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

async function uploadFile(filePath) {
  try {
    const result = await cloudinary.uploader.upload(filePath, {
      folder: 'ticketr/templates_ulsesa',
      use_filename: true,
      unique_filename: false,
    });
    console.log(`Uploaded ${path.basename(filePath)} -> ${result.secure_url}`);
    return result.secure_url;
  } catch (error) {
    console.error('Error uploading:', error);
    return null;
  }
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to DB');

  const rootDir = '/Users/marquis/tix-booking';
  
  // 1. Upload Event Banner
  const bannerPath = path.join(rootDir, 'cover-dinner-image.jpeg');
  let bannerUrl = null;
  if (fs.existsSync(bannerPath)) {
    bannerUrl = await uploadFile(bannerPath);
  }

  // 2. Upload Tier Templates
  const tierFiles = {
    'Regular': 'TICKET-REGULAR.png',
    'VIP': 'TICKET-VIP.png',
    'VVIP (Table of 10)': 'TICKET-VVIP.png', // or JOINT-DINNER-TICKET.jpg?
  };

  const tierUrls = {};
  for (const [tierName, filename] of Object.entries(tierFiles)) {
    const fullPath = path.join(rootDir, filename);
    if (fs.existsSync(fullPath)) {
      tierUrls[tierName] = await uploadFile(fullPath);
    }
  }

  // 3. Update DB
  const Event = mongoose.model("Event", new mongoose.Schema({}, {strict: false}), "events");
  const TicketTier = mongoose.model("TicketTier", new mongoose.Schema({}, {strict: false}), "tickettiers");

  const eventId = new mongoose.Types.ObjectId("6a795ed229b9220ed488653e"); // The ULSESA Dinner & Awards Night

  if (bannerUrl) {
    await Event.updateOne({ _id: eventId }, { $set: { bannerUrl } });
    console.log('Updated event banner');
  }

  for (const [tierName, url] of Object.entries(tierUrls)) {
    if (url) {
      await TicketTier.updateOne({ eventId, name: tierName }, { $set: { templateImageUrl: url } });
      console.log(`Updated tier ${tierName} with template`);
    }
  }

  console.log('Finished updating ULSESA event and tiers');
  mongoose.disconnect();
}

main().catch(console.error);
