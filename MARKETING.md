# Distress Scout — Facebook/Instagram Ad Campaign Kit

Prepared for launch once a Meta Business Manager account + ad account exist.
Everything below is ready to paste into Ads Manager. The one thing this
document can't do is actually spend money — creating the account, adding a
payment method, and clicking "Publish" has to happen on Jordan's end.

## ⚠️ Compliance — read before creating the campaign

Meta auto-classifies real-estate-related ads under its **Special Ad Category**
(Housing), which applies **even to B2B tools like this one**, not just
consumer listings. Under Special Ad Category rules:

- **No age or gender targeting** — must target 18+ all genders
- **No ZIP code / precise geographic radius targeting** — only broad
  location targeting (state, country, or a minimum-size radius, currently
  15+ miles)
- **No lookalike audiences** based on protected-class-adjacent data
- Ad account may require identity verification before running housing-category ads

Meta's classifier often auto-flags anything mentioning "property," "real
estate," or "investors" this way regardless of framing. Expect it, don't fight
it — design targeting around interests/behaviors (real estate investing,
wholesaling, house flipping) rather than demographics or precise geography.

## Positioning

**Audience**: real estate wholesalers and small investors who currently do
"driving for dollars" manually, or pay for PropStream/DealMachine-style tools
that give static public records but don't actually *look* at properties.

**Core differentiator**: Distress Scout's AI visually scans satellite +
street-level imagery across an entire ZIP code and cross-references live
county code-violation records — it finds distress signals competitors don't
have, instead of just repackaging the same public data everyone already has
access to.

**Price anchor**: Free tier (20 scans/month) removes signup friction; $29/mo
Premium (500 scans/month) is the conversion target.

## Ad Copy — 5 variations, different angles

### 1. Pain-point (driving for dollars)
**Headline:** Stop Driving Neighborhoods for Distressed Deals
**Primary text:** Distress Scout's AI scans every house in a ZIP code — satellite images, street view, and county code violations — and ranks the most distressed properties for you. No more hours behind the wheel. Type a ZIP, get a ranked list in minutes.
**CTA:** Sign Up Free

### 2. Feature-forward (AI angle)
**Headline:** AI That Actually Looks at the Property
**Primary text:** Most lead tools just hand you the same public records everyone else has. Distress Scout's AI visually inspects satellite and street-level photos for boarded windows, roof damage, and overgrown lots — then cross-checks real code violations. Real distress signals, not recycled data.
**CTA:** Try It Free

### 3. Curiosity hook
**Headline:** Type a ZIP Code. Get a List of Distressed Houses.
**Primary text:** It sounds too simple, but that's the point. Distress Scout sweeps an entire ZIP with AI vision + county violation records and hands you a ranked list of the most motivated-seller-likely properties — in the time it takes to make coffee.
**CTA:** Scan Your First ZIP Free

### 4. Wholesaler-specific / deal math
**Headline:** Find the Deal. Run the Numbers. Make the Call.
**Primary text:** Distress Scout finds distressed properties with AI, calculates your Max Allowable Offer with the built-in 70% ARV calculator, and even has an AI voice agent that answers calls from interested sellers. Built for wholesalers who move fast.
**CTA:** Get Started Free

### 5. Direct/no-nonsense
**Headline:** Distressed Property Leads, Found by AI
**Primary text:** Distress Scout scans satellite imagery, street view, and county code violations across any ZIP code to surface real distressed properties — not recycled public records. Free to start, 20 scans/month included.
**CTA:** Sign Up Free

## Landing page notes

Ads should point straight at the signup screen (distress-scout-smtq.vercel.app),
not a separate landing page — the app's own login/signup view already states
the value prop clearly. Meta Pixel is wired in and will fire:
- `PageView` on every load
- `CompleteRegistration` on signup
- `Lead` when a user saves their first distressed property

This gives Meta's ad delivery algorithm real conversion signal to optimize
toward within a few days of spend, once a Pixel ID exists.

## Targeting recommendations (within Special Ad Category limits)

- **Location**: broad — state-level or large-radius, not ZIP-precise
- **Interests**: real estate investing, wholesaling, house flipping, "we buy houses," REI meetup/education brands
- **Placements**: Facebook + Instagram feed and Stories; skip Audience Network (low intent, low quality for a niche B2B tool)
- **Budget structure**: start small ($15–25/day) on 2–3 of the ad variations above as a test, let the Pixel gather signal for 5–7 days before scaling winners

## Launch checklist (Jordan)

- [ ] Create Meta Business Manager account (business.facebook.com)
- [ ] Create an ad account, add payment method
- [ ] Create a Pixel, copy its ID
- [ ] Send Pixel ID → I'll set `REACT_APP_META_PIXEL_ID` in Vercel and redeploy
- [ ] Create campaign in Ads Manager, paste in 2–3 ad variations above
- [ ] Set targeting per the recommendations above (broad location, interest-based)
- [ ] Set daily budget, publish
- [ ] After ~5–7 days, tell me the campaign is live and I'll help review Pixel conversion data with you
