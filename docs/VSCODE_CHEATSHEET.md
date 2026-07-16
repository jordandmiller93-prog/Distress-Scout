# VS Code Cheatsheet for Distress Scout

Quick reference for everything you need while coding.

---

## Setup Commands (Run Once)

```bash
# Navigate to project
cd distress-scout

# Open in VS Code
code .

# Install dependencies
npm install

# Rename .env.example to .env
# (Right-click in file explorer → Rename)

# Edit .env and add:
# ANTHROPIC_API_KEY=your_key
# STRIPE_SECRET_KEY=your_key
```

---

## Development Commands (Daily)

```bash
# Terminal 1: Start backend API (port 3001)
npm run dev

# Terminal 2: Start frontend (port 3000)
npm run client

# Both terminals running = Full app ready
# Frontend: http://localhost:3000
# Backend: http://localhost:3001
```

---

## VS Code Keyboard Shortcuts

| What | Windows/Linux | Mac |
|------|---------------|-----|
| Open terminal | Ctrl + ` | Cmd + ` |
| Create new terminal | Ctrl + Shift + ` | Cmd + Shift + ` |
| Save file | Ctrl + S | Cmd + S |
| Find text | Ctrl + F | Cmd + F |
| Find & Replace | Ctrl + H | Cmd + H |
| Go to line | Ctrl + G | Cmd + G |
| Toggle comment | Ctrl + / | Cmd + / |
| Move line up | Alt + Up | Opt + Up |
| Move line down | Alt + Down | Opt + Down |
| Duplicate line | Alt + Shift + Down | Opt + Shift + Down |
| Delete line | Ctrl + Shift + K | Cmd + Shift + K |
| Quick fix | Ctrl + . | Cmd + . |
| Format document | Ctrl + Shift + I | Cmd + Shift + I |
| Command palette | Ctrl + Shift + P | Cmd + Shift + P |
| Start debugging | F5 | F5 |

---

## File Locations & What to Edit

### Frontend Changes
**File:** `distress-scout-app.jsx`

Find & change:
- App title: `Distress Scout`
- Colors: `bg-blue-600`, `text-white`
- Pricing: `$29/month`, `$49/month`
- Limits: `20 scans`, `50 leads`
- Copy/text: Any user-facing text

Save → Frontend auto-refreshes

### Backend Changes
**File:** `server.js`

Find & change:
- API endpoints: `/api/scan`, `/api/export`
- Stripe integration: `stripe.checkout.sessions.create`
- Claude settings: `model: "claude-opus-4-6"`
- Database: Mock data at top of file

Save → Restart `npm run dev`

### Configuration
**File:** `.env`

Must have:
```
ANTHROPIC_API_KEY=sk-ant-xxxxx
STRIPE_SECRET_KEY=sk_test_xxxxx
APP_URL=http://localhost:3000
REACT_APP_API_URL=http://localhost:3001
```

---

## Testing Checklist

After making changes, verify:

```
☐ Backend running: npm run dev
☐ Frontend running: npm run client
☐ Website loads: http://localhost:3000
☐ Can sign up: Try any email
☐ Can upload image: Select property photo
☐ AI analyzes: Distress score appears
☐ Can export: CSV downloads
☐ No console errors: F12 → Console tab
☐ No API errors: F12 → Network tab
```

---

## Common Code Changes

### Change app title everywhere

```javascript
// distress-scout-app.jsx
// Find line: <h1 className="text-3xl font-bold">Distress Scout</h1>
// Replace with: <h1 className="text-3xl font-bold">Your App Name</h1>
```

### Change monthly price

```javascript
// server.js
// Find: TIERS = { premium: { price: 2900 } }
// 2900 = $29.00 in cents
// Change to 3900 = $39.00
// Or 4900 = $49.00
```

### Change free tier limits

```javascript
// server.js
// Find: TIERS = { free: { scansPerMonth: 20 } }
// Change 20 to: 50, 100, 200, etc.
```

### Add new text to UI

```javascript
// distress-scout-app.jsx
// Add inside <div> or <p> tags:
<p>Your new text here</p>
```

Save and refresh browser.

---

## Debugging Tips

### Problem: "Cannot GET /api/scan"
**Solution:** Backend not running
```bash
npm run dev
# Check if "API running on port 3001" appears
```

### Problem: "Module not found"
**Solution:** Missing package
```bash
npm install
npm run dev
```

### Problem: "STRIPE_SECRET_KEY is undefined"
**Solution:** Missing `.env` file or key
1. Check `.env` exists (not `.env.example`)
2. Verify key is added
3. Restart `npm run dev`

### Problem: "Port 3000 already in use"
**Solution:** Another app using port
```bash
# Mac/Linux: Find and kill process
lsof -i :3000
kill -9 <PID>

# Then restart
npm run client

# Or use different port in .env
```

