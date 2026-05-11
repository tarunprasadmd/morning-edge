# Capacitor Setup Plan — Morning Edge

Last updated: May 10, 2026

## What this accomplishes
Wraps your live Vercel deployment in a native iOS app for the App Store. Code updates ship instantly via Vercel — no Apple review needed for content changes.

## Hardware/software prerequisites

You will need a Mac. Capacitor for iOS requires Xcode, which is macOS-only.

If you don't own a Mac:
- Use a friend's or family member's Mac for build sessions
- Rent a cloud Mac (MacInCloud.com, ~$30/month or pay-per-day)
- Buy a used Mac mini Intel or M1 (~$200–400 on Swappa/eBay)

Software to install on the Mac:
- macOS 12+ (Monterey or later)
- Xcode 14+ (free, ~10 GB from Mac App Store)
- Node.js 18+ (nodejs.org)
- Git, built-in Terminal

## Approach
Morning Edge uses server-side features (Anthropic API), so a pure static export won't work. We'll use Capacitor's "remote web" mode — the iOS app becomes a native wrapper that loads morning-edge-rho.vercel.app inside a webview, with native iOS features added on top.

## Step-by-step

### Phase 1 — Local setup
1. `git clone https://github.com/tarunprasadmd/morning-edge.git`
2. `cd morning-edge`
3. `npm install`
4. `npm run dev` — verify app runs at localhost:3000

### Phase 2 — Install Capacitor
5. `npm install @capacitor/core @capacitor/cli`
6. `npm install @capacitor/ios`
7. `npx cap init`
   - App name: Morning Edge
   - App ID: com.tarunprasad.morningedge (or similar reverse-domain)

### Phase 3 — Configure for remote URL
8. Edit `capacitor.config.ts` to:
