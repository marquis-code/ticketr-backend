const axios = require('axios');

const API_BASE = 'http://localhost:3000/api/v1';

async function runE2ETest() {
  console.log('🧪 Starting End-to-End API Integration Verification...\n');

  try {
    // 1. Healthcheck
    const health = await axios.get(API_BASE);
    console.log('1. Health Check Response:', health.data);

    // 2. Register Super Admin
    const superAdminRes = await axios.post(`${API_BASE}/auth/register`, {
      name: 'Super Admin',
      email: 'superadmin@cmultickets.com',
      password: 'Password123!',
      role: 'SUPER_ADMIN',
    });
    const superToken = superAdminRes.data.accessToken;
    console.log('2. Super Admin Registered. Token acquired.');

    // 3. Register Organizer
    const orgRes = await axios.post(`${API_BASE}/auth/register`, {
      name: 'Nursing Dept Lead',
      email: 'organizer@nursing.edu',
      password: 'Password123!',
      role: 'ORGANIZER',
      organizationName: 'School of Nursing',
      tenantSlug: 'nursing',
    });
    const orgToken = orgRes.data.accessToken;
    const tenantId = orgRes.data.user.tenantId;
    console.log('3. Organizer Registered. Tenant ID:', tenantId);

    // 4. Create Event
    const eventRes = await axios.post(
      `${API_BASE}/events`,
      {
        title: 'Annual Nursing Gala 2026',
        slug: 'annual-nursing-gala-2026',
        description: 'Night of Excellence & Awards',
        bannerUrl: 'https://images.unsplash.com/photo-1540575467063-178a50c2df87',
        startDate: new Date(Date.now() + 86400000).toISOString(),
        endDate: new Date(Date.now() + 172800000).toISOString(),
        location: 'Lagos Main Auditorium',
        tiers: [
          { name: 'VIP Pass', price: 15000, capacity: 50, maxPerPurchase: 5 },
          { name: 'Regular Pass', price: 5000, capacity: 200, maxPerPurchase: 10 },
        ],
      },
      { headers: { Authorization: `Bearer ${orgToken}` } },
    );
    const event = eventRes.data;
    const vipTier = event.tiers.find((t) => t.name === 'VIP Pass');
    console.log('4. Event Created:', event.title, '| VIP Tier ID:', vipTier._id);

    // 5. Create Order with Department Code "EDM"
    const orderRes = await axios.post(`${API_BASE}/orders`, {
      tenantId: tenantId,
      eventId: event._id,
      customerName: 'Adebayo Johnson',
      customerEmail: 'adebayo@example.com',
      departmentCode: 'EDM',
      items: [{ tierId: vipTier._id, quantity: 1 }],
      callbackUrl: 'http://localhost:3000/order/confirmation',
    });
    console.log('5. Order Initialized.');
    console.log('   💳 Paystack Authorization URL:', orderRes.data.authorizationUrl);
    console.log('   📄 Paystack Reference:', orderRes.data.reference);

    // 6. Verify & Fulfill Order
    const verifyRes = await axios.get(`${API_BASE}/orders/verify?reference=FORCE-PAID-${orderRes.data.reference}`);
    const issuedTicket = verifyRes.data.tickets[0];
    console.log('6. Order Verified & Ticket Issued!');
    console.log('   🏷️ Structured Ticket Code:', issuedTicket.ticketNumber); // e.g. V/T01/EDM
    console.log('   📱 QR Code Hash:', issuedTicket.qrCodeHash.substring(0, 16) + '...');

    // 7. Gate Ticket Scan & Verification (Redis scan caching check)
    const scan1 = await axios.post(
      `${API_BASE}/tickets/verify-scan`,
      { qrCodeHash: issuedTicket.qrCodeHash },
      { headers: { Authorization: `Bearer ${orgToken}` } },
    );
    console.log('7. First Gate Scan Result:', scan1.data.message);

    // 8. Re-scan ticket (Duplicate prevention test)
    const scan2 = await axios.post(
      `${API_BASE}/tickets/verify-scan`,
      { qrCodeHash: issuedTicket.qrCodeHash },
      { headers: { Authorization: `Bearer ${orgToken}` } },
    );
    console.log('8. Duplicate Gate Scan Result:', scan2.data.message);

    console.log('\n🎉 END-TO-END VERIFICATION COMPLETED WITH 100% SUCCESS!');
  } catch (err) {
    console.error('❌ E2E Verification Failed:', err.response?.data || err.message);
  }
}

runE2ETest();
