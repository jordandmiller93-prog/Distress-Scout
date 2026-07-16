const express = require('express');
const cors = require('cors');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const dotenv = require('dotenv');
const multer = require('multer');
const Anthropic = require('@anthropic-ai/sdk');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const client = new Anthropic();

// ============ DATABASE (Mock - Replace with Real DB) ============
const database = {
  users: {},
  leads: {},
  scans: {},
  subscriptions: {}
};

// ============ DISTRESS DETECTION WITH CLAUDE API ============
async function analyzePropertyImage(imageBuffer, address = '') {
  try {
    const base64Image = imageBuffer.toString('base64');
    
    const message = await client.messages.create({
      model: "claude-opus-4-6",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/jpeg",
                data: base64Image,
              },
            },
            {
              type: "text",
              text: `Analyze this property photo for signs of distress and abandonment. Return ONLY valid JSON (no markdown, no extra text):

{
  "distressScore": <0-10 float>,
  "riskLevel": "<low|medium|high>",
  "indicators": [<list of detected issues>],
  "summary": "<brief assessment>",
  "investmentPotential": "<description>"
}

Look for: boarded windows, roof damage, overgrown yard, peeling paint, junk piles, abandoned signs, broken windows/doors, visible mold/water damage, foundation issues.`
            }
          ],
        }
      ],
    });

    // Parse Claude's response
    const responseText = message.content[0].type === 'text' ? message.content[0].text : '';
    let analysis = JSON.parse(responseText);
    
    return {
      success: true,
      analysis,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error('CV Analysis Error:', error);
    return {
      success: false,
      error: error.message,
      fallback: {
        distressScore: 6.2,
        riskLevel: 'medium',
        indicators: ['requires_inspection'],
        summary: 'Property needs closer inspection'
      }
    };
  }
}

// ============ OWNER LOOKUP (Mock - Integrate Real Skip Trace Service) ============
async function lookupOwnerInfo(address) {
  // In production: Call Trestle API, BeenVerified API, or county records
  // For now: Mock response
  
  const mockOwners = {
    '123 Main St': {
      name: 'John Smith',
      phone: '555-0101',
      email: 'john.smith@email.com',
      equity: '$85,000',
      liens: 0,
      taxDelinquent: false
    },
    '456 Oak Ave': {
      name: 'Estate Holdings LLC',
      phone: '555-0102',
      email: 'contact@estateholdings.com',
      equity: '$120,000',
      liens: 1,
      taxDelinquent: false
    },
    default: {
      name: 'Owner Info Processing',
      phone: 'Pending skip trace...',
      email: 'contact_pending@example.com',
      equity: 'Analyzing...',
      liens: null,
      taxDelinquent: null
    }
  };

  return mockOwners[address] || mockOwners.default;
}

// ============ FREEMIUM LIMITS ============
const TIERS = {
  free: {
    scansPerMonth: 20,
    storageLeads: 50,
    exportLimit: 5,
    price: 0
  },
  premium: {
    scansPerMonth: 500,
    storageLeads: 5000,
    exportLimit: 'unlimited',
    price: 2900, // $29.00 in cents
    stripeProductId: 'prod_distress_scout_premium'
  }
};

// ============ AUTH & USER MANAGEMENT ============
app.post('/api/auth/signup', (req, res) => {
  const { email } = req.body;
  
  if (!email) return res.status(400).json({ error: 'Email required' });
  
  // Simple JWT would be used in production
  const userId = Buffer.from(email).toString('base64');
  
  database.users[userId] = {
    userId,
    email,
    tier: 'free',
    createdAt: new Date(),
    scansThisMonth: 0,
    leadsStored: 0,
    exportsUsed: 0
  };

  database.subscriptions[userId] = {
    tier: 'free',
    status: 'active',
    renewalDate: null
  };

  res.json({ userId, tier: 'free', message: 'Welcome to Distress Scout!' });
});

app.get('/api/user/:userId', (req, res) => {
  const user = database.users[req.params.userId];
  if (!user) return res.status(404).json({ error: 'User not found' });
  
  const subscription = database.subscriptions[req.params.userId];
  res.json({ ...user, subscription });
});

// ============ DISTRESS SCAN ENDPOINT ============
app.post('/api/scan', upload.single('image'), async (req, res) => {
  try {
    const { userId, address, latitude, longitude } = req.body;
    
    if (!userId || !req.file) {
      return res.status(400).json({ error: 'Missing userId or image' });
    }

    // Check freemium limits
    const user = database.users[userId];
    const tier = database.subscriptions[userId]?.tier || 'free';
    
    if (user.scansThisMonth >= TIERS[tier].scansPerMonth) {
      return res.status(429).json({ 
        error: 'Monthly scan limit reached',
        limit: TIERS[tier].scansPerMonth,
        tier: tier,
        upgradeUrl: '/pricing'
      });
    }

    // Analyze image with Claude
    const analysis = await analyzePropertyImage(req.file.buffer, address);
    
    if (!analysis.success) {
      return res.status(500).json({ error: 'Image analysis failed', details: analysis.error });
    }

    // Lookup owner info
    const ownerInfo = await lookupOwnerInfo(address || 'Unknown');

    // Create scan record
    const scanId = `scan_${Date.now()}`;
    const scan = {
      scanId,
      userId,
      address: address || 'Address Pending',
      coordinates: { latitude, longitude },
      ...analysis.analysis,
      ownerInfo,
      createdAt: new Date()
    };

    database.scans[scanId] = scan;
    
    // Increment usage
    user.scansThisMonth += 1;

    res.json({
      scanId,
      success: true,
      data: scan,
      remaining: TIERS[tier].scansPerMonth - user.scansThisMonth
    });

  } catch (error) {
    console.error('Scan error:', error);
    res.status(500).json({ error: 'Scan processing failed' });
  }
});

