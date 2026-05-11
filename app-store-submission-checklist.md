# App Store Submission Checklist — Morning Edge

Last updated: May 10, 2026

This is the final assembly checklist. Work through top to bottom on submission day.

## Marketing copy
Source file: `app-store-assets.md`

- [ ] App Name: Morning Edge ✓
- [ ] Subtitle (30 char): Briefs for disciplined traders ✓
- [ ] Promotional Text (170 char): ready ✓
- [ ] Full Description (4000 char): ready ✓
- [ ] Keywords (100 char): ready ✓

## URLs (already live)
- [ ] Support URL: https://morning-edge-rho.vercel.app/support ✓
- [ ] Marketing URL: https://morning-edge-rho.vercel.app ✓
- [ ] Privacy Policy URL: https://morning-edge-rho.vercel.app/privacy ✓

## App icon
Source: `icon-design-brief.md`

- [ ] 1024×1024 PNG, RGB, no alpha, no transparency, no rounded corners
- [ ] Saved to `public/icon.png` in repo
- [ ] Tested at 60×60 — still recognizable

## Screenshots (per device size, required)
You need real screenshots from your phone, sized correctly.

iPhone 6.7" (e.g., iPhone 15 Pro Max): 1290×2796 px, 3-10 screenshots
iPhone 6.5" (older): 1284×2778 or 1242×2688 px, 3-10 screenshots
iPad 12.9" (if supporting iPad): 2048×2732 px

For each screen, capture:
1. Onboarding / first impression
2. The daily brief in action
3. Portfolio view with positions
4. A wellness / mindful check-in
5. The About page (founder credibility)
6. Footer with mission medallion

Tool: take real screenshots on your phone, then resize/caption in Figma or Canva.

## App preview video (optional but boosts conversion)
- [ ] 15-30 second video showing the app in use
- [ ] Portrait orientation matching device size
- [ ] No audio overlay required

## App Store Connect setup
- [ ] Apple Developer account active ($99/year, developer.apple.com)
- [ ] Bundle ID registered: com.tarunprasad.morningedge (or similar)
- [ ] App created in App Store Connect with the bundle ID
- [ ] Version: 1.0.0
- [ ] Build: 1

## Categories
- [ ] Primary: Finance
- [ ] Secondary: Health & Fitness (TBD — confirm fit)

## Age rating questionnaire (Apple asks ~15 questions)
Likely answers for Morning Edge:
- No violence, gambling, adult content, medical/treatment info, alcohol/tobacco/drugs
- Frequent/intense: none
- Expected rating: 4+

## Content rights
- [ ] Confirm all app content is your own or properly licensed
- [ ] Anthropic API usage disclosed in Privacy Policy ✓

## Pricing
- [ ] Free? Paid? Subscription?
- [ ] Decision needed before submission

## Demo account (if your app requires login)
- [ ] Not applicable — Morning Edge requires no login ✓

## Privacy nutrition labels (Apple asks what data you collect)
Likely answers based on current app:
- Data not collected: most categories ✓
- Anthropic API: usage data may be processed by third party — disclose

## Build & upload
Source: `capacitor-setup-plan.md`

- [ ] Mac access secured
- [ ] Xcode installed
- [ ] Capacitor setup completed per plan
- [ ] iOS build uploaded to App Store Connect via Xcode Organizer

## Final sanity checks before clicking Submit
- [ ] All four footer pages render on live site
- [ ] Disclaimer text passes legal sniff (it does ✓)
- [ ] About page founder story reads true
- [ ] Email link (tarunprasadmd@gmail.com) is monitored
- [ ] Vercel deployment is stable and fast

## After submission
- Apple review takes 1–3 days typically
- If rejected, read the rejection reason carefully — most are fixable
- Once approved, your app goes live on the date you specify
