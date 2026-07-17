// Database layer with two drivers behind one async API:
//  - Postgres (pg) when DATABASE_URL is set — for production (e.g. Vercel + Neon)
//  - SQLite (better-sqlite3) otherwise — for local development
const currentMonth = () => new Date().toISOString().slice(0, 7); // YYYY-MM

const USER_FIELDS = (row) => ({
  userId: row.user_id,
  email: row.email,
  passwordHash: row.password_hash,
  tier: row.tier,
  scansThisMonth: row.scans_this_month,
  exportsUsed: row.exports_used,
  leadsStored: row.leads_stored,
  stripeCustomerId: row.stripe_customer_id,
  createdAt: row.created_at
});

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    user_id           TEXT PRIMARY KEY,
    email             TEXT UNIQUE NOT NULL,
    password_hash     TEXT NOT NULL,
    tier              TEXT NOT NULL DEFAULT 'free',
    scans_month       TEXT,
    scans_this_month  INTEGER NOT NULL DEFAULT 0,
    exports_month     TEXT,
    exports_used      INTEGER NOT NULL DEFAULT 0,
    leads_stored      INTEGER NOT NULL DEFAULT 0,
    stripe_customer_id TEXT,
    created_at        TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS scans (
    scan_id    TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    data       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS leads (
    lead_id  TEXT PRIMARY KEY,
    user_id  TEXT NOT NULL,
    scan_id  TEXT NOT NULL,
    data     TEXT NOT NULL,
    status   TEXT NOT NULL DEFAULT 'new',
    added_at TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS calls (
    call_id         TEXT PRIMARY KEY,
    conversation_id TEXT UNIQUE,
    lead_id         TEXT,
    phone           TEXT,
    summary         TEXT,
    successful      TEXT,
    transcript      TEXT,
    created_at      TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_leads_user ON leads(user_id);
  CREATE INDEX IF NOT EXISTS idx_scans_user ON scans(user_id);
  CREATE INDEX IF NOT EXISTS idx_calls_lead ON calls(lead_id);
`;

const now = () => new Date().toISOString();

// ---------- driver: a minimal async query interface ----------
// query(sql, params) -> { rows }   using $1,$2,... placeholders
let query;
let ready;

// Vercel marketplace integrations name the connection string differently
// (Neon: DATABASE_URL; Vercel/Neon legacy: POSTGRES_URL variants) — accept any.
const PG_URL =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_PRISMA_URL ||
  process.env.POSTGRES_URL_NON_POOLING;

if (PG_URL) {
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: PG_URL,
    ssl: PG_URL.includes('localhost') ? false : { rejectUnauthorized: false },
    max: 3
  });
  query = (sql, params = []) => pool.query(sql, params);
  ready = (async () => {
    for (const stmt of SCHEMA.split(';').map((s) => s.trim()).filter(Boolean)) {
      await pool.query(stmt);
    }
  })();
} else {
  const Database = require('better-sqlite3');
  const path = require('path');
  const dbPath = process.env.DATABASE_FILE || path.join(__dirname, 'distress-scout.db');
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.exec(SCHEMA);
  // Translate $1,$2,... placeholders to positional ? for sqlite
  query = (sql, params = []) => {
    const translated = sql.replace(/\$(\d+)/g, '?');
    const ordered = [...sql.matchAll(/\$(\d+)/g)].map((m) => params[Number(m[1]) - 1]);
    const stmt = sqlite.prepare(translated);
    if (/^\s*select/i.test(sql) || /returning/i.test(sql)) {
      return Promise.resolve({ rows: stmt.all(...ordered) });
    }
    const info = stmt.run(...ordered);
    return Promise.resolve({ rows: [], changes: info.changes });
  };
  ready = Promise.resolve();
}

async function rollMonthlyCounters(row) {
  if (!row) return null;
  const month = currentMonth();
  if (row.scans_month !== month) {
    await query('UPDATE users SET scans_month = $1, scans_this_month = 0 WHERE user_id = $2', [month, row.user_id]);
    row.scans_month = month;
    row.scans_this_month = 0;
  }
  if (row.exports_month !== month) {
    await query('UPDATE users SET exports_month = $1, exports_used = 0 WHERE user_id = $2', [month, row.user_id]);
    row.exports_month = month;
    row.exports_used = 0;
  }
  return USER_FIELDS(row);
}

module.exports = {
  ready,
  driver: PG_URL ? 'postgres' : 'sqlite',

  async createUser({ userId, email, passwordHash }) {
    await ready;
    await query(
      'INSERT INTO users (user_id, email, password_hash, scans_month, exports_month, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
      [userId, email, passwordHash, currentMonth(), currentMonth(), now()]
    );
    return this.getUser(userId);
  },

  async getUser(userId) {
    await ready;
    const { rows } = await query('SELECT * FROM users WHERE user_id = $1', [userId]);
    return rollMonthlyCounters(rows[0]);
  },

  async getUserByEmail(email) {
    await ready;
    const { rows } = await query('SELECT * FROM users WHERE email = $1', [email]);
    return rollMonthlyCounters(rows[0]);
  },

  async incrementScans(userId) {
    await query('UPDATE users SET scans_this_month = scans_this_month + 1 WHERE user_id = $1', [userId]);
  },

  async incrementExports(userId) {
    await query('UPDATE users SET exports_used = exports_used + 1 WHERE user_id = $1', [userId]);
  },

  async setTier(userId, tier, stripeCustomerId = null) {
    await query('UPDATE users SET tier = $1, stripe_customer_id = COALESCE($2, stripe_customer_id) WHERE user_id = $3',
      [tier, stripeCustomerId, userId]);
  },

  async saveScan(scan) {
    await query('INSERT INTO scans (scan_id, user_id, data, created_at) VALUES ($1, $2, $3, $4)',
      [scan.scanId, scan.userId, JSON.stringify(scan), now()]);
  },

  async getScan(scanId) {
    const { rows } = await query('SELECT data FROM scans WHERE scan_id = $1', [scanId]);
    return rows[0] ? JSON.parse(rows[0].data) : null;
  },

  async saveLead(lead) {
    await query('INSERT INTO leads (lead_id, user_id, scan_id, data, status, added_at) VALUES ($1, $2, $3, $4, $5, $6)',
      [lead.leadId, lead.userId, lead.scanId, JSON.stringify(lead), lead.status || 'new', now()]);
    await query('UPDATE users SET leads_stored = leads_stored + 1 WHERE user_id = $1', [lead.userId]);
  },

  async getLeads(userId) {
    const { rows } = await query('SELECT data, status, added_at FROM leads WHERE user_id = $1 ORDER BY added_at', [userId]);
    return rows.map((row) => ({ ...JSON.parse(row.data), status: row.status, addedAt: row.added_at }));
  },

  async getLead(leadId, userId) {
    const { rows } = await query('SELECT data, status, added_at FROM leads WHERE lead_id = $1 AND user_id = $2', [leadId, userId]);
    return rows[0] ? { ...JSON.parse(rows[0].data), status: rows[0].status, addedAt: rows[0].added_at } : null;
  },

  async mergeLeadData(leadId, userId, patch) {
    const { rows } = await query('SELECT data FROM leads WHERE lead_id = $1 AND user_id = $2', [leadId, userId]);
    if (!rows[0]) return null;
    const data = { ...JSON.parse(rows[0].data), ...patch };
    await query('UPDATE leads SET data = $1 WHERE lead_id = $2 AND user_id = $3', [JSON.stringify(data), leadId, userId]);
    return this.getLead(leadId, userId);
  },

  async updateLeadStatus(leadId, userId, status) {
    const result = await query('UPDATE leads SET status = $1 WHERE lead_id = $2 AND user_id = $3', [status, leadId, userId]);
    const changed = result.changes !== undefined ? result.changes > 0 : result.rowCount > 0;
    return changed ? this.getLead(leadId, userId) : null;
  },

  async saveCall({ callId, conversationId, leadId, phone, summary, successful, transcript }) {
    await query(
      `INSERT INTO calls (call_id, conversation_id, lead_id, phone, summary, successful, transcript, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (conversation_id) DO UPDATE SET
         summary = EXCLUDED.summary, successful = EXCLUDED.successful, transcript = EXCLUDED.transcript`,
      [callId, conversationId, leadId, phone, summary, successful, JSON.stringify(transcript || []), now()]
    );
  },

  async getCallsForLead(leadId) {
    const { rows } = await query('SELECT * FROM calls WHERE lead_id = $1 ORDER BY created_at DESC', [leadId]);
    return rows;
  },

  async findLeadByPhone(phone) {
    // Match on the last 10 digits so +1 prefixes and formatting don't matter
    const tail = phone.replace(/\D/g, '').slice(-10);
    if (tail.length < 10) return null;
    const { rows } = await query('SELECT lead_id, user_id, data FROM leads', []);
    for (const row of rows) {
      const lead = JSON.parse(row.data);
      const candidates = [
        lead.ownerInfo?.phone,
        ...(lead.smsLog || []).map((s) => s.to)
      ].filter(Boolean);
      if (candidates.some((p) => p.replace(/\D/g, '').slice(-10) === tail)) {
        return { ...lead, leadId: row.lead_id, userId: row.user_id };
      }
    }
    return null;
  }
};
