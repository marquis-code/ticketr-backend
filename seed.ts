import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import * as bcrypt from 'bcrypt';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://abahmarquis_db_user:Y7LjtjJtZrrm5qIV@ticketr.t0qfay8.mongodb.net/?appName=ticketr";

async function seed() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(MONGODB_URI);
  console.log('Connected.');

  // Import schemas implicitly by creating models
  const TenantSchema = new mongoose.Schema({}, { strict: false });
  const EventSchema = new mongoose.Schema({}, { strict: false });
  const UserSchema = new mongoose.Schema({}, { strict: false });

  const Tenant = mongoose.model('Tenant', TenantSchema);
  const Event = mongoose.model('Event', EventSchema);
  const User = mongoose.model('User', UserSchema);

  // Clear wrongly seeded events (where tenant instead of tenantId was used)
  await Event.deleteMany({ slug: { $in: ['unilag-fomo-party', 'cmul-med-dinner', 'unilag-freshers-week-past'] }});

  console.log('Creating Tenants...');
  const unilag: any = await Tenant.findOneAndUpdate(
    { slug: 'unilag' },
    { 
      name: 'UNILAG (Akoka)', 
      slug: 'unilag', 
      primaryColor: '#8b0000', 
      secondaryColor: '#ffffff',
      logoUrl: 'https://images.unsplash.com/photo-1541339907198-e08756dedf3f?w=200&h=200&fit=crop' 
    },
    { upsert: true, new: true }
  );

  const cmul: any = await Tenant.findOneAndUpdate(
    { slug: 'cmul' },
    { 
      name: 'CMUL (Idi-Araba)', 
      slug: 'cmul', 
      primaryColor: '#006400', 
      secondaryColor: '#ffffff',
      logoUrl: 'https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=200&h=200&fit=crop' 
    },
    { upsert: true, new: true }
  );

  console.log('Creating Organizers...');
  const passwordHash = await bcrypt.hash('password123', 10);
  
  await User.findOneAndUpdate(
    { email: 'admin@unilag.ticketr.org' },
    {
      name: 'UNILAG Admin',
      email: 'admin@unilag.ticketr.org',
      passwordHash,
      role: 'ORGANIZER',
      tenantId: unilag._id.toString(),
      isActive: true
    },
    { upsert: true }
  );

  await User.findOneAndUpdate(
    { email: 'admin@cmul.ticketr.org' },
    {
      name: 'CMUL Admin',
      email: 'admin@cmul.ticketr.org',
      passwordHash,
      role: 'ORGANIZER',
      tenantId: cmul._id.toString(),
      isActive: true
    },
    { upsert: true }
  );

  console.log('Creating Events...');

  // Event 1: UNILAG - High FOMO (Almost Sold Out)
  await Event.findOneAndUpdate(
    { slug: 'unilag-fomo-party' },
    {
      tenantId: unilag._id.toString(),
      title: 'The Akoka Turn Up (FOMO Demo)',
      slug: 'unilag-fomo-party',
      description: 'The biggest party in Akoka. Only a few spots left, hurry up!',
      bannerUrl: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=800&q=80',
      startDate: new Date(Date.now() + 86400000 * 7), // 7 days from now
      startTime: '22:00',
      location: 'UNILAG Indoor Sports Hall',
      isVirtual: false,
      status: 'PUBLISHED',
      tiers: [
        { name: 'Regular', price: 5000, capacity: 500, soldCount: 495 }, // 5 spots left! FOMO
        { name: 'VIP', price: 20000, capacity: 50, soldCount: 48 } // 2 spots left! FOMO
      ],
      promoCodes: [
        { code: 'AKOKA10', type: 'PERCENTAGE', value: 10, maxUses: 100, usedCount: 0, isActive: true }
      ]
    },
    { upsert: true }
  );

  // Event 2: CMUL - Promo Codes & Installments Demo
  await Event.findOneAndUpdate(
    { slug: 'cmul-med-dinner' },
    {
      tenantId: cmul._id.toString(),
      title: 'Medilag Annual Dinner',
      slug: 'cmul-med-dinner',
      description: 'The exclusive dinner for CMUL students. Use promo code MEDILAG25 for a discount. Installments available for VVIP!',
      bannerUrl: 'https://images.unsplash.com/photo-1511795409834-ef04bbd61622?w=800&q=80',
      startDate: new Date(Date.now() + 86400000 * 14),
      startTime: '19:00',
      location: 'LUTH Hall',
      isVirtual: false,
      status: 'PUBLISHED',
      tiers: [
        { name: 'Regular', price: 10000, capacity: 300, soldCount: 150 },
        { name: 'VVIP', price: 50000, capacity: 20, soldCount: 5 }
      ],
      promoCodes: [
        { code: 'MEDILAG25', type: 'PERCENTAGE', value: 25, maxUses: 50, usedCount: 0, isActive: true },
        { code: 'MINUS2K', type: 'FLAT', value: 2000, maxUses: 10, usedCount: 0, isActive: true }
      ]
    },
    { upsert: true }
  );

  // Event 3: UNILAG - Completed Event with Gallery
  await Event.findOneAndUpdate(
    { slug: 'unilag-freshers-week-past' },
    {
      tenantId: unilag._id.toString(),
      title: 'Freshers Week Finale (Gallery Demo)',
      slug: 'unilag-freshers-week-past',
      description: 'The event is over, but the memories remain! Check out the photo gallery.',
      bannerUrl: 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=800&q=80',
      startDate: new Date(Date.now() - 86400000 * 5), // 5 days ago
      startTime: '18:00',
      location: 'Amphi Theatre',
      isVirtual: false,
      status: 'COMPLETED', // This triggers the gallery UI on the frontend
      tiers: [
        { name: 'Standard', price: 2000, capacity: 1000, soldCount: 1000 }
      ],
      galleryImages: [
        'https://images.unsplash.com/photo-1459749411175-04bf5292ceea?w=600&q=80',
        'https://images.unsplash.com/photo-1501281668745-f7f57925c3b4?w=600&q=80',
        'https://images.unsplash.com/photo-1533174000255-16ccbca1a526?w=600&q=80',
        'https://images.unsplash.com/photo-1540039155732-6761b22cb546?w=600&q=80'
      ]
    },
    { upsert: true }
  );

  console.log('Seed complete! You can now test FOMO bars, Promo Codes, and Galleries.');
  process.exit(0);
}

seed().catch(err => {
  console.error(err);
  process.exit(1);
});
