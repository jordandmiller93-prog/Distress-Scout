// Deploy to Vercel via REST API. Usage: VERCEL_TOKEN=... node deploy.js
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.VERCEL_TOKEN;
const TEAM = process.env.VERCEL_TEAM_ID || '';
if (!TOKEN) { console.error('VERCEL_TOKEN required'); process.exit(1); }

const include = [
  'package.json', 'vercel.json', 'tailwind.config.js',
  'server.js', 'db.js',
  'api/index.js', 'api/_env.js',
  'public/index.html',
  'src/index.js', 'src/index.css', 'src/DistressScoutApp.jsx'
];

const files = include.map((f) => ({
  file: f,
  data: fs.readFileSync(path.join(__dirname, f), 'utf8')
}));

(async () => {
  const qs = TEAM ? `?teamId=${TEAM}` : '';
  const res = await fetch(`https://api.vercel.com/v13/deployments${qs}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: process.env.DEPLOY_NAME || 'distress-scout',
      project: process.env.DEPLOY_PROJECT || undefined,
      target: process.env.DEPLOY_TARGET || 'production',
      files,
      projectSettings: {
        framework: 'create-react-app',
        buildCommand: 'react-scripts build',
        outputDirectory: 'build'
      }
    })
  });
  const data = await res.json();
  if (!res.ok) { console.error('DEPLOY FAILED', JSON.stringify(data, null, 2)); process.exit(1); }
  console.log('id:', data.id);
  console.log('url: https://' + data.url);
  console.log('state:', data.readyState);
})();
