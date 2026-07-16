const dotenv = require('dotenv');
dotenv.config();

const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');
const multer = require('multer');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const Anthropic = require('@anthropic-ai/sdk');
const db = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-in-production';
const JWT_EXPIRY = '30d';

const app = express();
app.use(cors());

// Stripe webhook needs the raw body for signature verification — register before express.json()
app.post('/api/webhook/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];

  try {
    const event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const userId = session.metadata?.userId;
      if (userId) db.setTier(userId, 'premium', session.customer);
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(400).send('Webhook Error');
  }
});

app.use(express.json());

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const client = new Anthropic();

// ============ DISTRESS DETECTION WITH CLAUDE API ============
async function analyzePropertyImage(imageBuffer, address = '', mimeType = 'image/jpeg') {
  try {
    const base64Image = imageBuffer.toString('base64');

    const message = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mimeType,
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

    const responseText = message.content.find((b) => b.type === 'text')?.text || '';
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    let analysis = JSON.parse(jsonMatch ? jsonMatch[0] : responseText);

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

// ============ AUTH ============
function issueToken(user) {
  return jwt.sign({ sub: user.userId, email: user.email }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = db.getUser(payload.sub);
    if (!req.user) return res.status(401).json({ error: 'User not found' });
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

app.post('/api/auth/signup', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (db.getUserByEmail(email)) return res.status(409).json({ error: 'An account with this email already exists. Try logging in.' });

  const passwordHash = await bcrypt.hash(password, 10);
  const user = db.createUser({ userId: `user_${crypto.randomUUID()}`, email, passwordHash });

  res.json({ userId: user.userId, tier: user.tier, token: issueToken(user), message: 'Welcome to Distress Scout!' });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const user = db.getUserByEmail(email);
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  res.json({ userId: user.userId, tier: user.tier, token: issueToken(user) });
});

app.get('/api/me', authRequired, (req, res) => {
  const { passwordHash, ...user } = req.user;
  res.json(user);
});

// ============ DISTRESS SCAN ENDPOINT ============
app.post('/api/scan', authRequired, upload.single('image'), async (req, res) => {
  try {
    const { address, latitude, longitude } = req.body;
    const user = req.user;

    if (!req.file) return res.status(400).json({ error: 'Missing image' });

    if (user.scansThisMonth >= TIERS[user.tier].scansPerMonth) {
      return res.status(429).json({
        error: 'Monthly scan limit reached',
        limit: TIERS[user.tier].scansPerMonth,
        tier: user.tier,
        upgradeUrl: '/pricing'
      });
    }

    // Analyze image with Claude; fall back to a placeholder result when the
    // API is unreachable or the key is invalid so the app stays usable
    const analysis = await analyzePropertyImage(req.file.buffer, address, req.file.mimetype);

    const analysisResult = analysis.success
      ? { ...analysis.analysis, aiAnalysis: true }
      : { ...analysis.fallback, aiAnalysis: false, aiError: analysis.error };

    const ownerInfo = await lookupOwnerInfo(address || 'Unknown');

    const scanId = `scan_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const scan = {
      scanId,
      userId: user.userId,
      address: address || 'Address Pending',
      coordinates: { latitude, longitude },
      ...analysisResult,
      ownerInfo,
      createdAt: new Date().toISOString()
    };

    db.saveScan(scan);
    db.incrementScans(user.userId);

    res.json({
      scanId,
      success: true,
      data: scan,
      remaining: TIERS[user.tier].scansPerMonth - user.scansThisMonth - 1
    });

  } catch (error) {
    console.error('Scan error:', error);
    res.status(500).json({ error: 'Scan processing failed' });
  }
});

// ============ LEADS MANAGEMENT ============
app.post('/api/leads', authRequired, (req, res) => {
  const { scanId } = req.body;
  const user = req.user;
  const scan = db.getScan(scanId);

  if (!scan || scan.userId !== user.userId) return res.status(404).json({ error: 'Scan not found' });

  if (user.leadsStored >= TIERS[user.tier].storageLeads) {
    return res.status(429).json({
      error: 'Lead storage limit reached',
      limit: TIERS[user.tier].storageLeads
    });
  }

  const leadId = `lead_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const lead = {
    leadId,
    ...scan,
    status: 'new',
    addedAt: new Date().toISOString()
  };

  db.saveLead(lead);

  res.json({ leadId, lead });
});

app.get('/api/leads', authRequired, (req, res) => {
  const leads = db.getLeads(req.user.userId);
  res.json({ leads, count: leads.length });
});

app.patch('/api/leads/:leadId', authRequired, (req, res) => {
  const { status } = req.body;
  const allowed = ['new', 'contacted', 'negotiating', 'under_contract', 'closed', 'dead'];

  if (!allowed.includes(status)) {
    return res.status(400).json({ error: `Status must be one of: ${allowed.join(', ')}` });
  }

  const lead = db.updateLeadStatus(req.params.leadId, req.user.userId, status);
  if (!lead) return res.status(404).json({ error: 'Lead not found' });

  res.json({ lead });
});

// ============ EXPORT ENDPOINT ============
app.get('/api/export', authRequired, (req, res) => {
  const user = req.user;

  if (user.tier === 'free' && user.exportsUsed >= TIERS.free.exportLimit) {
    return res.status(429).json({
      error: 'Export limit reached',
      limit: TIERS.free.exportLimit,
      used: user.exportsUsed
    });
  }

  const leads = db.getLeads(user.userId);

  const csvField = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const csv = [
    ['Address', 'Distress Score', 'Risk Level', 'Indicators', 'Owner', 'Phone', 'Email', 'Equity', 'Status', 'Added Date'].join(','),
    ...leads.map(lead => [
      lead.address,
      lead.distressScore,
      lead.riskLevel,
      (lead.indicators || []).join('; '),
      lead.ownerInfo?.name,
      lead.ownerInfo?.phone,
      lead.ownerInfo?.email,
      lead.ownerInfo?.equity,
      lead.status,
      lead.addedAt
    ].map(csvField).join(','))
  ].join('\n');

  db.incrementExports(user.userId);

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=distress-scout-leads.csv');
  res.send(csv);
});

// ============ STRIPE SUBSCRIPTION ============
app.post('/api/subscribe/premium', authRequired, async (req, res) => {
  const user = req.user;

  try {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { userId: user.userId }
    });

    const session = await stripe.checkout.sessions.create({
      customer: customer.id,
      mode: 'subscription',
      payment_method_types: ['card'],
      metadata: { userId: user.userId },
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

// ============ STATS ENDPOINT ============
app.get('/api/stats', authRequired, (req, res) => {
  const user = req.user;
  const leads = db.getLeads(user.userId);

  res.json({
    tier: user.tier,
    scansThisMonth: user.scansThisMonth,
    scansLimit: TIERS[user.tier].scansPerMonth,
    leadsGenerated: leads.length,
    leadsLimit: TIERS[user.tier].storageLeads,
    contactsFound: leads.filter(l => l.ownerInfo && l.ownerInfo.phone !== 'Pending skip trace...').length,
    exportsUsed: user.exportsUsed,
    exportsLimit: TIERS[user.tier].exportLimit
  });
});

// ============ HEALTH CHECK ============
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============ START SERVER ============
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Distress Scout API running on http://localhost:${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`💾 Database: SQLite (persistent)`);
  console.log(`💳 Stripe Integration: ${process.env.STRIPE_SECRET_KEY?.startsWith('sk_') && !process.env.STRIPE_SECRET_KEY.includes('your_stripe') ? 'Configured' : 'Not configured'}`);
});

module.exports = app;
