# Distress Scout - VS Code Setup Guide

Get the full project running in VS Code in 5 minutes.

---

## Step 1: Download Project Files

1. Download all 8 files from the outputs folder
2. Create a new folder on your computer:
   ```
   mkdir distress-scout
   cd distress-scout
   ```
3. Move all downloaded files into this folder

---

## Step 2: Open in VS Code

### Option A: From Command Line
```bash
# Navigate to project folder
cd distress-scout

# Open VS Code
code .
```

### Option B: From VS Code UI
1. Open VS Code
2. File → Open Folder
3. Select `distress-scout` folder
4. Click Open

---

## Step 3: Install Dependencies

**In VS Code Terminal:**

1. Open integrated terminal: `Ctrl + `` (backtick)
2. Run:
```bash
npm install
```

This installs all dependencies from `package.json`.

**Wait time:** 2-3 minutes

---

## Step 4: Configure Environment

1. Rename `.env.example` to `.env`
   - Right-click `.env.example` in file explorer
   - Select "Rename"
   - Change to `.env`

2. Open `.env` file and fill in:
```
ANTHROPIC_API_KEY=your_key_here
STRIPE_SECRET_KEY=sk_test_your_key_here
APP_URL=http://localhost:3000
REACT_APP_API_URL=http://localhost:3001
```

**How to get keys (5 minutes):**
- Anthropic: https://console.anthropic.com → API Keys → Create new key
- Stripe: https://dashboard.stripe.com → Developers → API Keys → Copy test secret key

---

## Step 5: Start Development

### Option A: Split Terminal (Recommended)

```bash
# Terminal 1: Backend API
npm run dev

# Wait for: "API running on http://localhost:3001"

# Terminal 2: Frontend (new terminal in VS Code)
npm run client

# Wait for: "webpack compiled successfully"
```

**To create new terminal in VS Code:**
- Click `+` icon in terminal area
- Or press `Ctrl + Shift + `` (backtick)

**Result:**
- Backend: http://localhost:3001
- Frontend: http://localhost:3000

### Option B: Use npm-run-all (Simultaneous)

Install package:
```bash
npm install -g npm-run-all
```

Then create script in `package.json`:
```json
"dev:all": "npm-run-all --parallel dev client"
```

Run both simultaneously:
```bash
npm run dev:all
```

---

## Step 6: Test the App

1. Open browser to http://localhost:3000
2. You should see login page
3. Sign up with any email
4. Upload a property photo
5. AI analyzes it
6. Add to leads
7. Export CSV

**If it doesn't work:**
- Check terminal for errors
- Make sure both `npm run dev` and `npm run client` are running
- Verify .env file has API keys
- See Troubleshooting section below

---

## VS Code Extensions (Recommended)

Install these for better development experience:

### Essential
1. **ES7+ React/Redux/React-Native snippets**
   - Author: dsznajder
   - Quick React code snippets

2. **Prettier - Code formatter**
   - Author: Prettier
   - Auto-format code on save

3. **ESLint**
   - Author: Microsoft
   - Catch errors in JavaScript

### Nice to Have
4. **Thunder Client** - Test API endpoints
5. **MongoDB** - If using MongoDB database
6. **SQL Tools** - If using PostgreSQL
7. **Stripe** - Stripe documentation

**To install extension:**
- Click Extensions icon (left sidebar)
- Search for extension name
- Click Install

---

## Project Structure in VS Code

```
distress-scout/
├── distress-scout-app.jsx      ← Frontend (React)
├── server.js                    ← Backend (Express)
├── package.json                 ← Dependencies
├── .env                         ← Your API keys (CREATE THIS)
├── .env.example                 ← Template (reference)
├── README.md                    ← Overview
├── LAUNCH_GUIDE.md              ← Deployment guide
├── BUSINESS_MODEL.md            ← Financial info
└── START_HERE.md                ← Quick start
```

### Opening Files in VS Code

**Frontend code:**
- Click `distress-scout-app.jsx` in file explorer
- View entire React app (1 file)

**Backend code:**
- Click `server.js`
- View entire API (1 file)

**Edit either file, save with `Ctrl+S`**
- Frontend auto-refreshes on save
- Backend requires restart (`npm run dev` again)

---

## Debugging in VS Code

### Debug Backend (Node.js)

1. Click Debug icon (left sidebar)
2. Create launch configuration:
   - Click "create a launch.json file"
   - Select "Node.js"

3. Add to `.vscode/launch.json`:
```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Launch Backend",
      "program": "${workspaceFolder}/server.js",
      "restart": true,
      "console": "integratedTerminal"
    }
  ]
}
```

4. Press F5 to start debugging
5. Click Debug menu to set breakpoints

### Debug Frontend (Browser)

Use browser DevTools (built-in):
- Open http://localhost:3000
- Press F12 (Developer Tools)
- View Console, Network, React DevTools

**Install React DevTools extension:**
- Chrome: https://chrome.google.com/webstore
- Search "React Developer Tools"
- Add to Chrome
- Click React icon while viewing app

---

## Common Commands

```bash
# Install dependencies
npm install

# Start backend API
npm run dev

# Start frontend (React)
npm run client

# Build for production
npm run build

# Run tests
npm test

# Deploy to Vercel
npm install -g vercel
vercel --prod
```

---

## Troubleshooting

### "npm: command not found"
**Solution:** Install Node.js from nodejs.org

### "Module not found" error
**Solution:** 
```bash
# Delete node_modules
rm -rf node_modules

# Reinstall
npm install
```

### Backend won't start
**Solution:**
1. Check if port 3001 is in use: `lsof -i :3001`
2. Change port in `server.js` (line ~137): `const PORT = 3002`
3. Update `.env`: `REACT_APP_API_URL=http://localhost:3002`

