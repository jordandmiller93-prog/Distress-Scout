const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.DATABASE_FILE || path.join(__dirname, 'distress-scout.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
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
    created_at        TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS scans (
    scan_id    TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(user_id),
    data       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS leads (
    lead_id  TEXT PRIMARY KEY,
    user_id  TEXT NOT NULL REFERENCES users(user_id),
    scan_id  TEXT NOT NULL REFERENCES scans(scan_id),
    data     TEXT NOT NULL,
    status   TEXT NOT NULL DEFAULT 'new',
    added_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_leads_user ON leads(user_id);
  CREATE INDEX IF NOT EXISTS idx_scans_user ON scans(user_id);
`);

const currentMonth = () => new Date().toISOString().slice(0, 7); // YYYY-MM

function rowToUser(row) {
  if (!row) return null;
  // Roll monthly counters when the calendar month changes
  const month = currentMonth();
  if (row.scans_month !== month) {
    db.prepare('UPDATE users SET scans_month = ?, scans_this_month = 0 WHERE user_id = ?').run(month, row.user_id);
    row.scans_month = month;
    row.scans_this_month = 0;
  }
  if (row.exports_month !== month) {
    db.prepare('UPDATE users SET exports_month = ?, exports_used = 0 WHERE user_id = ?').run(month, row.user_id);
    row.exports_month = month;
    row.exports_used = 0;
  }
  return {
    userId: row.user_id,
    email: row.email,
    passwordHash: row.password_hash,
    tier: row.tier,
    scansThisMonth: row.scans_this_month,
    exportsUsed: row.exports_used,
    leadsStored: row.leads_stored,
    stripeCustomerId: row.stripe_customer_id,
    createdAt: row.created_at
  };
}

module.exports = {
  createUser({ userId, email, passwordHash }) {
    db.prepare(
      'INSERT INTO users (user_id, email, password_hash, scans_month, exports_month) VALUES (?, ?, ?, ?, ?)'
    ).run(userId, email, passwordHash, currentMonth(), currentMonth());
    return this.getUser(userId);
  },

  getUser(userId) {
    return rowToUser(db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId));
  },

  getUserByEmail(email) {
    return rowToUser(db.prepare('SELECT * FROM users WHERE email = ?').get(email));
  },

  incrementScans(userId) {
    db.prepare('UPDATE users SET scans_this_month = scans_this_month + 1 WHERE user_id = ?').run(userId);
  },

  incrementExports(userId) {
    db.prepare('UPDATE users SET exports_used = exports_used + 1 WHERE user_id = ?').run(userId);
  },

  setTier(userId, tier, stripeCustomerId = null) {
    db.prepare('UPDATE users SET tier = ?, stripe_customer_id = COALESCE(?, stripe_customer_id) WHERE user_id = ?')
      .run(tier, stripeCustomerId, userId);
  },

  saveScan(scan) {
    db.prepare('INSERT INTO scans (scan_id, user_id, data) VALUES (?, ?, ?)')
      .run(scan.scanId, scan.userId, JSON.stringify(scan));
  },

  getScan(scanId) {
    const row = db.prepare('SELECT data FROM scans WHERE scan_id = ?').get(scanId);
    return row ? JSON.parse(row.data) : null;
  },

  saveLead(lead) {
    db.prepare('INSERT INTO leads (lead_id, user_id, scan_id, data, status) VALUES (?, ?, ?, ?, ?)')
      .run(lead.leadId, lead.userId, lead.scanId, JSON.stringify(lead), lead.status || 'new');
    db.prepare('UPDATE users SET leads_stored = leads_stored + 1 WHERE user_id = ?').run(lead.userId);
  },

  getLeads(userId) {
    return db.prepare('SELECT data, status, added_at FROM leads WHERE user_id = ? ORDER BY added_at').all(userId)
      .map((row) => ({ ...JSON.parse(row.data), status: row.status, addedAt: row.added_at }));
  },

  getLead(leadId, userId) {
    const row = db.prepare('SELECT data, status, added_at FROM leads WHERE lead_id = ? AND user_id = ?').get(leadId, userId);
    return row ? { ...JSON.parse(row.data), status: row.status, addedAt: row.added_at } : null;
  },

  updateLeadStatus(leadId, userId, status) {
    const result = db.prepare('UPDATE leads SET status = ? WHERE lead_id = ? AND user_id = ?').run(status, leadId, userId);
    return result.changes > 0 ? this.getLead(leadId, userId) : null;
  }
};
