# Morning Edge — App Icon Design Brief

Last updated: May 10, 2026

## Goal
Design a distinctive 1024×1024 iOS app icon that communicates the soul of Morning Edge: a calm, grounded, disciplined morning ritual for investors and the mindful.

## Emotional brief (what a stranger should feel seeing this icon)
- Calm authority, not aggression
- Sunrise-grounded — morning is part of the brand name
- Trust, craftsmanship, intention
- Warm and human, with restraint
- Distinct from typical finance apps (no bulls, bears, dollar signs, or charts going up)

## Visual concepts to explore (pick one)

1. **Abstract sunrise.** A clean geometric sun cresting over a horizon line. Subtle warm cream to amber gradient. No literal landscape — just shape, light, edge.

2. **The "Edge" mark.** A single thin geometric line (the "edge") catching first light, with a soft gradient behind it. Minimalist, like a watch face or compass.

3. **Bronze medallion stylized.** A simplified, modern interpretation of the charitable medallion as a flat icon. Strongest tie to your mission, but harder to execute well.

4. **Dawn arc.** A simple arc with warm pale gold above, amber below. Evokes sunrise and the curve of the earth. Calm and expansive.

## Color palette (matches your existing app aesthetic)
- Primary: warm cream `#faf6ee` / amber `#efe4d0`
- Accent: bronze `#a87440` (medallion tone) or deep slate `#0F172A` (wisdom card tone)
- Light source: soft pale gold `#f4ede4`
- Avoid: pure white, pure black, neon, anything aggressive

## What to AVOID
- Text or letters in the icon (Apple discourages; doesn't read at 60×60)
- Realistic photos
- Bulls, bears, dollar signs, arrows up — generic finance tropes
- Drop shadows (iOS adds them automatically)
- Rounded corners on the design (iOS adds the squircle mask automatically)
- Transparency or alpha channel
- More than 3 main colors

## Technical requirements
- Exactly 1024×1024 pixels
- PNG, RGB color, NO alpha channel
- No transparency
- No drop shadows (Apple applies them)
- No rounded corners (Apple applies the mask)
- File size ideally under 500 KB
- Must be readable at 60×60 pixels (smallest iOS display size)

## AI generation prompts (paste into Midjourney, DALL-E, ChatGPT image, etc.)

Try variations:
- "Minimalist iOS app icon, abstract sunrise cresting over a horizon line, warm cream and amber gradient, flat geometric design, calm and grounded mood, 1024x1024, no text, no rounded corners"
- "iOS app icon, single geometric edge line catching first morning light, cream and bronze color palette, flat minimalist design, warm and distinct, 1024x1024, no text, no shadow"
- "App icon for a mindful investing app, dawn arc gradient with warm pale gold above and amber below, flat modern design, evokes calm authority, 1024x1024"

## Designer brief (if hiring on Fiverr or similar)

Paste this to the designer:

> I need a 1024×1024 iOS app icon for Morning Edge, a personal markets and wellness companion. The brand voice is calm, grounded, and disciplined — built by a 20-year healthcare professional. I want it to feel like a morning ritual, not a trading floor. Preferred concept: abstract sunrise or dawn imagery in warm cream/amber/bronze tones. Avoid text, generic finance symbols (bulls, dollar signs, charts), and rounded corners. Deliverable: 1024×1024 PNG, no transparency, no alpha channel.

## Next steps after icon is ready
1. Save the 1024×1024 PNG to the repo at `public/icon.png`
2. When Capacitor wrapper is set up (item 8), it auto-generates all required iOS sizes from this master
3. Sanity check: open the PNG at 60×60 — is it still recognizable? If not, simplify.