### Frontend won't start
**Solution:**
1. Check if port 3000 is in use
2. Kill process: `pkill -f "react-scripts"`
3. Start again: `npm run client`

### API keys not working
**Solution:**
1. Verify keys in `.env` file
2. Restart both `npm run dev` and `npm run client`
3. Hard refresh browser (Ctrl+Shift+R)

### "Cannot find module '@anthropic-ai/sdk'"
**Solution:**
```bash
npm install @anthropic-ai/sdk
```

---

## Making Your First Change

### Change the app name

1. Open `distress-scout-app.jsx`
2. Find: `<h1 className="text-3xl font-bold text-gray-900">Distress Scout</h1>`
3. Change to: `<h1 className="text-3xl font-bold text-gray-900">Your App Name</h1>`
4. Save (Ctrl+S)
5. Frontend auto-refreshes
6. See change at http://localhost:3000

### Change the pricing

1. Open `server.js`
2. Find: `TIERS = { free: { scansPerMonth: 20 ...`
3. Change numbers:
   ```javascript
   free: { scansPerMonth: 50 },    // Changed from 20
   premium: { price: 3900 }         // $39/month instead of $29
   ```
4. Save (Ctrl+S)
5. Restart backend: Stop `npm run dev`, run again
6. Refresh http://localhost:3001

---

## Git Setup (Optional but Recommended)

### Initialize Git

```bash
# In project folder
git init
git add .
git commit -m "Initial commit: Distress Scout MVP"
```

### Create .gitignore

Create file named `.gitignore` in project root:

```
node_modules/
.env
.DS_Store
dist/
build/
*.log
```

### Push to GitHub

1. Create GitHub account (github.com)
2. Create new repository (name: "distress-scout")
3. Copy commands GitHub shows
4. In VS Code terminal:
```bash
git remote add origin https://github.com/YOUR_USERNAME/distress-scout.git
git branch -M main
git push -u origin main
```

Now your code is backed up and ready for deployment.

---

## Deploying from VS Code

### Deploy to Vercel (5 minutes)

```bash
# Install Vercel CLI
npm install -g vercel

# Deploy
vercel

# Follow prompts - it will:
# 1. Ask for confirmation
# 2. Build and deploy
# 3. Give you live URL
```

**Your app is now live!** Share the URL with beta users.

### Auto-deploy on GitHub changes

1. Connect GitHub repo to Vercel
2. Any push to `main` auto-deploys
3. View deployments at vercel.com/dashboard

---

## Development Workflow

### Daily workflow:

1. **Morning:** `npm run dev` + `npm run client`
2. **Code:** Edit `.jsx` and `.js` files
3. **Save:** Ctrl+S (frontend hot-reloads)
4. **Test:** Check http://localhost:3000
5. **Deploy:** `vercel --prod` when ready

### Making changes:

```
File Edit → Save → Frontend Auto-Refreshes → Test → Deploy
```

---

## Useful VS Code Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+`` | Open/Close Terminal |
| `Ctrl+S` | Save file |
| `Ctrl+/` | Toggle comment |
| `Ctrl+F` | Find in file |
| `Ctrl+H` | Find & replace |
| `Ctrl+Shift+P` | Command palette |
| `F5` | Start debugging |
| `Alt+Up/Down` | Move line up/down |
| `Ctrl+D` | Select next occurrence |
| `Ctrl+Shift+L` | Select all occurrences |

---

## Environment Variables Reference

Your `.env` file should have:

```bash
# Anthropic API (for AI image analysis)
ANTHROPIC_API_KEY=sk-ant-xxxxx

# Stripe (for payments)
STRIPE_SECRET_KEY=sk_test_xxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxx

# URLs
APP_URL=http://localhost:3000
REACT_APP_API_URL=http://localhost:3001

# Node environment
NODE_ENV=development
PORT=3001
```

Get keys from:
- Anthropic: https://console.anthropic.com
- Stripe: https://dashboard.stripe.com

---

## Next Steps

1. ✅ Install VS Code
2. ✅ Download project files
3. ✅ Open in VS Code
4. ✅ `npm install`
5. ✅ Create `.env` with API keys
6. ✅ `npm run dev` + `npm run client`
7. ✅ Visit http://localhost:3000
8. ✅ Upload a photo and test
9. ✅ Make a change and save
10. ✅ Deploy with `vercel --prod`

---

## Resources

**VS Code Docs:** https://code.visualstudio.com/docs

**React Development:** https://react.dev

**Node.js & Express:** https://expressjs.com/

**Vercel Deployment:** https://vercel.com/docs

**Stripe Integration:** https://stripe.com/docs/api

**Anthropic API:** https://anthropic.com/docs

---

## Stuck?

### Before asking for help:

1. Check terminal for red error messages
2. Verify `.env` file has all keys
3. Restart both `npm run dev` and `npm run client`
4. Hard refresh browser (Ctrl+Shift+R)
5. Check port conflicts (`lsof -i :3000` and `lsof -i :3001`)

### Common fixes:

```bash
# Clear cache and reinstall
rm -rf node_modules package-lock.json
npm install

# Kill stuck processes
pkill -f "npm"
pkill -f "node"

# Restart fresh
npm run dev    # Terminal 1
npm run client # Terminal 2
```

---

## You're Ready

You now have:
- ✅ Project in VS Code
- ✅ Local development environment running
- ✅ Backend API working
- ✅ Frontend app working
- ✅ Path to production deployment

**Next:** Follow LAUNCH_GUIDE.md to get live.

**Timeline:**
- Today: Get running locally ← You are here
- Tomorrow: Deploy to Vercel
- This week: Get first users
- Next week: First revenue

Go. 🚀
