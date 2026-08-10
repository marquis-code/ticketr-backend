const { v2: cloudinary } = require('cloudinary');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

async function uploadImages() {
  const imagesDir = path.join(__dirname, '../public/assets/images');
  const files = fs.readdirSync(imagesDir).filter(f => f.startsWith('carousel') && f.endsWith('.jpg'));
  const urls = [];

  for (const file of files) {
    const filePath = path.join(imagesDir, file);
    try {
      const result = await cloudinary.uploader.upload(filePath, {
        folder: 'ticketr/gallery',
      });
      urls.push(result.secure_url);
      console.log(`Uploaded ${file} -> ${result.secure_url}`);
    } catch (e) {
      console.error(`Failed to upload ${file}:`, e);
    }
  }

  console.log('\nAll Uploaded URLs:');
  console.log(JSON.stringify(urls, null, 2));
}

uploadImages();
