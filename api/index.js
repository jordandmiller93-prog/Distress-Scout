// Vercel serverless entry — wraps the Express app.
require('./_env');
module.exports = require('../server');
