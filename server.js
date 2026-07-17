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

// ============ VOICE AGENT (ElevenLabs) ============
// Post-call webhook: ElevenLabs POSTs the transcript + analysis after every call.
// Raw body required for HMAC verification, so this is registered before express.json().
app.post('/api/voice/call-completed', express.raw({ type: '*/*' }), (req, res) => {
  const secret = process.env.ELEVENLABS_WEBHOOK_SECRET;
  if (!secret || secret.includes('your_')) {
    return res.status(503).json({ error: 'ELEVENLABS_WEBHOOK_SECRET not configured' });
  }

  // Verify ElevenLabs signature: header "elevenlabs-signature" = "t=<ts>,v0=<hmac>"
  try {
    const sigHeader = req.headers['elevenlabs-signature'] || '';
    const parts = Object.fromEntries(sigHeader.split(',').map((p) => p.split('=')));
    const timestamp = parts.t;
    const signature = parts.v0;
    if (!timestamp || !signature) throw new Error('missing signature');
    if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 30 * 60) throw new Error('stale timestamp');

    const expected = crypto
      .createHmac('sha256', secret)
      .update(`${timestamp}.${req.body.toString()}`)
      .digest('hex');
    const provided = signature.replace(/^v0=/, '');
    const a = Buffer.from(expected);
    const b = Buffer.from(provided);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error('bad signature');
  } catch (err) {
    console.error('Voice webhook signature rejected:', err.message);
    return res.status(401).json({ error: 'Invalid signature' });
  }

  try {
    const payload = JSON.parse(req.body.toString());
    const data = payload.data || payload;

    const phone =
      data.metadata?.phone_call?.external_number ||
      data.conversation_initiation_client_data?.dynamic_variables?.system__caller_id ||
      data.metadata?.caller_id ||
      null;

    const lead = phone ? db.findLeadByPhone(phone) : null;

    db.saveCall({
      callId: `call_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      conversationId: data.conversation_id || `conv_${Date.now()}`,
      leadId: lead?.leadId || null,
      phone,
      summary: data.analysis?.transcript_summary || null,
      successful: data.analysis?.call_successful || null,
      transcript: (data.transcript || []).map((t) => ({ role: t.role, message: t.message }))
    });

    console.log(`📞 Call logged${lead ? ` for lead ${lead.leadId}` : ' (no matching lead)'} from ${phone || 'unknown'}`);
    res.json({ received: true, matchedLead: lead?.leadId || null });
  } catch (error) {
    console.error('Voice webhook error:', error);
    res.status(400).json({ error: 'Bad payload' });
  }
});

app.use(express.json());

// Mid-call context lookup: the ElevenLabs agent calls this as a server tool to
// personalize the conversation when a seller calls in.
app.get('/api/voice/context', (req, res) => {
  const secret = process.env.ELEVENLABS_WEBHOOK_SECRET;
  if (!secret || req.headers['x-voice-secret'] !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const phone = req.query.phone || '';
  const lead = db.findLeadByPhone(phone);
  if (!lead) return res.json({ known: false });

  res.json({
    known: true,
    address: lead.address,
    ownerName: lead.ownerInfo?.name,
    distressScore: lead.distressScore,
    condition: (lead.indicators || []).join(', '),
    pipelineStatus: lead.status,
    lastOutreach: lead.smsLog?.length
      ? `SMS sent ${lead.smsLog[lead.smsLog.length - 1].sentAt}`
      : 'none recorded'
  });
});

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

// ============ OUTREACH AGENT ============
async function generateOutreach(lead) {
  const message = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 2048,
    messages: [
      {
        role: "user",
        content: `You are an expert real estate wholesaling outreach writer. Write personalized, empathetic, compliant seller outreach for this distressed property lead. Never be pushy or predatory; lead with helping the owner out of a difficult situation. Return ONLY valid JSON (no markdown):

{
  "callScript": "<a natural phone script with [PAUSE] markers and objection-handling notes, ~250 words>",
  "voicemail": "<a 20-second voicemail script>",
  "sms": "<a friendly opening text message under 160 characters, TCPA-safe tone>",
  "directMailLetter": "<a short handwritten-style letter, ~120 words>",
  "negotiationTips": ["<3-5 tips specific to this property's condition and owner situation>"]
}

Lead data:
- Address: ${lead.address}
- Distress score: ${lead.distressScore}/10 (${lead.riskLevel} risk)
- Observed condition: ${(lead.indicators || []).join(', ')}
- Assessment: ${lead.summary || 'n/a'}
- Owner: ${lead.ownerInfo?.name || 'unknown'}
- Estimated equity: ${lead.ownerInfo?.equity || 'unknown'}
- Liens: ${lead.ownerInfo?.liens ?? 'unknown'}
- Pipeline status: ${lead.status}`
      }
    ],
  });

  const text = message.content.find((b) => b.type === 'text')?.text || '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  return JSON.parse(jsonMatch ? jsonMatch[0] : text);
}

app.post('/api/leads/:leadId/outreach', authRequired, async (req, res) => {
  try {
    const lead = db.getLead(req.params.leadId, req.user.userId);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    // Return cached outreach unless a refresh is requested
    if (lead.outreach && !req.query.refresh) {
      return res.json({ outreach: lead.outreach, cached: true });
    }

    const outreach = await generateOutreach(lead);
    db.mergeLeadData(req.params.leadId, req.user.userId, {
      outreach,
      outreachGeneratedAt: new Date().toISOString()
    });

    res.json({ outreach, cached: false });
  } catch (error) {
    console.error('Outreach error:', error);
    res.status(500).json({ error: 'Outreach generation failed', details: error.message });
  }
});

app.get('/api/leads/:leadId/calls', authRequired, (req, res) => {
  const lead = db.getLead(req.params.leadId, req.user.userId);
  if (!lead) return res.status(404).json({ error: 'Lead not found' });

  const calls = db.getCallsForLead(req.params.leadId).map((c) => ({
    callId: c.call_id,
    phone: c.phone,
    summary: c.summary,
    successful: c.successful,
    transcript: JSON.parse(c.transcript || '[]'),
    at: c.created_at
  }));
  res.json({ calls, count: calls.length });
});

// ============ SMS SENDING (Twilio) ============
function getTwilioClient() {
  const { TWILIO_ACCOUNT_SID, TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET, TWILIO_PHONE_NUMBER } = process.env;
  const configured =
    TWILIO_ACCOUNT_SID?.startsWith('AC') &&
    TWILIO_API_KEY_SID?.startsWith('SK') &&
    TWILIO_API_KEY_SECRET &&
    !TWILIO_API_KEY_SECRET.includes('your_api_key') &&
    /^\+\d{10,15}$/.test(TWILIO_PHONE_NUMBER || '');

  if (!configured) return null;
  const twilio = require('twilio');
  return twilio(TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET, { accountSid: TWILIO_ACCOUNT_SID });
}

app.post('/api/leads/:leadId/send-sms', authRequired, async (req, res) => {
  try {
    const lead = db.getLead(req.params.leadId, req.user.userId);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    if (!lead.outreach?.sms) return res.status(400).json({ error: 'Generate outreach first' });

    const to = (req.body.to || '').trim();
    if (!/^\+\d{10,15}$/.test(to)) {
      return res.status(400).json({ error: 'Recipient phone must be in E.164 format, e.g. +15551234567' });
    }

    const twilioClient = getTwilioClient();
    if (!twilioClient) {
      return res.status(503).json({
        error: 'Twilio is not fully configured',
        missing: [
          !process.env.TWILIO_ACCOUNT_SID?.startsWith('AC') && 'TWILIO_ACCOUNT_SID',
          !/^\+\d{10,15}$/.test(process.env.TWILIO_PHONE_NUMBER || '') && 'TWILIO_PHONE_NUMBER',
          (!process.env.TWILIO_API_KEY_SECRET || process.env.TWILIO_API_KEY_SECRET.includes('your_api_key')) && 'TWILIO_API_KEY_SECRET'
        ].filter(Boolean)
      });
    }

    const message = req.body.message || lead.outreach.sms;
    const result = await twilioClient.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER,
      to
    });

    const smsLog = [...(lead.smsLog || []), {
      to,
      message,
      sid: result.sid,
      status: result.status,
      sentAt: new Date().toISOString()
    }];
    db.mergeLeadData(req.params.leadId, req.user.userId, { smsLog });

    res.json({ sid: result.sid, status: result.status, to });
  } catch (error) {
    console.error('SMS error:', error);
    res.status(500).json({ error: 'SMS send failed', details: error.message });
  }
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
