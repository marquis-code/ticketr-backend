const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
require('dotenv').config();

const UserSchema = new mongoose.Schema({
  email: String,
  passwordHash: String,
  role: String,
});

const User = mongoose.model('User', UserSchema);

async function check() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to DB');

  const credentials = [
    { email: 'ulsesa01@gmail.com', pass: 'Ulsesa01@2026!' },
    { email: 'efsaunilag@gmail.com', pass: 'Efsaunilag@2026!' },
    { email: 'emsaunilag0@gmail.com', pass: 'Emsaunilag0@2026!' },
    { email: 'naaes.universityoflagos@gmail.com', pass: 'Naaes.universityoflagos@2026!' },
    { email: 'tvesaunilag@gmail.com', pass: 'Tvesaunilag@2026!' },
  ];

  for (const cred of credentials) {
    const user = await User.findOne({ email: cred.email.toLowerCase() });
    if (!user) {
      console.log(`User ${cred.email} NOT FOUND in database.`);
    } else {
      const isValid = await bcrypt.compare(cred.pass, user.passwordHash);
      console.log(`User ${cred.email} found. Password matches? ${isValid}`);
    }
  }
  mongoose.disconnect();
}
check().catch(console.error);