### Problem: Changes not showing up
**Solution:** Browser cache
```
Frontend: Ctrl + Shift + R (hard refresh)
Backend: Restart with Ctrl+C then npm run dev
```

---

## Useful Terminal Commands

```bash
# See what's running on ports
lsof -i :3000    # Frontend
lsof -i :3001    # Backend

# Kill stuck process
pkill -f npm
pkill -f node

# Stop current process
Ctrl + C

# Navigate folders
cd distress-scout      # Enter folder
cd ..                  # Go up one level
ls                     # List files
ls -la                 # List all files (including hidden)

# Clear terminal
clear

# View file contents
cat .env               # Show .env file
cat server.js | head   # First 20 lines
```

---

## Git Commands (If Using Git)

```bash
# Initialize git repo
git init

# Check status
git status

# Add all files
git add .

# Make a commit
git commit -m "Your message"

# View commit history
git log

# Create backup branch
git branch backup

# Push to GitHub
git push -u origin main
```

---

## Before Deployment

```bash
# Clean reinstall
rm -rf node_modules
npm install

# Test locally one more time
npm run dev
npm run client

# Verify .env has all keys
cat .env

# Build for production (optional)
npm run build

# Deploy to Vercel
vercel --prod
```

---

## After Deployment

```bash
# Test live app
# Visit URL from vercel output

# Monitor logs
vercel logs

# Rollback if broken
vercel rollback

# View dashboard
# https://vercel.com/dashboard
```

---

## Folder Structure Reference

```
distress-scout/
│
├── distress-scout-app.jsx     ← React frontend (EDIT THIS)
│   ├── Login view
│   ├── Dashboard view
│   ├── Scan view
│   ├── Details view
│   └── Settings view
│
├── server.js                   ← Node backend (EDIT THIS)
│   ├── User auth
│   ├── Scan processing
│   ├── AI analysis
│   ├── Stripe payments
│   └── Lead management
│
├── package.json                ← Dependencies (npm install)
├── .env                        ← Your API keys (EDIT THIS)
├── .env.example                ← Template (reference only)
│
├── README.md                   ← Overview
├── LAUNCH_GUIDE.md             ← Deployment steps
├── BUSINESS_MODEL.md           ← Financial info
├── VS_CODE_SETUP.md            ← VS Code guide
└── VS_CODE_CHEATSHEET.md       ← This file
```

---

## Quick Fix Checklist

When something breaks:

```
1. Check terminal for red error messages
2. Verify .env file has all keys
3. Hard refresh browser (Ctrl+Shift+R)
4. Restart npm: Ctrl+C, then npm run dev
5. Kill stuck processes: pkill -f npm
6. Delete node_modules: rm -rf node_modules
7. Reinstall: npm install
8. Restart everything
```

---

## Daily Routine

### Morning
```bash
code .                    # Open VS Code
npm run dev              # Terminal 1: Backend
npm run client           # Terminal 2: Frontend
# Verify both show success messages
```

### During Work
```bash
# Make code changes in VS Code
# Save files (Ctrl+S)
# Check http://localhost:3000
# Repeat
```

### Before Bed
```bash
# If code is ready to deploy:
vercel --prod
# Share URL with beta testers
```

---

## API Endpoints (Backend)

For testing with Thunder Client or Postman:

```bash
# Get user info
GET http://localhost:3001/api/user/USER_ID

# Upload & analyze image
POST http://localhost:3001/api/scan
Body: { image, address, userId }

# Get all leads
GET http://localhost:3001/api/leads/USER_ID

# Export CSV
GET http://localhost:3001/api/export/USER_ID

# Get stats
GET http://localhost:3001/api/stats/USER_ID

# Health check
GET http://localhost:3001/health
```

---

## Environment Variables Quick Ref

```bash
# Must have for development:
ANTHROPIC_API_KEY=           # From console.anthropic.com
STRIPE_SECRET_KEY=sk_test_   # From dashboard.stripe.com
APP_URL=http://localhost:3000
REACT_APP_API_URL=http://localhost:3001

# Optional (for production):
NODE_ENV=production
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
```

---

## Deployment One-Liner

```bash
# Single command to deploy
vercel --prod
```

That's it. Your app goes live.

---

## More Help

**VS Code Docs:** https://code.visualstudio.com/docs  
**React:** https://react.dev/learn  
**Node.js:** https://nodejs.org/docs  
**Express:** https://expressjs.com  
**Vercel:** https://vercel.com/docs  

---

## You're All Set

You now have:
- ✅ Project in VS Code
- ✅ Commands to run
- ✅ File locations
- ✅ Keyboard shortcuts
- ✅ Debugging tips
- ✅ Deployment ready

**Next step:** `npm run dev` && `npm run client`

Then start coding. 🚀
