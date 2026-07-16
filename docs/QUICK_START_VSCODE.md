# Move to VS Code - 5 Minute Setup

**Goal:** Get Distress Scout running locally in VS Code

---

## 1. Download & Setup (2 min)

```bash
# Create project folder
mkdir distress-scout
cd distress-scout

# Move all downloaded files here
# (Put all 10 files in this folder)

# Open in VS Code
code .
```

---

## 2. Install & Configure (2 min)

In VS Code terminal (Ctrl + `):

```bash
# Install dependencies
npm install

# Rename .env.example to .env
# (Right-click in file explorer → Rename)
```

Edit `.env`:
```
ANTHROPIC_API_KEY=your_key_from_console.anthropic.com
STRIPE_SECRET_KEY=sk_test_your_key_from_stripe
APP_URL=http://localhost:3000
REACT_APP_API_URL=http://localhost:3001
```

---

## 3. Run (1 min)

**Terminal 1:**
```bash
npm run dev
```
Wait for: `"API running on http://localhost:3001"`

**Terminal 2** (Ctrl + Shift + `):
```bash
npm run client
```
Wait for: `"webpack compiled successfully"`

---

## 4. Test (Optional but do this)

Open browser: http://localhost:3000

- Sign up (any email)
- Upload property photo
- Watch AI analyze it
- Add to leads
- Export CSV

**Done!** App is running locally.

---

## 5. Deploy (When ready)

```bash
npm install -g vercel
vercel --prod
```

Follow prompts → App is live.

---

## Common Commands

```bash
# Stop backend
Ctrl + C

# Start backend again
npm run dev

# Stop frontend
Ctrl + C

# Start frontend again
npm run client

# Both at once (install npm-run-all first)
npm install -g npm-run-all
npm run dev:all
```

---

## Stuck?

**Error: "npm: command not found"**
→ Install Node.js from nodejs.org

**Error: "Cannot find module"**
→ Run `npm install` again

**Port 3000/3001 in use**
→ Kill process: `pkill -f npm` and restart

**Changes not showing**
→ Hard refresh: Ctrl+Shift+R (frontend)
→ Restart npm run dev (backend)

---

## Next Steps

- Read **VS_CODE_CHEATSHEET.md** for shortcuts
- Read **LAUNCH_GUIDE.md** to deploy
- Make code changes and iterate
- Deploy to Vercel when ready
- Post to real estate communities for first users

---

## File Structure (What You Have)

```
distress-scout/
├── distress-scout-app.jsx   ← Frontend (React)
├── server.js                ← Backend (Node.js)
├── package.json             ← Dependencies
├── .env                     ← Your API keys
├── .env.example             ← Template
├── README.md                ← Overview
├── LAUNCH_GUIDE.md          ← Deployment
├── BUSINESS_MODEL.md        ← Financials
├── VS_CODE_SETUP.md         ← Full guide
├── VS_CODE_CHEATSHEET.md    ← Shortcuts
└── QUICK_START_VSCODE.md    ← This file
```

---

## That's It

You're now set up and ready to code.

**Next:** Edit files, test locally, deploy to Vercel.

🚀