// ============ LEADS MANAGEMENT ============
app.post('/api/leads', (req, res) => {
  const { userId, scanId } = req.body;
  const scan = database.scans[scanId];
  
  if (!scan) return res.status(404).json({ error: 'Scan not found' });
  
  const user = database.users[userId];
  const tier = database.subscriptions[userId]?.tier || 'free';
  
  if (user.leadsStored >= TIERS[tier].storageLeads) {
    return res.status(429).json({
      error: 'Lead storage limit reached',
      limit: TIERS[tier].storageLeads
    });
  }

  const leadId = `lead_${Date.now()}`;
  const lead = {
    leadId,
    userId,
    ...scan,
    status: 'new',
    addedAt: new Date()
  };

  if (!database.leads[userId]) database.leads[userId] = [];
  database.leads[userId].push(lead);
  user.leadsStored += 1;

  res.json({ leadId, lead });
});

app.get('/api/leads/:userId', (req, res) => {
  const leads = database.leads[req.params.userId] || [];
  res.json({ leads, count: leads.length });
});

app.patch('/api/leads/:leadId', (req, res) => {
  const { status } = req.body;
  
  // Find and update lead across all users
  for (const userId in database.leads) {
    const lead = database.leads[userId].find(l => l.leadId === req.params.leadId);
    if (lead) {
      lead.status = status;
      return res.json({ lead });
    }
  }
  
  res.status(404).json({ error: 'Lead not found' });
});

// ============ EXPORT ENDPOINT ============
app.get('/api/export/:userId', (req, res) => {
  const user = database.users[req.params.userId];
  const tier = database.subscriptions[req.params.userId]?.tier || 'free';
  
  if (!user) return res.status(404).json({ error: 'User not found' });
  
  if (tier === 'free' && user.exportsUsed >= TIERS.free.exportLimit) {
    return res.status(429).json({
      error: 'Export limit reached',
      limit: TIERS.free.exportLimit,
      used: user.exportsUsed
    });
  }

  const leads = database.leads[req.params.userId] || [];
  
  // Generate CSV
  const csv = [
    ['Address', 'Distress Score', 'Risk Level', 'Owner', 'Phone', 'Email', 'Status', 'Added Date'].join(','),
    ...leads.map(lead => [
      lead.address,
      lead.distressScore,
      lead.riskLevel,
      lead.ownerInfo?.name,
      lead.ownerInfo?.phone,
      lead.ownerInfo?.email,
      lead.status,
      lead.addedAt
    ].map(field => `"${field || ''}"`.replace(/"/g, '""')).join(','))
  ].join('\n');

  user.exportsUsed += 1;

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=distress-scout-leads.csv');
  res.send(csv);
});

// ============ STRIPE SUBSCRIPTION ============
app.post('/api/subscribe/premium', async (req, res) => {
  const { userId, email } = req.body;
  
  try {
    // Create Stripe customer
    const customer = await stripe.customers.create({
      email,
      metadata: { userId }
    });

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customer.id,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'Distress Scout Premium',
            description: '500 scans/month • Unlimited lead storage • Advanced exports'
          },
          recurring: {
            interval: 'month',
            interval_count: 1
          },
          unit_amount: TIERS.premium.price
        },
        quantity: 1
      }],
      success_url: `${process.env.APP_URL}/dashboard?upgrade=success`,
      cancel_url: `${process.env.APP_URL}/pricing`
    });

    res.json({ checkoutUrl: session.url, sessionId: session.id });

  } catch (error) {
    console.error('Stripe error:', error);
    res.status(500).json({ error: 'Payment setup failed' });
  }
});

app.post('/api/webhook/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  
  try {
    const event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const userId = session.metadata?.userId || Buffer.from(session.customer_email).toString('base64');
      
      // Upgrade user to premium
      if (database.subscriptions[userId]) {
        database.subscriptions[userId].tier = 'premium';
        database.subscriptions[userId].stripeCustomerId = session.customer;
        database.subscriptions[userId].renewalDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      }
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(400).send('Webhook Error');
  }
});

// ============ STATS ENDPOINT ============
app.get('/api/stats/:userId', (req, res) => {
  const user = database.users[req.params.userId];
  const leads = database.leads[req.params.userId] || [];
  const tier = database.subscriptions[req.params.userId]?.tier || 'free';
  
  if (!user) return res.status(404).json({ error: 'User not found' });
  
  res.json({
    tier,
    scansThisMonth: user.scansThisMonth,
    scansLimit: TIERS[tier].scansPerMonth,
    leadsGenerated: leads.length,
    leadsLimit: TIERS[tier].storageLeads,
    contactsFound: leads.filter(l => l.ownerInfo && l.ownerInfo.phone !== 'Pending skip trace...').length,
    exportsUsed: user.exportsUsed,
    exportsLimit: TIERS[tier].exportLimit
  });
});

// ============ HEALTH CHECK ============
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============ START SERVER ============
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Distress Scout API running on http://localhost:${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`💳 Stripe Integration: ${process.env.STRIPE_SECRET_KEY ? 'Configured' : 'Not configured'}`);
});

module.exports = app;
