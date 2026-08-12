const jwt = require('jsonwebtoken');
require('dotenv').config();
const token = jwt.sign({ sub: '6a7c109a28d978412dcfaaf8', role: 'SUPER_ADMIN', tenantId: '6a795ed129b9220ed4886533' }, process.env.JWT_SECRET || 'fallback');
console.log('Token:', token);
fetch('http://localhost:3000/api/v1/orders/tenant', {
  headers: { Authorization: `Bearer ${token}` }
}).then(res => res.text()).then(console.log).catch(console.error);
