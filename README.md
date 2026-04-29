# Morning Edge — Deployment Guide

A Next.js 14 app — your daily personalized market intelligence + mindset brief.

## What's in v1

- **Health filter** — 10-min vitality routine generated daily (mobility / breathwork / strength / stretch)
- **Wealth filter** — Market pulse + smart money + conviction watch + CSV portfolio import (Fidelity, Schwab, Robinhood, Webull, E*Trade, Vanguard)
- **Clarity filter** — Universal-wisdom affirmations (Stoic, Buddhist, Vedantic, Sufi, indigenous, secular humanist — never religion-specific)
- **Server-side Anthropic API** — your key stays on server, never exposed to browser
- **Per-user persistence** — name + watchlist saved on device

## File structure

```
morning-edge-nextjs/
├── app/
│   ├── api/brief/route.ts    ← Server route (Anthropic key stays server-side)
│   ├── MorningEdge.jsx       ← Main component
│   ├── page.tsx              ← Page entry
│   ├── layout.tsx            ← Root layout + PWA meta
│   └── globals.css           ← Tailwind base
├── package.json
├── next.config.js · tsconfig.json · tailwind.config.js · postcss.config.js
├── .env.example · .gitignore
└── README.md (this file)
```

---

## Step 1 — Test locally (5 min)

```bash
cd morning-edge-nextjs
npm install
cp .env.example .env.local
# Edit .env.local and paste your real Anthropic key
npm run dev
```

Open `http://localhost:3000`. Onboard, generate a brief — should hit the live API.

Get your API key at: **https://console.anthropic.com/settings/keys**

---

## Step 2 — Push to GitHub (5 min)

```bash
cd morning-edge-nextjs
git init
git add .
git commit -m "v1 — Morning Edge"
```

On github.com, create a new private repo called `morning-edge`, then:

```bash
git remote add origin https://github.com/YOUR-USERNAME/morning-edge.git
git branch -M main
git push -u origin main
```

---

## Step 3 — Deploy on Vercel (5 min)

1. Go to **https://vercel.com/new**
2. Import the `morning-edge` repo
3. Framework: **Next.js** (auto-detected)
4. Expand **Environment Variables** and add:
   - Name: `ANTHROPIC_API_KEY`
   - Value: your `sk-ant-...` key
5. Click **Deploy**

Live URL in ~2 minutes.

---

## Step 4 — Connect Porkbun domain

1. Vercel → your project → **Settings → Domains** → add domain
2. Vercel shows DNS records to set
3. At Porkbun → **Details** on your domain → DNS → add the records Vercel showed
4. Wait 5-30 min for DNS to propagate, then HTTPS auto-provisions

---

## Step 5 — Install on home screen (PWA)

iPhone Safari: Share → "Add to Home Screen"
Android Chrome: menu → "Install app"

---

## Updates after launch

1. Edit code locally
2. `git add . && git commit -m "your change" && git push`
3. Vercel auto-deploys in ~60 seconds
4. Live users see new version on next refresh

---

## Roadmap

- **Week 2:** Stock ticker tape, landing page with email signup
- **Week 3:** Scheduled email brief at 6am
- **Week 4:** Stripe + Edge tier ($9/mo)
- **Month 2:** Push notifications
- **Month 3+:** Native iOS/Android wrapper for alarm integration

---

## Costs

- Vercel: $0 (Hobby tier)
- Anthropic: ~$0.01-0.03 per brief
- Domain: ~$12/yr
