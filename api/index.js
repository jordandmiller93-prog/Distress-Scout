// Vercel serverless entry — wraps the Express app.
// _env.js only exists locally (gitignored); in git-based deploys the
// environment comes from the Vercel dashboard instead.
try {
  require('./_env');
} catch {
  process.env.DATABASE_FILE = process.env.DATABASE_FILE || '/tmp/distress-scout.db';
}
module.exports = require('../server');
