# Morning Edge logo swap — drop-in guide

## What's in this bundle

**SVG sources** (master files — edit these to iterate)
- `morning-edge-icon.svg` — full app icon, 1024×1024, with tracked wordmark + est. line
- `morning-edge-icon-simple.svg` — minimal app icon, just the ME framed by gold rules
- `morning-edge-lockup.svg` — horizontal mark + wordmark, 1280×320

**PNG exports** (drop directly into `/public`)
- `morning-edge-icon-1024.png` — splash / store listing
- `morning-edge-icon-512.png` — PWA manifest large
- `morning-edge-icon-192.png` — PWA manifest standard
- `morning-edge-apple-touch-icon.png` — iOS home-screen (180×180)
- `morning-edge-favicon-32.png` — browser tab
- `morning-edge-lockup.png` — header / splash banner

## Swap steps

1. **Drop all files into `/public`** of the morning-edge repo.

2. **Update `/public/manifest.json`** — replace the `icons` array:
   ```json
   "icons": [
     { "src": "/morning-edge-icon-192.png", "sizes": "192x192", "type": "image/png" },
     { "src": "/morning-edge-icon-512.png", "sizes": "512x512", "type": "image/png" }
   ]
   ```

3. **Update `app/layout.jsx`** (or wherever `<head>` metadata lives) — favicon + apple touch:
   ```jsx
   <link rel="icon" href="/morning-edge-favicon-32.png" sizes="32x32" />
   <link rel="apple-touch-icon" href="/morning-edge-apple-touch-icon.png" />
   ```

4. **In-app header** — wherever the old logo image was referenced, swap to the SVG:
   ```jsx
   <img src="/morning-edge-lockup.svg" alt="Morning Edge" />
   ```
   The SVG will pick up Cormorant Garamond automatically since it's already loaded in your CSS.

5. **Commit, push, wait ~60s for Vercel.**

## Why two icon variants

`morning-edge-icon.svg` includes the tiny "MORNING EDGE" tracked caps and "est. mmxxvi" — looks rich at 512px+ but the text becomes mud below ~256px.

`morning-edge-icon-simple.svg` strips all that — just the framed monogram. Use this for 192px and below (manifest 192, apple-touch, favicon).

## Iterating from here

The SVGs use this font stack:
```
'Cormorant Garamond', Georgia, 'Times New Roman', 'DejaVu Serif', serif
```

Cormorant first means your app will render with the elegant editorial Cormorant italic. The PNGs in this bundle were rasterized using DejaVu Serif (closest local match) — once dropped into your Vercel build, you can re-render the PNGs from the SVGs through any browser-based tool to get the Cormorant version baked into the bitmap.

## What was removed

The old sunrise + green arrow + lowercase serif read "wellness app." This direction trades that for: gold + navy + italic serif monogram + tracked caps. Matches the in-app brand language already established by the Generate Brief / Premium / Sync Portfolio gold gradients.
