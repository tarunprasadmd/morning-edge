"use client";

// ════════════════════════════════════════════════════════════════════
//  MORNING EDGE  ·  by T-SPOT
//  © 2026 Tarun Prasad. All rights reserved.
//  Public release — personalization-first, mountain/ocean refined build.
// ════════════════════════════════════════════════════════════════════

import React, { useState, useEffect, useMemo } from "react";
import {
  Sun, TrendingUp, Eye, Heart, CheckSquare, RefreshCw, Settings,
  Plus, X, AlertCircle, Sparkles, Coffee, Wind, ArrowUpRight,
  Pause, ArrowDownRight, ShieldCheck, ShieldAlert,
  ArrowRight, Lock, Crown, LayoutGrid, Briefcase, Share2, CalendarPlus, Play,
  Compass, Telescope, Flower2, Activity, ChevronLeft, ChevronRight, ExternalLink,
  Utensils, ShoppingBasket, Timer, Flame, Pencil, Trash2, Check,
  Castle, Dumbbell, Move, HeartHandshake, Snowflake, CheckCircle2,
} from "lucide-react";

const SIGNATURE = "Morning Edge · by T-SPOT · Tarun Prasad · 2026";
const SIG_EXPECTED = "78780410";
const fnv1a = (str) => {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return ("00000000" + h.toString(16)).slice(-8);
};

const Store = {
  get: async (k) => {
    try {
      if (typeof window === "undefined") return null;
      const raw = window.localStorage.getItem(k);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  },
  set: async (k, v) => {
    try {
      if (typeof window === "undefined") return;
      window.localStorage.setItem(k, JSON.stringify(v));
    } catch {}
  },
  del: async (k) => {
    try {
      if (typeof window === "undefined") return;
      window.localStorage.removeItem(k);
    } catch {}
  },
};

const SUGGESTED = ["SPY", "QQQ", "AAPL", "NVDA", "MSFT", "GOOGL", "AMZN", "META", "TSLA"];

const SERIF = `'Cormorant Garamond', 'Playfair Display', ui-serif, Georgia, serif`;
const SANS = `'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;

// ─── Brokerage Export Guide ──────────────────────────────────────────
// Direct links to each brokerage + the navigation path to find the CSV
// export. We DO NOT collect credentials — the user logs in on the
// brokerage's site, exports their CSV, saves it to Files, then uploads
// to Morning Edge. Fully zero-trust on our side.
const BROKERAGES = [
  {
    name: "Fidelity",
    url: "https://www.fidelity.com/",
    path: "Accounts → Positions → ⬇ Download → CSV",
    notes: "Top right of positions page",
  },
  {
    name: "Charles Schwab",
    url: "https://www.schwab.com/",
    path: "Accounts → Positions → Export (icon)",
    notes: "Includes former TD Ameritrade",
  },
  {
    name: "Robinhood",
    url: "https://robinhood.com/",
    path: "Account → Statements & History → Export",
    notes: "Mobile app: tap profile icon",
  },
  {
    name: "E*TRADE",
    url: "https://us.etrade.com/",
    path: "Accounts → Portfolio → Download → CSV",
    notes: "Now part of Morgan Stanley",
  },
  {
    name: "Vanguard",
    url: "https://investor.vanguard.com/",
    path: "My Accounts → Holdings → Download",
    notes: "Then choose CSV format",
  },
  {
    name: "Webull",
    url: "https://www.webull.com/",
    path: "Menu → Account → Statements → Positions",
    notes: "Easier on desktop than app",
  },
  {
    name: "Merrill Edge",
    url: "https://www.merrilledge.com/",
    path: "Holdings → Download → Export to spreadsheet",
    notes: "Bank of America accounts",
  },
  {
    name: "Interactive Brokers",
    url: "https://www.interactivebrokers.com/",
    path: "Reports → Statements → Activity → CSV",
    notes: "Use 'Default' template",
  },
  {
    name: "Public",
    url: "https://public.com/",
    path: "Account → Documents → Tax & Statements",
    notes: "Or request via support",
  },
  {
    name: "SoFi Invest",
    url: "https://www.sofi.com/invest/",
    path: "Account → Documents → Statements",
    notes: "PDF — may need manual entry",
  },
  {
    name: "JP Morgan Self-Directed",
    url: "https://www.chase.com/personal/investments",
    path: "Investments → Performance → Export",
    notes: "Within Chase login",
  },
  {
    name: "Tastytrade",
    url: "https://tastytrade.com/",
    path: "My Profile → Account History → Export CSV",
    notes: "Filter by Position type",
  },
];

// ─── Routine Library ─────────────────────────────────────────────────
// 7 daily routines (one per day of week), 4 segments each. Total 10 min.
// Each segment: { title, durationSec, kicker, exercises: [{ name, cue }] }
// Designed for mid-life users with limited mobility — gentle, plain English,
// safe at any fitness level. No burpees, push-ups, jumping, or floor work
// that requires getting up off the ground. All can be done in a chair if
// needed; cues describe each move in simple step-by-step language.
const ROUTINES = [
  // Sunday — gentle reset
  {
    name: "Easy Sunday Reset",
    segments: [
      { kicker: "Loosen up", title: "Wake the joints", durationSec: 120, exercises: [
        { name: "Slow neck rolls", cue: "Drop chin to chest. Roll your head slowly in a half circle, ear toward shoulder, then back. 3 each side. No forcing." },
        { name: "Shoulder shrugs", cue: "Lift both shoulders up toward your ears, hold 3 seconds, drop them down. Repeat 8 times." },
        { name: "Seated waist twist", cue: "Sit tall. Place hands on your knees. Slowly turn your shoulders right, then left. 5 each side." },
      ]},
      { kicker: "Breathe", title: "Slow box breathing", durationSec: 180, exercises: [
        { name: "In through the nose, 4 counts", cue: "Sit comfortably. Breathe in slowly through your nose while you count to 4." },
        { name: "Hold gently, 4 counts", cue: "Hold the breath. No tension. Just pause." },
        { name: "Out through the mouth, 4 counts", cue: "Let the breath out through soft, parted lips while you count to 4." },
        { name: "Hold empty, 4 counts", cue: "Pause again with empty lungs. Repeat the full cycle 6–8 times." },
      ]},
      { kicker: "Steady", title: "Sit-to-stands", durationSec: 180, exercises: [
        { name: "Chair sit-to-stand", cue: "Sit on a sturdy chair. Cross arms over chest. Stand up using your legs (no rocking), then sit back down with control. 8 reps." },
        { name: "Heel raises at the counter", cue: "Hold a kitchen counter for balance. Rise up onto the balls of your feet, then lower slowly. 12 reps." },
      ]},
      { kicker: "Stretch", title: "Open and ground", durationSec: 120, exercises: [
        { name: "Standing forward fold (gentle)", cue: "Stand with knees soft. Hinge at the hips and let your arms hang. Stop wherever it feels easy. Hold 30 seconds." },
        { name: "Doorway chest opener", cue: "Place forearm on a doorframe at shoulder height. Step the same-side foot forward until you feel a gentle stretch in the chest. 30 seconds each side." },
      ]},
    ],
  },
  // Monday — gentle start to the week
  {
    name: "Monday Wake-Up",
    segments: [
      { kicker: "Loosen up", title: "Hip and ankle mobility", durationSec: 120, exercises: [
        { name: "Marching in place", cue: "Hold a counter or chair if needed. Lift one knee at a time, slowly. 20 lifts total (10 each side)." },
        { name: "Ankle circles", cue: "Sit or stand. Lift one foot. Trace a slow circle with your toes. 5 each direction, both feet." },
      ]},
      { kicker: "Breathe", title: "Long exhale breathing", durationSec: 180, exercises: [
        { name: "Inhale 4, exhale 6", cue: "Breathe in through your nose for 4 counts. Breathe out through your mouth for 6 counts. The longer exhale tells your body it's safe." },
        { name: "Continue for 2–3 minutes", cue: "Don't worry about counting perfectly. Just keep the exhale a bit longer than the inhale." },
      ]},
      { kicker: "Steady", title: "Lower body strength", durationSec: 180, exercises: [
        { name: "Wall sit (short)", cue: "Stand with your back against a wall. Slide down only as far as comfortable. Hold for 15 seconds, rest, repeat 3 times." },
        { name: "Step-ups on the bottom stair", cue: "Hold the railing. Step up with the right foot, bring the left to meet it, step down. 10 reps, then switch leading leg." },
      ]},
      { kicker: "Stretch", title: "Hips and hamstrings", durationSec: 120, exercises: [
        { name: "Seated figure-4 stretch", cue: "Sit on a chair. Cross right ankle over left knee. Sit tall, lean forward gently until you feel a stretch in the hip. 30 seconds each side." },
        { name: "Standing hamstring stretch", cue: "Place one heel on the bottom stair. Keep that leg straight. Hinge gently at the hips until you feel the back of the leg open. 30 seconds each leg." },
      ]},
    ],
  },
  // Tuesday — focus
  {
    name: "Tuesday Steady Focus",
    segments: [
      { kicker: "Loosen up", title: "Upper back mobility", durationSec: 120, exercises: [
        { name: "Cat-cow (standing or seated)", cue: "Place hands on knees. Round the back as you exhale. Arch the back gently as you inhale. 8 slow rounds." },
        { name: "Arm reaches across the body", cue: "Reach right arm across the chest. Use the left hand to gently hug it closer. 20 seconds each side." },
      ]},
      { kicker: "Breathe", title: "4-7-8 calming breath", durationSec: 180, exercises: [
        { name: "Breathe in, 4 counts (nose)", cue: "Lips closed. Breathe in quietly through the nose." },
        { name: "Hold, 7 counts", cue: "Hold the breath. If 7 is too long, do 5 — work up to 7 over time." },
        { name: "Out through the mouth, 8 counts", cue: "Exhale fully through the mouth with a soft 'whoosh' sound. Repeat 4 cycles." },
      ]},
      { kicker: "Steady", title: "Standing balance + core", durationSec: 180, exercises: [
        { name: "One-foot stand (near a counter)", cue: "Hold the counter lightly. Lift one foot a few inches. Hold 15 seconds. Switch. Try 2 rounds each side." },
        { name: "Standing knee lifts", cue: "Hold the counter. Lift the right knee up to a comfortable height, lower with control. 10 reps each side." },
      ]},
      { kicker: "Stretch", title: "Shoulder release", durationSec: 120, exercises: [
        { name: "Doorway chest stretch", cue: "Forearm on doorframe at shoulder height. Step that-side foot forward gently. 30 seconds each side." },
        { name: "Neck side stretch", cue: "Sit tall. Drop the right ear toward the right shoulder. Place the right hand lightly on top of the head — just the weight of the hand. 20 seconds each side." },
      ]},
    ],
  },
  // Wednesday — even keel
  {
    name: "Wednesday Even Keel",
    segments: [
      { kicker: "Loosen up", title: "Whole-body warm-up", durationSec: 120, exercises: [
        { name: "Shoulder rolls", cue: "Roll the shoulders backwards in big slow circles. 10 reps. Then forwards 10 reps." },
        { name: "Side bends", cue: "Stand tall, feet hip-width. Reach the right arm overhead and lean gently to the left. Switch. 5 each side." },
      ]},
      { kicker: "Breathe", title: "Coherent breathing", durationSec: 180, exercises: [
        { name: "Inhale 5, exhale 5", cue: "Breathe in through the nose for 5 counts, out through the nose for 5 counts. Steady, equal rhythm." },
        { name: "Continue for 3 minutes", cue: "About 6 breaths a minute. Used by athletes and meditators to settle the nervous system." },
      ]},
      { kicker: "Steady", title: "Posterior chain (gentle)", durationSec: 180, exercises: [
        { name: "Hip hinge with chair behind you", cue: "Stand in front of a chair. Push the hips back as if to sit down — but stop before you do. Stand up. 10 reps." },
        { name: "Standing leg lift to the back", cue: "Hold the counter. Keeping the leg straight, lift one foot a few inches behind you, lower with control. 10 each side." },
      ]},
      { kicker: "Stretch", title: "Decompress", durationSec: 120, exercises: [
        { name: "Seated forward fold", cue: "Sit on the edge of a chair, feet flat. Hinge at the hips and let the arms hang. Stop wherever feels easy. 30 seconds." },
        { name: "Seated spinal twist", cue: "Sit tall. Place the right hand on the outside of the left knee. Gently rotate the upper body left. 20 seconds each side." },
      ]},
    ],
  },
  // Thursday — energy without intensity
  {
    name: "Thursday Lift",
    segments: [
      { kicker: "Loosen up", title: "Wake up the body", durationSec: 120, exercises: [
        { name: "Heel-to-toe walking", cue: "Walk 10 steps placing the heel of the front foot directly in front of the toes of the back foot. Like a slow tightrope. Hold a wall if needed." },
        { name: "Big arm circles", cue: "Arms out to the sides. Slow forward circles 10 reps. Slow backward circles 10 reps." },
      ]},
      { kicker: "Breathe", title: "Energizing breath", durationSec: 180, exercises: [
        { name: "Three quick inhales, one long exhale", cue: "Through the nose: short sniff, sniff, sniff in. Then a long slow exhale through the mouth. Helps shake off morning grogginess. 8 cycles." },
      ]},
      { kicker: "Steady", title: "Full body, low impact", durationSec: 180, exercises: [
        { name: "Chair sit-to-stand", cue: "Sit on a sturdy chair. Stand up slowly using leg power. Sit back down with control. 10 reps." },
        { name: "Wall push-ups", cue: "Stand arm's length from a wall. Place hands on the wall at shoulder height. Bend elbows to bring chest to wall, then push back. 10 reps. Easier on shoulders than floor push-ups." },
      ]},
      { kicker: "Stretch", title: "Cool down", durationSec: 120, exercises: [
        { name: "Standing quad stretch (with support)", cue: "Hold the counter with left hand. Bend the right knee and reach for the right ankle behind you with the right hand. 20 seconds each side. Skip if it bothers the knee." },
        { name: "Standing forward fold", cue: "Knees soft. Hinge at hips and let the arms hang. Sway gently side to side. 30 seconds." },
      ]},
    ],
  },
  // Friday — clarity
  {
    name: "Friday Clarity",
    segments: [
      { kicker: "Loosen up", title: "Spine and hips", durationSec: 120, exercises: [
        { name: "Standing cat-cow", cue: "Hands on knees, slight bend. Round the back, then arch gently. 8 slow rounds." },
        { name: "Hip circles", cue: "Hands on hips. Make slow circles with the hips, as if drawing on the floor with your tailbone. 5 each direction." },
      ]},
      { kicker: "Breathe", title: "Alternate nostril breathing", durationSec: 180, exercises: [
        { name: "Right thumb closes right nostril", cue: "Sit tall. Use the right thumb to close the right nostril. Inhale slowly through the left." },
        { name: "Switch", cue: "Use the right ring finger to close the left nostril. Open the right and exhale through it." },
        { name: "Continue alternating", cue: "Inhale right, switch, exhale left. 5–6 full cycles. A traditional yogic practice for steady focus." },
      ]},
      { kicker: "Steady", title: "Core stability", durationSec: 180, exercises: [
        { name: "Seated dead bug (gentle)", cue: "Sit tall on a chair. Lift the right knee and the left arm at the same time. Lower. Switch sides. 10 each side." },
        { name: "Wall plank", cue: "Stand arm's length from a wall, place forearms on the wall. Step feet back so the body is at a slight angle. Hold a strong line for 20 seconds. 3 rounds." },
      ]},
      { kicker: "Stretch", title: "Long holds", durationSec: 120, exercises: [
        { name: "Standing hamstring stretch", cue: "Heel on the bottom stair. Keep leg straight. Hinge gently. 45 seconds each leg." },
        { name: "Seated figure-4", cue: "Cross right ankle on left knee. Sit tall, lean gently forward. 30 seconds each side." },
      ]},
    ],
  },
  // Saturday — long calm flow
  {
    name: "Saturday Long Calm",
    segments: [
      { kicker: "Loosen up", title: "Slow whole-body flow", durationSec: 120, exercises: [
        { name: "Reach up, fold down", cue: "Stand tall. Inhale, reach both arms overhead. Exhale, fold forward with soft knees. Inhale, roll up to standing. 5 slow rounds." },
        { name: "Side-to-side gentle lunges", cue: "Wide stance. Shift weight to the right, bending the right knee. Then the left. Hands can rest on thighs for support. 8 slow rounds." },
      ]},
      { kicker: "Breathe", title: "Belly breathing", durationSec: 180, exercises: [
        { name: "Hand on belly, hand on chest", cue: "Sit or lie down. Place one hand on the belly, one on the chest. Breathe so only the lower hand moves. The chest stays still." },
        { name: "Make the exhale twice as long", cue: "Inhale 4 counts, exhale 8 counts. Continue for 3 minutes. Tells the body it's safe to soften." },
      ]},
      { kicker: "Steady", title: "Easy weekend circuit", durationSec: 180, exercises: [
        { name: "Sit-to-stand × wall push-up × heel raise", cue: "5 sit-to-stands. 5 wall push-ups. 10 heel raises at the counter. Rest. Repeat the circuit twice." },
      ]},
      { kicker: "Stretch", title: "Restorative", durationSec: 120, exercises: [
        { name: "Legs up the wall (or on a chair seat)", cue: "Lie on your back. Place legs up against a wall — or simply rest the calves on a chair seat. Hands on belly. 60–90 seconds." },
        { name: "Reclined butterfly (or seated wide-knee)", cue: "Lie down with feet together, knees falling open. (Or sit with knees apart.) Breathe slowly into the belly. 60 seconds." },
      ]},
    ],
  },
];

// Pick today's routine deterministically by day of week
const todayRoutine = () => ROUTINES[new Date().getDay() % ROUTINES.length];

// ─── Decision parser ────────────────────────────────────────────────
// Decisions come from the model as free-form strings like:
//   "Trim NVDA in Fidelity TOD: 30 of 75 sh before earnings"
//   "Add VKTX 100sh on dip — GLP-2 catalyst"
//   "IONQ +45% — decide post-5/6 earnings"
//   "Set $235 stop on AAPL pre-FOMC"
// We classify the action type for color coding, extract the most likely
// ticker (1-5 uppercase letters near the start), and pull out an account
// label if one is mentioned. The original decision text becomes the
// "headline" — short version for the card. The full string is preserved
// for the detail modal.
//
// This parser is deliberately forgiving — if it can't classify, we fall
// back to a neutral "ACT" gray card. Better to render something useful
// than to crash.
const KNOWN_ACCOUNT_HINTS = [
  "Fidelity TOD", "Fidelity",
  "Schwab IRA", "Charles Schwab", "Schwab",
  "Robinhood",
  "E*TRADE", "ETrade",
  "Vanguard",
  "Webull",
  "Merrill", "Merrill Edge",
  "Interactive Brokers",
  "Public",
  "SoFi",
  "Tastytrade",
  "Roth IRA", "Roth",
  "Rollover IRA", "Rollover",
  "TOD", "IRA", "401K", "401(k)", "529",
];

// colorizePercents — wraps any percentage value in the text with a
// green or red span based on sign. Used in Market Pulse "What's moving"
// rows so positive/negative moves render in color instead of muted text.
function colorizePercents(text) {
  if (!text || typeof text !== "string") return text;
  const parts = text.split(/([+-]?\d+(?:\.\d+)?%)/g);
  return parts.map((part, i) => {
    if (/^[+-]?\d+(?:\.\d+)?%$/.test(part)) {
      const isUp = !part.startsWith("-");
      return (
        <span
          key={i}
          style={{
            color: isUp ? "#047857" : "#be123c",
            fontWeight: 700,
          }}
        >
          {part}
        </span>
      );
    }
    return part;
  });
}

function parseDecision(text) {
  if (!text || typeof text !== "string") {
    return { type: "act", typeLabel: "ACT", ticker: null, account: null, headline: "", body: text || "" };
  }
  const t = text.trim();

  // Detect action type from leading verb / strong keyword
  const lower = t.toLowerCase();
  let type = "act"; // default neutral
  if (/\btrim\b|\bsell\b|\breduce\b|\bcut\b|\boffload\b|\bexit\b|\btake (some|profit)/i.test(t))
    type = "trim";
  else if (/\badd\b|\bbuy\b|\bnibble\b|\baccumulate\b|\binitiate\b|\benter\b|\bopen\b/i.test(t))
    type = "add";
  else if (/\bset\b.*\bstop\b|\bprotect\b|\bhedge\b|\binsulate\b|\bguard\b/i.test(t))
    type = "protect";
  else if (/\bwatch\b|\bmonitor\b|\bdecide\b|\bwait\b|\bhold\b|\breview\b|\bcheck\b/i.test(t))
    type = "watch";

  // Extract first plausible ticker (uppercase 1-5 chars). Skip common
  // all-caps action verbs that would otherwise match: WATCH, TRIM, ADD, etc.
  const TICKER_BLACKLIST = new Set([
    "WATCH","TRIM","ADD","SELL","BUY","HOLD","CUT","SET","STOP","ACT",
    "TBD","NA","NONE","NEW","OLD","NEXT","GOOD","BAD","HIGH","LOW","BIG",
    "ALL","ANY","FOR","OR","AND","BUT","THE","AT","ON","IN","TO","UP","DOWN",
    "USD","EUR","GBP","JPY","CAD","AUD","CNY","INR","CHF","HKD",
  ]);
  const tickerMatches = t.match(/\b([A-Z]{1,5}(?:[.\-][A-Z])?)\b/g) || [];
  const ticker = tickerMatches.find((m) => !TICKER_BLACKLIST.has(m)) || null;

  // Detect account — pick the longest matching hint (so "Fidelity TOD" beats "Fidelity")
  let account = null;
  for (const hint of KNOWN_ACCOUNT_HINTS) {
    if (new RegExp(`\\b${hint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(t)) {
      if (!account || hint.length > account.length) account = hint;
    }
  }

  // Headline = first ~50 chars or up to first colon/em dash, whichever is shorter
  let headline = t;
  const cutChars = [": ", " — ", " - "];
  for (const c of cutChars) {
    const idx = t.indexOf(c);
    if (idx > 4 && idx < 60) { headline = t.slice(0, idx); break; }
  }
  if (headline.length > 60) headline = headline.slice(0, 57).trim() + "…";

  const typeLabel = { trim: "TRIM", add: "ADD", watch: "WATCH", protect: "PROTECT", act: "ACT" }[type];

  return { type, typeLabel, ticker, account, headline, body: t };
}

// Theme palette for action cards — lighter background, darker accent.
// Each maps to a tailwind+inline color set so the cards are vibrant
// but readable.
const DECISION_THEMES = {
  trim:    { bg: "linear-gradient(135deg, #fef2f2 0%, #fde3e3 100%)", border: "#fca5a5", iconBg: "#dc2626", labelText: "#7f1d1d", accentText: "#991b1b", chevron: "#7f1d1d", shadow: "rgba(220,38,38,0.18)" },
  add:     { bg: "linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)", border: "#6ee7b7", iconBg: "#059669", labelText: "#064e3b", accentText: "#047857", chevron: "#064e3b", shadow: "rgba(5,150,105,0.18)" },
  watch:   { bg: "linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)", border: "#fcd34d", iconBg: "#d97706", labelText: "#78350f", accentText: "#92400e", chevron: "#78350f", shadow: "rgba(217,119,6,0.18)" },
  protect: { bg: "linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)", border: "#93c5fd", iconBg: "#2563eb", labelText: "#1e3a8a", accentText: "#1e40af", chevron: "#1e3a8a", shadow: "rgba(37,99,235,0.18)" },
  act:     { bg: "linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)", border: "#cbd5e1", iconBg: "#475569", labelText: "#0f172a", accentText: "#334155", chevron: "#0f172a", shadow: "rgba(71,85,105,0.18)" },
};

// ─── Demo brief ─────────────────────────────────────────────────────
const buildDemoBrief = (name, portfolio, holdings = []) => ({
  affirmation: "Steady hands. Clear eyes. The plan beats the impulse.",
  market_pulse: {
    tone: "cautious",
    summary: "Futures mixed into a heavy week with central banks on deck. Energy firm; semis stretched. Patient setups beat aggressive ones.",
    key_levels: [
      "S&P futures roughly flat",
      "VIX climbing toward 19",
      "Crude near $96",
      "Megacap earnings on deck",
    ],
  },
  smart_money: {
    summary: {
      most_bought: ["NVDA", "MSFT"],
      most_sold: ["AAPL", "TSLA"],
      net_bullish_sectors: ["AI Infrastructure", "Nuclear / Power", "Critical Minerals"],
      net_bearish_sectors: ["Consumer Discretionary"],
    },
    sector_heatmap: [
      { sector: "AI Infrastructure", direction: "buying", intensity: 5 },
      { sector: "Semiconductors", direction: "buying", intensity: 4 },
      { sector: "Nuclear / Power", direction: "buying", intensity: 4 },
      { sector: "Critical Minerals", direction: "buying", intensity: 3 },
      { sector: "Biotech (Oncology)", direction: "buying", intensity: 2 },
      { sector: "Financials", direction: "neutral", intensity: 1 },
      { sector: "Consumer Discretionary", direction: "selling", intensity: 3 },
      { sector: "Real Estate", direction: "selling", intensity: 2 },
    ],
    whale_moves: [
      {
        text: "Berkshire Hathaway trimmed AAPL ~13% (Q1 13F)",
        ticker: "AAPL",
        source_url: "https://stockcircle.com/portfolio/warren-buffett",
      },
      {
        text: "Bridgewater added 2.3M NVDA shares last quarter",
        ticker: "NVDA",
        source_url: "https://whalewisdom.com/filer/bridgewater-associates-lp",
      },
      {
        text: "Pershing Square initiated 1.2M GOOGL position",
        ticker: "GOOGL",
        source_url: "https://stockcircle.com/portfolio/bill-ackman",
      },
      {
        text: "Tepper added 800K AMZN, doubled META stake",
        ticker: "META",
        source_url: "https://stockcircle.com/portfolio/david-tepper",
      },
      {
        text: "Druckenmiller built new 2.1M position in TSM",
        ticker: "TSM",
        source_url: "https://stockcircle.com/portfolio/stanley-druckenmiller",
      },
    ],
    congress_moves: [
      {
        text: "Pelosi disclosed $1-5M META calls (4/12)",
        ticker: "META",
        source_url: "https://www.capitoltrades.com/politicians/P000197",
      },
      {
        text: "Sen. Tuberville bought MSFT $50-100K (3/28)",
        ticker: "MSFT",
        source_url: "https://www.capitoltrades.com/trades?txType=buy&assetType=stock",
      },
      {
        text: "Rep. Crenshaw added LMT $15-50K (4/05)",
        ticker: "LMT",
        source_url: "https://www.quiverquant.com/congresstrading/",
      },
      {
        text: "Sen. Whitehouse disclosed CEG buy $50-100K (4/08)",
        ticker: "CEG",
        source_url: "https://www.capitoltrades.com/trades",
      },
      {
        text: "Rep. Greene added NVDA $15-50K (4/10)",
        ticker: "NVDA",
        source_url: "https://www.quiverquant.com/congresstrading/",
      },
    ],
    hedge_fund_moves: [
      {
        text: "Citadel rotating into nuclear: VST, CEG, OKLO",
        ticker: "OKLO",
        source_url: "https://hedgefollow.com/funds/Citadel+Advisors+LLC",
      },
      {
        text: "Renaissance added 4M VRT shares (data center play)",
        ticker: "VRT",
        source_url: "https://whalewisdom.com/filer/renaissance-technologies-llc",
      },
      {
        text: "Two Sigma initiated 1.5M IONQ stake last quarter",
        ticker: "IONQ",
        source_url: "https://whalewisdom.com/filer/two-sigma-investments-lp",
      },
      {
        text: "Millennium accumulated 3.2M MP shares (rare earths)",
        ticker: "MP",
        source_url: "https://whalewisdom.com/filer/millennium-management-llc",
      },
      {
        text: "Coatue rotated out of TSLA, added GOOGL + META",
        ticker: "GOOGL",
        source_url: "https://hedgefollow.com/funds/Coatue+Management",
      },
    ],
  },
  // ─── Today's Edge — Tier 1 alerts ────────────────────────────────────────
  todays_edge: {
    earnings_alerts: [
      { ticker: "AAPL", when: "today after close", your_shares: 35 },
    ],
    binary_catalysts: [
      { ticker: "IONQ", event: "earnings 5/6", context: "after 41% run-up — consider trim" },
      { ticker: "MP", event: "earnings 5/7", context: "rare earths thesis check-in" },
    ],
    risk_flags: [
      { ticker: "GE", flag: "44% of Roth IRA — concentration risk", suggested_action: "trim toward 20 shares" },
    ],
  },
  conviction_watch: (portfolio.slice(0, 5).length ? portfolio.slice(0, 5) : ["SPY", "QQQ", "AAPL"]).map((t, i) => ({
    ticker: t,
    signal: ["hold", "add", "hold", "trim", "hold"][i] || "hold",
    why_now: [
      "Earnings cycle near. Implied move ~4-6%. Position size already meaningful.",
      "Multiple compressed after recent pullback; thematic tailwinds intact for AI infra spend.",
      "Thesis unchanged: cash flow growth + share buyback. No catalyst to act.",
      "Up 30%+ over six weeks. Take some off into strength — keep core position.",
      "Slow consolidation. Wait for breakout volume before adding.",
    ][i] || "Thesis unchanged. Hold and observe.",
    note: ["Hold through earnings.", "Add on weakness.", "Thesis intact.", "Lock in gains.", "Steady core."][i] || "Steady core.",
    action: i === 1 ? "Add 10 shares on dip below recent support." : i === 3 ? "Trim 25% — lock partial gain into strength." : undefined,
  })),
  // ─── On Your Radar — thematic stocks user does not own but should watch ───
  radar_watch: [
    {
      ticker: "TSM",
      theme: "Semiconductors · AI infra",
      headline: "TSMC capex guidance raised — accelerating fab buildout",
      why_now: "Picks-and-shovels play for the entire AI chip cycle. Whale accumulation visible.",
    },
    {
      ticker: "CEG",
      theme: "Nuclear · AI energy",
      headline: "Constellation tightening data-center power deals",
      why_now: "Nuclear-AI thesis is your conviction zone. Watch for entry on any pullback.",
    },
    {
      ticker: "MP",
      theme: "Rare earths · Critical minerals",
      headline: "Mountain Pass volumes ramping; pricing firm",
      why_now: "China export restrictions tighten supply. You already track this on watchlist.",
    },
  ],
  mindset: {
    gratitude: (() => {
      // Rotates daily through three voices: Stoic warrior, Quiet power, Athlete mindset
      const rotation = [
        // — Stoic warrior (Marcus Aurelius / Seneca / Epictetus energy) —
        name ? `${name}, the obstacle is the path. Today's friction is making you sharper.` : "The obstacle is the path. Today's friction is making you sharper.",
        "What you've already endured proves you can carry today too.",
        "You don't control the market. You control your patience and your size.",
        "Discomfort is the price of becoming. Pay it gladly.",
        "The work you did yesterday is already protecting you today.",
        "No edge is built in a single morning — but every morning either builds it or burns it.",
        "Decide once, well, then execute without flinching.",
        // — Quiet power (Lao Tzu / Rumi / Thich Nhat Hanh energy) —
        name ? `${name}, the still mind sees what the busy mind misses.` : "The still mind sees what the busy mind misses.",
        "There is fire inside you. Stillness is how it gathers, not how it dies.",
        "Move slowly when others rush. That is when the real moves are seen.",
        "What is yours to do today will reveal itself. Meet it ready.",
        "Be the one who waits well. The market rewards patience more than speed.",
        "You are the long position on yourself. Compound.",
        "Breath first. Conviction second. Action third.",
        // — Athlete mindset (grounded performance / training-day energy) —
        name ? `${name}, today is a rep. Make it count, then let it go.` : "Today is a rep. Make it count, then let it go.",
        "Show up the same on the green days and the red days. That's the whole game.",
        "Recovery is part of the work. Energy in, energy out, then again tomorrow.",
        "The plan beats the impulse. Trust what you decided when you were calm.",
        "Strong mornings make sharp afternoons. Build the body that holds the conviction.",
        "Process over outcome. Outcomes follow process — never the other way.",
        "You're playing a long season. Today is one game, not the championship.",
      ];
      return rotation[new Date().getDate() % rotation.length];
    })(),
    fuel: "10-min vitality routine: 2 min mobility · 3 min breathwork · 3 min strength · 2 min stretch.",
    focus: "Four-second inhale, six-second exhale, three rounds.",
  },
  // ─── Clarity — contemplation, eastern wisdom, breath practice ───
  clarity: (() => {
    const day = new Date().getDate();
    const contemplations = [
      "What I cannot control today, I can release with grace.",
      "Stillness is itself a position. Sometimes the wisest trade is none.",
      "The version of me showing up tomorrow depends on what I practice today.",
      "Outcomes I cannot force; effort I can choose. I choose effort.",
      "What I water grows. Today I water patience.",
      "I am not my last trade, my best trade, or my worst trade. I am the one who keeps showing up.",
      "Slow is smooth. Smooth is fast. Today I move at the pace of clarity.",
    ];
    const wisdoms = [
      { quote: "Yatha bhumi, tatha bija — as is the soil, so is the seed. Tend the inner ground first.", source: "Sanskrit teaching" },
      { quote: "When the student is ready, the teacher appears. When the trader is ready, the trade appears.", source: "Zen proverb" },
      { quote: "The mind is everything. What you think, you become.", source: "Buddha (Dhammapada)" },
      { quote: "Knowing others is intelligence. Knowing yourself is true wisdom.", source: "Lao Tzu" },
      { quote: "Out beyond ideas of right and wrong, there is a field. I'll meet you there.", source: "Rumi" },
      { quote: "The wound is the place where the Light enters you.", source: "Rumi" },
      { quote: "Sat chit ananda — being, awareness, bliss. Already here, simply uncovered.", source: "Vedanta" },
    ];
    const breaths = [
      { name: "Box Breathing", pattern: "4 in · 4 hold · 4 out · 4 hold", description: "Used by Navy SEALs to settle the nervous system before high-stakes decisions.", rounds: "Repeat 4 rounds" },
      { name: "Coherent Breathing", pattern: "5 seconds in · 5 seconds out", description: "Heart rate variability rises. Mind clears. Six breaths per minute is the sweet spot.", rounds: "Continue for 3 minutes" },
      { name: "Bhramari (Bee Breath)", pattern: "Inhale fully · exhale with a soft humming sound", description: "Vibration calms the vagus nerve. Brings stillness fast — even with eyes open.", rounds: "5 rounds" },
      { name: "4-7-8 Calm Breath", pattern: "Inhale 4 · hold 7 · exhale 8", description: "Andrew Weil's signature pattern. Triggers parasympathetic shift — the body's 'safe' signal.", rounds: "4 rounds" },
      { name: "Nadi Shodhana (Alternate Nostril)", pattern: "Right nostril in · left nostril out · alternate", description: "Yogic practice that balances the two hemispheres. Sharpens focus before decisions.", rounds: "10 cycles each side" },
      { name: "Physiological Sigh", pattern: "Two short inhales through nose · one long exhale through mouth", description: "The fastest way (per Stanford research) to drop stress in real time.", rounds: "3 sighs" },
      { name: "Ujjayi (Ocean Breath)", pattern: "Slight throat constriction · audible sound on inhale and exhale", description: "Generates inner heat and steady focus. Used in moving meditation.", rounds: "12 breaths" },
    ];
    return {
      contemplation: contemplations[day % contemplations.length],
      eastern_wisdom: wisdoms[day % wisdoms.length],
      breath_practice: breaths[day % breaths.length],
    };
  })(),
  // ─── Daily Power Plate — high-protein dinner with grocery list ───
  power_plate: (() => {
    const day = new Date().getDate();
    const plates = [
      // — High Protein —
      {
        name: "Sheet Pan Chicken & Greens",
        style: "High Protein",
        protein_g: 42,
        prep_min: 30,
        description: "Sheet pan dinner: roasted chicken thighs with charred broccoli and lemon. Minimal cleanup, maximum protein.",
        groceries: [
          "4 boneless skinless chicken thighs (~1.25 lb)",
          "1 large head broccoli",
          "1 lemon",
          "Olive oil · garlic · paprika · salt · pepper",
        ],
        prep_steps: [
          "Heat oven to 425°F. Toss chicken with olive oil, paprika, garlic, salt.",
          "Spread chicken + broccoli florets on sheet pan.",
          "Roast 22–25 min until chicken hits 165°F.",
          "Squeeze lemon over the top before serving.",
        ],
      },
      // — Mediterranean —
      {
        name: "Mediterranean Salmon Bowl",
        style: "Mediterranean",
        protein_g: 38,
        prep_min: 25,
        description: "Pan-seared salmon over a warm grain bowl with cucumber, tomato, olives, and lemon-yogurt drizzle.",
        groceries: [
          "6 oz salmon fillet",
          "½ cup farro or quinoa",
          "Cucumber · cherry tomatoes · kalamata olives",
          "Greek yogurt · lemon · dill · olive oil",
        ],
        prep_steps: [
          "Cook farro per package (~20 min).",
          "Sear salmon skin-side-down 4 min, flip 2 min.",
          "Build bowl: grain, cucumber, tomato, olives, salmon.",
          "Top with yogurt + lemon + dill drizzle.",
        ],
      },
      // — Anti-Inflammatory —
      {
        name: "Turmeric Lentil & Shrimp Skillet",
        style: "Anti-Inflammatory",
        protein_g: 36,
        prep_min: 30,
        description: "One-skillet shrimp with turmeric-spiced red lentils, ginger, and spinach. Strong on omega-3s and curcumin.",
        groceries: [
          "8 oz wild shrimp (peeled)",
          "¾ cup red lentils",
          "Fresh ginger · turmeric · cumin",
          "Bag of baby spinach · 1 onion · garlic · olive oil",
        ],
        prep_steps: [
          "Sauté onion, garlic, ginger, turmeric in olive oil 3 min.",
          "Add lentils + 2 cups water, simmer 15 min.",
          "Stir in shrimp + spinach, cook 4–5 min until shrimp pink.",
          "Season with salt, lemon, fresh black pepper.",
        ],
      },
      // — High Protein —
      {
        name: "Steak & Sweet Potato Hash",
        style: "High Protein",
        protein_g: 45,
        prep_min: 25,
        description: "Seared sirloin sliced over a quick sweet potato hash with onions and arugula. Iron-rich, satisfying.",
        groceries: [
          "8 oz sirloin or flank steak",
          "1 medium sweet potato",
          "1 onion · arugula",
          "Olive oil · garlic · salt · black pepper",
        ],
        prep_steps: [
          "Dice sweet potato small, sauté with onion in olive oil 12 min.",
          "Salt the steak well, sear 4 min per side, rest 5 min.",
          "Slice steak against the grain.",
          "Plate hash, top with arugula, fan steak slices over the top.",
        ],
      },
      // — Mediterranean —
      {
        name: "Greek Chicken Souvlaki Plate",
        style: "Mediterranean",
        protein_g: 40,
        prep_min: 25,
        description: "Lemon-oregano chicken with a chopped Greek salad and warm pita. Bright, fresh, fast.",
        groceries: [
          "1 lb chicken breast, cubed",
          "Cucumber · tomato · red onion · feta",
          "Pita bread (whole wheat)",
          "Olive oil · lemon · oregano · garlic",
        ],
        prep_steps: [
          "Marinate chicken 10 min in olive oil + lemon + oregano + garlic.",
          "Sear chicken in hot pan 6–8 min until cooked through.",
          "Chop cucumber, tomato, red onion; toss with feta + olive oil.",
          "Warm pita; serve chicken + salad together.",
        ],
      },
      // — Anti-Inflammatory —
      {
        name: "Miso-Glazed Cod with Bok Choy",
        style: "Anti-Inflammatory",
        protein_g: 34,
        prep_min: 20,
        description: "Quick miso-marinated cod broiled with sesame ginger bok choy. Light but satiating.",
        groceries: [
          "6 oz cod fillet",
          "2 baby bok choy",
          "White miso paste · soy sauce · honey · sesame oil",
          "Fresh ginger · scallion · sesame seeds",
        ],
        prep_steps: [
          "Whisk 2 tbsp miso + 1 tbsp soy + 1 tsp honey. Brush on cod.",
          "Broil cod 6–8 min until flaky.",
          "Sauté bok choy + ginger in sesame oil 3 min.",
          "Plate, garnish with scallion + sesame seeds.",
        ],
      },
      // — High Protein —
      {
        name: "Turkey & White Bean Skillet",
        style: "High Protein",
        protein_g: 44,
        prep_min: 25,
        description: "Lean ground turkey with cannellini beans, kale, and tomato. One pan, packs leftovers well.",
        groceries: [
          "1 lb 93% lean ground turkey",
          "1 can cannellini beans",
          "1 bunch kale · 1 onion · 2 garlic cloves",
          "1 can diced tomatoes · olive oil · Italian herbs · chili flakes",
        ],
        prep_steps: [
          "Brown turkey with onion + garlic in olive oil, 7 min.",
          "Add tomatoes, beans (drained), herbs, simmer 5 min.",
          "Stir in chopped kale, cook 3 min until wilted.",
          "Season with salt, chili flakes, drizzle of olive oil.",
        ],
      },
    ];
    return plates[day % plates.length];
  })(),
  decisions: (() => {
    // If we have real holdings, build personalized examples from them
    if (holdings && holdings.length > 0) {
      const out = [];
      // Sort by largest gain first
      const sorted = [...holdings].filter((h) => h.qty != null).sort((a, b) => (b.gainPct || 0) - (a.gainPct || 0));

      // Big winner — suggest trimming
      const winner = sorted.find((h) => h.gainPct != null && h.gainPct > 25);
      if (winner) {
        const trimQty = Math.floor(winner.qty * 0.4);
        out.push(`${winner.symbol} +${winner.gainPct.toFixed(0)}% on ${winner.qty} sh. Trim ${trimQty} into strength, keep ${winner.qty - trimQty}.`);
      }

      // Loser bottoming — suggest watching for support
      const loser = sorted.find((h) => h.gainPct != null && h.gainPct < -5);
      if (loser) {
        out.push(`${loser.symbol} ${loser.qty}sh ${loser.gainPct.toFixed(0)}%. Watch for base; add only on volume confirmation.`);
      }

      // Mid-position to monitor
      const mid = sorted.find((h) => h.gainPct != null && h.gainPct >= 0 && h.gainPct <= 15) || sorted[Math.floor(sorted.length / 2)];
      if (mid) {
        out.push(`${mid.symbol}: hold ${mid.qty}sh through this cycle. No add until next setup.`);
      }

      out.push("Set 3 alerts only — top winner stop, top loser support, FOMC headline.");
      out.push("Close laptop after the open. Trust this morning's plan.");

      return out.slice(0, 5);
    }

    // No holdings — give specific tickers from watchlist if we have them, otherwise generic prompts
    if (portfolio && portfolio.length > 0) {
      const t1 = portfolio[0];
      const t2 = portfolio[1] || portfolio[0];
      return [
        `${t1}: check earnings calendar before any add.`,
        `${t2}: pre-decide stop level before market open.`,
        "Upload portfolio CSV for personalized recommendations.",
        "No new positions before known macro events.",
        "Close laptop after the open. Trust the plan.",
      ];
    }

    // First-time empty state
    return [
      "Add tickers in Settings to get personalized analysis.",
      "Upload portfolio CSV in Wealth → Conviction Watch.",
      "Pre-decide exits before catalysts, not during them.",
      "Set alerts only at key levels — not for every tick.",
      "Close laptop after the open. Trust the plan.",
    ];
  })(),
});

// ════════════════════════════════════════════════════════════════════
//                            MAIN APP
// ════════════════════════════════════════════════════════════════════

export default function MorningEdge() {
  const [phase, setPhase] = useState("loading");
  const [name, setName] = useState("");
  const [portfolio, setPortfolio] = useState([]);
  const [holdings, setHoldings] = useState([]); // [{ symbol, qty, cost, value, gainPct }]
  const [holdingsRefreshedAt, setHoldingsRefreshedAt] = useState(null); // ms timestamp
  const [brief, setBrief] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingStatusIdx, setLoadingStatusIdx] = useState(0); // rotates through personalized status messages while brief loads
  const [error, setError] = useState(null);
  const [openDecisionIdx, setOpenDecisionIdx] = useState(null); // null when closed; otherwise the index of the decision being viewed in the detail modal
  const [showSettings, setShowSettings] = useState(false);
  const [showBrokerageGuide, setShowBrokerageGuide] = useState(false);
  const [showPremium, setShowPremium] = useState(false);
  const [tickerInput, setTickerInput] = useState("");
  const [tempName, setTempName] = useState("");
  const [tempPortfolio, setTempPortfolio] = useState([]);
  const [filter, setFilter] = useState("all"); // all | health | wealth | clarity
  const [showCsvImport, setShowCsvImport] = useState(false);
  const [csvImportMessage, setCsvImportMessage] = useState(null);
  const csvFileInputRef = React.useRef(null);
  const [completedDecisions, setCompletedDecisions] = useState({}); // { "2026-04-29": [0, 2] }
  const [dismissedDecisions, setDismissedDecisions] = useState({}); // { "2026-04-29": [1, 3] }
  const [accountsState, setAccountsState] = useState([]); // [{ id, name, brokerage, uploadedAt, holdingCount }]
  const [pendingCsvUpload, setPendingCsvUpload] = useState(null); // { newHoldings, tickers, brokerageGuess } awaiting label
  const [accountLabelDraft, setAccountLabelDraft] = useState("");
  const [editingAccountId, setEditingAccountId] = useState(null);
  const [editingAccountName, setEditingAccountName] = useState("");
  const [routineDays, setRoutineDays] = useState({}); // { "2026-04-29": true }
  const [routineFlowOpen, setRoutineFlowOpen] = useState(false);
  const [expandedMindset, setExpandedMindset] = useState(null); // 'gratitude' | 'fuel' | 'focus' | null
  const [inAppBrowserUrl, setInAppBrowserUrl] = useState(null); // URL shown in the confirmation modal
  // Open a URL in the user's native browser, then show a small confirmation
  // modal. CRITICAL: window.open() must run synchronously inside the user's
  // tap handler, otherwise iOS Safari blocks it as a popup. Always go
  // through this helper from click handlers — never call setInAppBrowserUrl
  // alone or the link won't actually open.
  const openLinkInBrowser = (url) => {
    if (!url) return;
    if (typeof window !== "undefined") {
      window.open(url, "_blank", "noopener,noreferrer");
    }
    setInAppBrowserUrl(url);
  };
  const [pullProgress, setPullProgress] = useState(0); // 0..1 for pull-to-refresh indicator
  const [isMobile, setIsMobile] = useState(false);

  // ─── Chat feature ─────────────────────────────────────────────────
  // Live conversational AI about a specific card from the brief. The user
  // taps "Ask about this" on any card; chatContext gets the card's data
  // and the chat sheet opens with a pre-filled welcome from Claude.
  // Conversations persist per card-id in localStorage so the user can
  // close and re-open the chat without losing thread.
  const [chatContext, setChatContext] = useState(null); // { id, type, ticker, description } or null when closed
  const [chatMessages, setChatMessages] = useState([]); // [{ role: 'user' | 'assistant', content: '...' }]
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState(null);
  const [cashBalance, setCashBalance] = useState(null); // optional user-entered cash to deploy

  // ─── Reading page state ──────────────────────────────────────────
  // The reading page is the deep "why" view that opens when the user
  // taps any card (Playbook, Conviction, Radar). Shows the full
  // deep_reasoning paragraph in plain English. Has an "Ask about this"
  // button at the bottom that opens the chat sheet for personalized
  // follow-up. This is the user's first stop for understanding the
  // suggestion — chat is the second stop for personal questions.
  const [readingPage, setReadingPage] = useState(null); // { id, type, ticker, signal, headline, body, deep_reasoning, accountContext, holding } or null

  // ─── Source Detail Sheet state ───────────────────────────────────
  // When user taps any Insider Flow row (whale/congress/hedge), open a
  // sheet showing: the trade headline, a "why it matters" paragraph,
  // and a list of source buttons each labeled with what the user will
  // find there. Lets the user verify with the appropriate source rather
  // than dumping them on a generic Yahoo Finance page.
  const [sourceDetail, setSourceDetail] = useState(null); // { category, text, ticker, why_matters } or null

  // Open the chat sheet with a specific card's context. Restores previous
  // conversation from localStorage if one exists for this card.
  const openChat = (ctx) => {
    if (!ctx || !ctx.id) return;
    setChatContext(ctx);
    setChatError(null);
    setChatInput("");
    // Try to restore prior conversation for this card
    try {
      const stored = localStorage.getItem(`me-chat-${ctx.id}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setChatMessages(parsed);
          return;
        }
      }
    } catch (_e) { /* ignore */ }
    setChatMessages([]);
  };

  const closeChat = () => {
    setChatContext(null);
    setChatMessages([]);
    setChatInput("");
    setChatError(null);
  };

  // Persist conversation when it changes
  useEffect(() => {
    if (!chatContext || !chatContext.id) return;
    if (chatMessages.length === 0) return;
    try {
      localStorage.setItem(`me-chat-${chatContext.id}`, JSON.stringify(chatMessages));
    } catch (_e) { /* ignore quota errors */ }
  }, [chatContext, chatMessages]);

  // Send a chat message. Calls /api/chat with full context.
  const sendChatMessage = async (text) => {
    if (!text || !text.trim() || chatLoading) return;
    const userMsg = { role: "user", content: text.trim() };
    const newMessages = [...chatMessages, userMsg];
    setChatMessages(newMessages);
    setChatInput("");
    setChatLoading(true);
    setChatError(null);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newMessages,
          cardContext: chatContext,
          portfolio: {
            holdings: holdings,
            cashBalance: cashBalance,
          },
          briefSummary: brief?.market_pulse ? {
            tone: brief.market_pulse.tone,
            summary: brief.market_pulse.summary,
            date: new Date().toISOString().slice(0, 10),
          } : null,
          userName: name,
        }),
      });
      if (!res.ok) throw new Error(`Chat API ${res.status}`);
      const data = await res.json();
      if (!data.reply) throw new Error("Empty reply");
      setChatMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
    } catch (e) {
      console.warn("Chat error:", e);
      setChatError("Couldn't get a response. Try again in a moment.");
    } finally {
      setChatLoading(false);
    }
  };

  useEffect(() => {
    (async () => {
      const saved = await Store.get("me-user");
      if (saved && saved.name) {
        setName(saved.name);
        setPortfolio(saved.portfolio || []);
        setPhase("app");
      } else setPhase("onboard-1");

      // Load progress
      const progress = await Store.get("me-progress");
      if (progress) {
        setCompletedDecisions(progress.completedDecisions || {});
        setDismissedDecisions(progress.dismissedDecisions || {});
        setRoutineDays(progress.routineDays || {});
      }

      // Load optional cash balance for chat-driven position sizing
      try {
        const cashStored = localStorage.getItem("me-cash");
        if (cashStored) {
          const parsed = parseFloat(cashStored);
          if (!isNaN(parsed) && parsed >= 0) setCashBalance(parsed);
        }
      } catch (_e) { /* ignore */ }

      // Load accounts (multi-account schema)
      const acctData = await Store.get("me-accounts");
      let loadedAccounts = (acctData && acctData.accounts) || [];

      // Load holdings (full position data)
      const h = await Store.get("me-holdings");
      if (h) {
        let loadedHoldings = h.holdings || [];
        // Migration: if there are holdings but no accounts, wrap them under a synthetic "Imported earlier" account
        const hasUntagged = loadedHoldings.some((row) => !row.accountId);
        if (loadedHoldings.length > 0 && (loadedAccounts.length === 0 || hasUntagged)) {
          const legacyId = loadedAccounts.find((a) => a.id === "legacy")
            ? "legacy"
            : "legacy";
          if (!loadedAccounts.find((a) => a.id === legacyId)) {
            loadedAccounts = [
              ...loadedAccounts,
              {
                id: legacyId,
                name: "Imported earlier",
                brokerage: "",
                uploadedAt: h.refreshedAt || Date.now(),
                holdingCount: loadedHoldings.filter((r) => !r.accountId).length,
              },
            ];
          }
          loadedHoldings = loadedHoldings.map((row) =>
            row.accountId ? row : { ...row, accountId: legacyId }
          );
        }
        setHoldings(loadedHoldings);
        setHoldingsRefreshedAt(h.refreshedAt || null);
      }
      setAccountsState(loadedAccounts);
    })();
  }, []);

  useEffect(() => {
    if (phase === "app") Store.set("me-user", { name, portfolio });
  }, [name, portfolio, phase]);

  useEffect(() => {
    if (phase === "app") Store.set("me-progress", { completedDecisions, dismissedDecisions, routineDays });
  }, [completedDecisions, dismissedDecisions, routineDays, phase]);

  useEffect(() => {
    if (phase === "app") Store.set("me-accounts", { accounts: accountsState });
  }, [accountsState, phase]);

  // Detect mobile/tablet for device-aware brokerage links.
  // Width OR coarse pointer (covers iPad-as-laptop edge cases).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const check = () => {
      const narrow = window.innerWidth < 900;
      const coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
      setIsMobile(narrow || coarse);
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    // Persist holdings to localStorage on any change, including when
    // emptied. The previous version only saved when holdings.length > 0,
    // which meant deleting all holdings left the OLD list in storage —
    // so on next load the deleted holdings would reappear. Saving on
    // every change (after onboarding) keeps storage in sync with state.
    if (phase === "app") {
      Store.set("me-holdings", { holdings, refreshedAt: holdingsRefreshedAt });
    }
  }, [holdings, holdingsRefreshedAt, phase]);

  // ─── Live price fetching ─────────────────────────────────────────
  // When holdings load (or change), fetch current prices from /api/prices.
  // Updates each holding's gainPct based on today's price change.
  // The /api/prices endpoint uses Finnhub when FINNHUB_API_KEY is set on
  // Vercel; without the key it returns an empty object and the ticker
  // gracefully shows no percentages (see HoldingsMarquee).
  // We refetch every 5 minutes during market hours, and on first load.
  useEffect(() => {
    if (phase !== "app") return;
    if (!holdings || holdings.length === 0) return;

    let cancelled = false;
    const fetchPrices = async () => {
      try {
        // Build a unique list of symbols to query
        const symbols = Array.from(
          new Set(holdings.map((h) => h.symbol).filter(Boolean))
        );
        if (symbols.length === 0) return;

        const res = await fetch("/api/prices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbols }),
        });
        if (!res.ok) return;
        const data = await res.json();
        const prices = data?.prices || {};
        if (cancelled) return;

        // Merge price data into holdings — only updates gainPct, leaves
        // other fields (qty, cost, accountId) untouched.
        setHoldings((prev) =>
          prev.map((h) => {
            const p = prices[h.symbol];
            if (!p) return h;
            return {
              ...h,
              currentPrice: p.price,
              gainPct: p.changePct, // today's % change, not lifetime
              dayChange: p.change,  // today's $ change per share
            };
          })
        );
      } catch (e) {
        // Silent failure — better to show no percentages than fake ones.
        // The console warning helps debugging if a key is misconfigured.
        console.warn("Price fetch failed:", e);
      }
    };

    // Fetch immediately, then refresh every 5 minutes while the app is
    // open. This keeps the ticker fresh without hammering Finnhub.
    fetchPrices();
    const interval = setInterval(fetchPrices, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // We deliberately use a stable string key derived from the symbol
    // list (not holdings.length) so the effect re-fires when symbols
    // CHANGE, not just when count changes. setHoldings inside the
    // effect updates gainPct only — symbol list stays the same — so
    // this avoids the infinite loop you'd get from depending on holdings.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, holdings.map((h) => h.symbol).filter(Boolean).sort().join(",")]);

  // Rotate the loading status message every 2.2s while a brief is being
  // generated. Makes the wait feel personalized and active rather than
  // a static spinner — the user sees the app is doing real work for them.
  useEffect(() => {
    if (!loading) {
      setLoadingStatusIdx(0);
      return;
    }
    const id = setInterval(() => {
      setLoadingStatusIdx((i) => i + 1);
    }, 2200);
    return () => clearInterval(id);
  }, [loading]);

  // Helpers for daily key
  const todayKey = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);

  const toggleDecision = (idx) => {
    setCompletedDecisions((prev) => {
      const list = prev[todayKey] || [];
      const next = list.includes(idx) ? list.filter((x) => x !== idx) : [...list, idx];
      return { ...prev, [todayKey]: next };
    });
    // If user accepts a decision, also clear it from dismissed for today
    setDismissedDecisions((prev) => {
      const list = prev[todayKey] || [];
      if (!list.includes(idx)) return prev;
      return { ...prev, [todayKey]: list.filter((x) => x !== idx) };
    });
  };
  const decisionsDoneToday = completedDecisions[todayKey] || [];
  const decisionsDismissedToday = dismissedDecisions[todayKey] || [];

  const toggleDismiss = (idx) => {
    setDismissedDecisions((prev) => {
      const list = prev[todayKey] || [];
      const next = list.includes(idx) ? list.filter((x) => x !== idx) : [...list, idx];
      return { ...prev, [todayKey]: next };
    });
    // If user dismisses a decision, also clear it from completed for today
    setCompletedDecisions((prev) => {
      const list = prev[todayKey] || [];
      if (!list.includes(idx)) return prev;
      return { ...prev, [todayKey]: list.filter((x) => x !== idx) };
    });
  };

  // ─── Account helpers (multi-account CSV) ───────────────────────────
  const accountById = (id) => accountsState.find((a) => a.id === id) || null;

  const renameAccount = (id, newName) => {
    const trimmed = (newName || "").trim();
    if (!trimmed) return;
    setAccountsState((prev) => prev.map((a) => (a.id === id ? { ...a, name: trimmed } : a)));
  };

  const deleteAccount = (id) => {
    if (typeof window !== "undefined") {
      const acct = accountById(id);
      const label = acct ? acct.name : "this account";
      const ok = window.confirm(`Remove "${label}"? Holdings from this account will be cleared.`);
      if (!ok) return;
    }
    setAccountsState((prev) => prev.filter((a) => a.id !== id));
    setHoldings((prev) => {
      const remaining = prev.filter((h) => h.accountId !== id);
      // If no holdings remain, also clear the "loaded today" timestamp
      // so the UI doesn't show a stale freshness indicator.
      if (remaining.length === 0) setHoldingsRefreshedAt(null);
      return remaining;
    });
  };

  const toggleRoutineComplete = () => {
    setRoutineDays((prev) => ({ ...prev, [todayKey]: !prev[todayKey] }));
  };
  const routineDoneToday = !!routineDays[todayKey];

  // Calculate routine streak: consecutive days ending today (or yesterday if today not done)
  const routineStreak = useMemo(() => {
    let count = 0;
    let cursor = new Date();
    // If today not done, start counting from yesterday (so streak doesn't break until 2 days off)
    if (!routineDays[todayKey]) cursor.setDate(cursor.getDate() - 1);
    while (true) {
      const k = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
      if (routineDays[k]) {
        count++;
        cursor.setDate(cursor.getDate() - 1);
      } else break;
      if (count > 365) break; // safety
    }
    return count;
  }, [routineDays, todayKey]);

  const sigVerified = useMemo(() => fnv1a(SIGNATURE) === SIG_EXPECTED, []);
  const sigHash = useMemo(() => fnv1a(SIGNATURE), []);

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });
  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 18) return "Good afternoon";
    return "Good evening";
  })();

  const callAPI = async (opts = {}) => {
    const fresh = opts && opts.fresh === true;
    const url = fresh ? "/api/brief?fresh=1" : "/api/brief";
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name || "the user",
        watchlist: portfolio,
        holdings: holdings, // Full position data (symbol, qty, cost, value, gainPct, accountId)
        accounts: accountsState, // [{ id, name, brokerage, ... }] so server can name accounts in decisions
        holdingsAgeDays: holdingsAgeDays,
        date: today,
      }),
    });
    if (!response.ok) {
      let errBody = ""; try { errBody = await response.text(); } catch {}
      throw new Error(`API ${response.status}: ${errBody.slice(0, 200)}`);
    }
    return response.json();
  };

  // ─── Streaming brief fetch ────────────────────────────────────────
  // Uses Server-Sent Events from /api/brief?stream=1. The server runs
  // the brief in 3 parallel chunks (light, pulse, smart_money) and
  // streams each chunk's JSON the moment it lands. We merge into the
  // brief state progressively, so the UI populates over ~10-30 seconds
  // instead of a 60-90 second blank wait.
  //
  // SSE event types from server:
  //   "chunk"    → { chunkName, fields }  — partial brief data, merge into state
  //   "complete" → { brief, cached }      — final merge done
  //   "error"    → { chunkName, message } — chunk failed (others continue)
  //   "done"     → {}                     — stream ended
  //
  // Falls back to the regular JSON path on stream failure.
  const callStreamingAPI = async (opts = {}) => {
    const fresh = opts && opts.fresh === true;
    const params = new URLSearchParams();
    params.set("stream", "1");
    if (fresh) params.set("fresh", "1");
    const url = `/api/brief?${params.toString()}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name || "the user",
        watchlist: portfolio,
        holdings: holdings,
        accounts: accountsState,
        holdingsAgeDays: holdingsAgeDays,
        date: today,
      }),
    });
    if (!response.ok || !response.body) {
      let errBody = ""; try { errBody = await response.text(); } catch {}
      throw new Error(`Stream API ${response.status}: ${errBody.slice(0, 200)}`);
    }

    let accumulated = {};
    let finalBrief = null;
    let fatalError = null;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE events are separated by a blank line
      const events = buffer.split(/\n\n/);
      buffer = events.pop() || ""; // last partial chunk stays in buffer

      for (const block of events) {
        if (!block.trim()) continue;
        // Parse "event: <name>\ndata: <json>"
        let eventName = "message";
        let dataStr = "";
        for (const line of block.split(/\n/)) {
          if (line.startsWith("event:")) eventName = line.slice(6).trim();
          else if (line.startsWith("data:")) dataStr += line.slice(5).trim();
        }
        if (!dataStr) continue;
        let payload = null;
        try { payload = JSON.parse(dataStr); } catch { continue; }

        if (eventName === "chunk" && payload && payload.fields && typeof payload.fields === "object") {
          // Merge this chunk's fields into the accumulated brief and push
          // to React state so each section appears as it lands.
          accumulated = { ...accumulated, ...payload.fields };
          setBrief({ ...accumulated });
        } else if (eventName === "complete" && payload && payload.brief) {
          finalBrief = payload.brief;
          setBrief({ ...payload.brief });
        } else if (eventName === "error" && payload) {
          if (payload.fatal) {
            fatalError = payload.message || "Brief generation failed";
          } else {
            // Non-fatal — a single chunk failed, but others may still ship.
            // Just log it; the merged brief will be partial.
            console.warn(`Chunk ${payload.chunkName} failed:`, payload.message);
          }
        }
        // 'done' events are informational; nothing to render
      }
    }

    if (fatalError && !finalBrief && Object.keys(accumulated).length === 0) {
      throw new Error(fatalError);
    }
    return finalBrief || accumulated;
  };

  const extractJSON = (data) => {
    if (!data || !data.brief) throw new Error("No brief in response");
    return data.brief;
  };

  const generateBrief = async (opts = {}) => {
    setError(null);

    // ─── Optimistic load ─────────────────────────────────────────────
    // If we have a previously-saved brief in local history, render it
    // immediately so the user has something to read while the fresh brief
    // is still being generated. The fresh brief will swap in when ready.
    // Even a brief from yesterday is more useful than 30 seconds of a
    // spinning loader — they can start reading their playbook now while
    // today's news refreshes in the background.
    let showedOptimistic = false;
    try {
      const history = (await Store.get("me-briefs")) || {};
      const dateKeys = Object.keys(history).sort();
      // Try today's brief first (in case they reload), then most recent
      const todaySaved = history[todayKey];
      const mostRecent = dateKeys.length ? history[dateKeys[dateKeys.length - 1]] : null;
      const fallbackBrief = todaySaved?.brief || mostRecent?.brief;
      if (fallbackBrief) {
        setBrief(fallbackBrief);
        showedOptimistic = true;
      }
    } catch {}

    // setLoading(true) happens AFTER the optimistic render so the spinner
    // overlay shows in addition to the cached brief, not instead of it.
    setLoading(true);

    try {
      // Try streaming first — sections appear as they generate (10-30s
      // total instead of 60-90s blank wait). Falls back to non-streaming
      // if the streaming call fails (proxy strips SSE, browser issue, etc.)
      let fresh;
      try {
        fresh = await callStreamingAPI(opts);
      } catch (streamErr) {
        console.warn("Streaming failed, falling back to non-streaming:", streamErr);
        const data = await callAPI(opts);
        fresh = extractJSON(data);
      }
      if (!fresh || Object.keys(fresh).length === 0) {
        throw new Error("Empty brief returned");
      }
      setBrief(fresh);
      // Auto-save brief by date for future history feature
      try {
        const history = (await Store.get("me-briefs")) || {};
        history[todayKey] = { brief: fresh, savedAt: Date.now() };
        const keys = Object.keys(history).sort().slice(-30);
        const trimmed = {};
        keys.forEach((k) => { trimmed[k] = history[k]; });
        await Store.set("me-briefs", trimmed);
      } catch {}
    } catch (e) {
      console.warn("Live API failed:", e);
      // Only fall back to demo brief if we didn't already show a cached one.
      // If they have yesterday's brief on screen, leave it there rather than
      // wiping it for the demo.
      if (!showedOptimistic) {
        setBrief(buildDemoBrief(name, portfolio, holdings));
      }
      const dow = new Date().getDay();
      const isWeekend = dow === 0 || dow === 6;
      // Tailor the error message to what the user is actually seeing.
      // If we kept yesterday's brief on screen, say so honestly. If we
      // had to fall back to the demo, say that.
      setError(
        showedOptimistic
          ? (isWeekend
              ? "Markets closed — showing your most recent brief."
              : "Couldn't refresh just now — showing your most recent brief.")
          : (isWeekend
              ? "Markets closed for the weekend — showing a sample brief."
              : "Live data unavailable — showing sample brief.")
      );
    } finally { setLoading(false); }
  };

  // ─── Pull-to-refresh ───────────────────────────────────────────────
  // Touch-driven pull from the top to trigger a fresh brief fetch.
  // Only active when at scrollY=0, brief exists, and not already loading.
  // Threshold: ~80px sustained pull. Visual indicator is the existing
  // RefreshCw spinner, surfaced inline at top while pulling.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (phase !== "app") return;

    let startY = null;
    let pulling = false;

    const onTouchStart = (e) => {
      if (window.scrollY > 0) return;
      if (loading) return;
       // Only enable pull-to-refresh once a brief is present
      startY = e.touches && e.touches[0] ? e.touches[0].clientY : null;
      pulling = false;
    };

    const onTouchMove = (e) => {
      if (startY == null) return;
      const y = e.touches && e.touches[0] ? e.touches[0].clientY : startY;
      const delta = y - startY;
      if (delta <= 0) {
        if (pulling) {
          pulling = false;
          setPullProgress(0);
        }
        return;
      }
      if (window.scrollY > 0) return;
      pulling = true;
      // Soft rubber-band: show progress 0..1 over 100px pull
      const progress = Math.min(1, delta / 100);
      setPullProgress(progress);
    };

    const onTouchEnd = () => {
      const triggered = pulling && pullProgress >= 1;
      pulling = false;
      startY = null;
      setPullProgress(0);
      if (triggered) {
        // Pull-to-refresh: cache-aware. If today's brief is in cache,
        // returns instantly. If holdings changed, fast Layer B regen
        // (~25-30s). Only goes to full regen if no cache exists at all.
        // Force-fresh is reserved for the explicit "regenerate" action.
        generateBrief();
      }
    };

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
    };
    // pullProgress is intentionally read live (not captured) — the closure reads pulling flag instead
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, brief, loading, pullProgress]);

  const showDemo = () => { setError(null); setBrief(buildDemoBrief(name, portfolio, holdings)); };

  const shareBrief = async () => {     if (!brief) {       try {         if (navigator.share) {           await navigator.share({ title: "Morning Edge", text: "Check out Morning Edge — daily market brief, smart money flow, and decision playbook.", url: "https://morning-edge-rho.vercel.app" });         } else if (navigator.clipboard && navigator.clipboard.writeText) {           await navigator.clipboard.writeText("https://morning-edge-rho.vercel.app");           setError("Link copied to clipboard.");           setTimeout(() => setError(null), 2500);         }       } catch (e) {}       return;     }
    
    const lines = [
      `☀️ Morning Edge — ${today}`,
      "",
      brief.affirmation ? `"${brief.affirmation}"` : "",
      "",
      brief.market_pulse && brief.market_pulse.tone ? `📊 ${(brief.market_pulse.tone || "").toUpperCase()}: ${brief.market_pulse.summary || ""}` : "",
      "",
      Array.isArray(brief.decisions) && brief.decisions.length ? "Today's Playbook:" : "",
      ...(Array.isArray(brief.decisions) ? brief.decisions : []).map((d, i) => `${i + 1}. ${d}`),
      "",
      "— Generated by Morning Edge",
    ].filter(Boolean);
    const text = lines.join("\n");
    try {
      if (navigator.share) {
        await navigator.share({ title: "Morning Edge — Today's Brief", text: "Check out my morning brief on Morning Edge:", url: "https://morning-edge-rho.vercel.app" });
      } else if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        setError("Brief copied to clipboard.");
        setTimeout(() => setError(null), 2500);
      }
    } catch (e) {
      // user cancelled share — silent
    }
  };

  // Generate .ics calendar file for a playbook item and trigger download.
  // iOS Safari: prompts to open in Apple Calendar. Android Chrome: opens in default calendar app.
  const addDecisionToCalendar = (decisionText, idx) => {
    try {
      // Format date as YYYYMMDDTHHMMSS for ICS
      const pad = (n) => String(n).padStart(2, "0");
      const start = new Date();
      start.setHours(9, 0, 0, 0); // default to 9am today
      const end = new Date(start.getTime() + 60 * 60 * 1000); // 1 hour
      const fmt = (d) =>
        `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
      const now = new Date();
      const uid = `me-${todayKey}-${idx}-${now.getTime()}@morningedge`;
      // Escape for ICS (commas, semicolons, newlines)
      const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\n/g, "\\n");
      const ics = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Morning Edge//Playbook//EN",
        "CALSCALE:GREGORIAN",
        "BEGIN:VEVENT",
        `UID:${uid}`,
        `DTSTAMP:${fmt(now)}`,
        `DTSTART:${fmt(start)}`,
        `DTEND:${fmt(end)}`,
        `SUMMARY:${esc(decisionText)}`,
        `DESCRIPTION:${esc(`From today's Morning Edge playbook (item ${idx + 1}).`)}`,
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        "DESCRIPTION:Reminder",
        "TRIGGER:-PT15M",
        "END:VALARM",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n");
      const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `morning-edge-${todayKey}-${idx + 1}.ics`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      console.warn("Calendar export failed:", err);
    }
  };

  const completeOnboarding = () => {
    setName(tempName.trim()); setPortfolio(tempPortfolio); setPhase("app");
  };
  const resetAll = async () => {
    await Store.del("me-user");
    await Store.del("me-progress");
    await Store.del("me-holdings");
    await Store.del("me-briefs"); await Store.del("me-accounts");
    setName(""); setPortfolio([]); setHoldings([]); setAccountsState([]); setHoldingsRefreshedAt(null);
    setBrief(null); setCompletedDecisions({}); setRoutineDays({});
    setTempName(""); setTempPortfolio([]);
    setShowSettings(false); setPhase("onboard-1");
  };
  const addTicker = () => {
    const t = tickerInput.trim().toUpperCase();
    if (t && !portfolio.includes(t)) setPortfolio([...portfolio, t]);
    setTickerInput("");
  };
  const removeTicker = (t) => setPortfolio(portfolio.filter((x) => x !== t));

  // CSV import — parses common brokerage exports (Fidelity, Schwab, Robinhood, Webull, E*Trade, Vanguard).
  // Extracts symbol + quantity + cost basis + current value + gain%.
  // All data stays on device — never sent to any server beyond the brief generation request.
  // Multi-account: each upload is staged in pendingCsvUpload, then committed under a user-supplied label.
  const handleCsvUpload = (e) => {console.log("CSV UPLOAD FIRED", e.target.files);
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setCsvImportMessage(null);
    const fileName = file.name || "";
    // Heuristic: guess brokerage from filename for the default label suggestion
    const guess = (() => {
      const lower = fileName.toLowerCase();
      if (lower.includes("portfolio_position") || lower.includes("fidelity")) return "Fidelity";
      if (lower.includes("schwab") || lower.includes("positions")) return "Schwab";
      if (lower.includes("robinhood") || lower.includes("rh_")) return "Robinhood";
      if (lower.includes("vanguard")) return "Vanguard";
      if (lower.includes("webull")) return "Webull";
      if (lower.includes("etrade") || lower.includes("e_trade")) return "E*TRADE";
      return "";
    })();
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const text = String(ev.target.result || "");
        const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
        if (lines.length < 2) {
          setCsvImportMessage({ type: "error", text: "CSV looks empty." });
          return;
        }
        // Find header row (some brokerages put metadata above)
        let headerIdx = 0;
        for (let i = 0; i < Math.min(10, lines.length); i++) {
          const lower = lines[i].toLowerCase();
          if (/symbol|ticker|stock|security/.test(lower)) { headerIdx = i; break; }
        }
        const splitRow = (s) => { const out = []; let cur = "", inQ = false; for (let i = 0; i < s.length; i++) { const c = s[i]; if (c === '"') { inQ = !inQ; continue; } if (c === "," && !inQ) { out.push(cur.trim()); cur = ""; continue; } cur += c; } out.push(cur.trim()); return out; };
        const header = splitRow(lines[headerIdx]).map((h) => h.toLowerCase());

        // Find each column by fuzzy matching common header names across brokerages
        const findCol = (...patterns) => {
          for (const pat of patterns) {
            const idx = header.findIndex((h) => pat.test(h));
            if (idx !== -1) return idx;
          }
          return -1;
        };
        const symCol = findCol(/^symbol$/, /^ticker$/, /symbol|ticker/, /^stock$|security/);
        const qtyCol = findCol(/^quantity$/, /^shares$/, /^qty$/, /quantity|shares|qty/);
        const costCol = findCol(/avg.*cost|average.*cost|cost.*basis|cost.*per.*share/, /^cost$/);
        const valCol = findCol(/current.*value|market.*value|^value$|^total.*value/);
const gainCol = findCol(/total.*gain.*(%|percent|pct)|gain.*loss.*(%|percent|pct)|gain.*(%|percent|pct)|return.*(%|percent|pct)/);
        if (symCol === -1) {
          setCsvImportMessage({ type: "error", text: "Couldn't find a Symbol or Ticker column." });
          return;
        }

        // Parse a numeric cell, handling $ , % () for negatives
        const parseNum = (s) => {
          if (!s) return null;
          const cleaned = String(s).replace(/[\$,%\s]/g, "").replace(/^\((.+)\)$/, "-$1");
          const n = parseFloat(cleaned);
          return isNaN(n) ? null : n;
        };

        const newHoldings = [];
        const tickers = new Set();
        for (let i = headerIdx + 1; i < lines.length; i++) {
          const cells = splitRow(lines[i]);
          const raw = (cells[symCol] || "").toUpperCase();
          // Filter: 1-5 letters, no digits/special chars (avoids "Cash", "Total", option contracts)
          if (!/^[A-Z]{1,5}$/.test(raw)) continue;
          tickers.add(raw);
          newHoldings.push({
            symbol: raw,
            qty: qtyCol !== -1 ? parseNum(cells[qtyCol]) : null,
            cost: costCol !== -1 ? parseNum(cells[costCol]) : null,
            value: valCol !== -1 ? parseNum(cells[valCol]) : null,
            gainPct: gainCol !== -1 ? parseNum(cells[gainCol]) : null,
          });
        }

        if (newHoldings.length === 0) {
          setCsvImportMessage({ type: "error", text: "No valid tickers detected." });
          return;
        }

        // Stage the upload — user must label the account before commit
       const _label = guess || "Account";
            const _newAccountId = `acct_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
            const _newAccount = { id: _newAccountId, name: _label, brokerage: guess || "", uploadedAt: Date.now(), holdingCount: newHoldings.length };
            const _tagged = newHoldings.map((h) => ({ ...h, accountId: _newAccountId }));
            setAccountsState((prev) => [...prev, _newAccount]);
            setHoldings((prev) => [...prev, ..._tagged]);
            setHoldingsRefreshedAt(Date.now());
            setPortfolio((prev) => Array.from(new Set([...prev, ...Array.from(tickers)])));
            setCsvImportMessage({ type: "ok", text: `Added ${newHoldings.length} positions.` }); 
      } catch (err) {
        setCsvImportMessage({ type: "error", text: "Couldn't parse that file. Make sure it's a CSV." });
      }
    };
    reader.onerror = () => setCsvImportMessage({ type: "error", text: "File read failed." });
    reader.readAsText(file);
    // Allow same file to be selected again
    if (e.target) e.target.value = "";
  };

  // Commit a staged CSV upload under the user-supplied account label.
  const commitPendingCsvUpload = () => {
    if (!pendingCsvUpload) return;
    const label = (accountLabelDraft || "").trim() || pendingCsvUpload.brokerageGuess || "Account";
    const newAccountId = `acct_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const newAccount = {
      id: newAccountId,
      name: label,
      brokerage: pendingCsvUpload.brokerageGuess || "",
      uploadedAt: Date.now(),
      holdingCount: pendingCsvUpload.newHoldings.length,
    };
    const tagged = pendingCsvUpload.newHoldings.map((h) => ({ ...h, accountId: newAccountId }));

    setAccountsState((prev) => [...prev, newAccount]);
    setHoldings((prev) => [...prev, ...tagged]);
    setHoldingsRefreshedAt(Date.now());
    setPortfolio((prev) => Array.from(new Set([...prev, ...pendingCsvUpload.tickers])));

    const withQty = pendingCsvUpload.newHoldings.filter((h) => h.qty != null).length;
    setCsvImportMessage({
      type: "ok",
      text: `Added ${pendingCsvUpload.newHoldings.length} position${pendingCsvUpload.newHoldings.length === 1 ? "" : "s"} under "${label}"${withQty ? `. ${withQty} with shares.` : "."}`,
    });
    setPendingCsvUpload(null);
    setAccountLabelDraft("");

    // CSV-first UX: if no brief exists yet, auto-generate one with the
    // freshly uploaded holdings. Saves the user from sitting through one
    // generation without holdings, then a second after upload. Wrapped in
    // a tiny delay so React flushes the holdings state first.
    if (!brief && !loading) {
      setTimeout(() => generateBrief(), 100);
    }
  };

  const cancelPendingCsvUpload = () => {
    setPendingCsvUpload(null);
    setAccountLabelDraft("");
    setCsvImportMessage(null);
  };

  // Holdings freshness: how stale is the data?
  const holdingsAgeDays = useMemo(() => {
    if (!holdingsRefreshedAt) return null;
    return Math.floor((Date.now() - holdingsRefreshedAt) / (1000 * 60 * 60 * 24));
  }, [holdingsRefreshedAt]);

  // What sections show for each filter
  const visible = {
    affirmation: filter === "all" || filter === "clarity",
    market_pulse: filter === "all" || filter === "wealth",
    smart_money: filter === "all" || filter === "wealth",
    radar: filter === "all" || filter === "wealth",
    conviction: filter === "all" || filter === "wealth",
    mindset: filter === "all" || filter === "health",
    clarity_card: filter === "all" || filter === "clarity",
    decisions: filter === "all" || filter === "wealth",
  };

  const signalIcon = (s) =>
    s === "add" ? <ArrowUpRight className="w-4 h-4" />
    : s === "trim" ? <ArrowDownRight className="w-4 h-4" />
    : <Pause className="w-3.5 h-3.5" />;
  const signalStyle = (s) =>
    s === "add" ? "bg-emerald-50 text-emerald-700 border-emerald-200"
    : s === "trim" ? "bg-rose-50 text-rose-700 border-rose-200"
    : "bg-slate-100 text-slate-700 border-slate-200";
  const toneColor = (t) =>
    t === "bullish" ? "text-emerald-600"
    : t === "bearish" ? "text-rose-600" : "text-amber-600";

  // Refined professional palette (mountain/ocean)
  const themes = {
    pulse:      { gradient: "from-sky-500 to-blue-600",      tint: "from-sky-50 to-blue-50",      bar: "from-sky-500 to-blue-600" },
    money:      { gradient: "from-amber-500 to-orange-500",  tint: "from-amber-50 to-orange-50",  bar: "from-amber-500 to-orange-500" },
    radar:      { gradient: "from-cyan-500 to-teal-600",     tint: "from-cyan-50 to-teal-50",     bar: "from-cyan-500 to-teal-600" },
    conviction: { gradient: "from-emerald-500 to-teal-600",  tint: "from-emerald-50 to-teal-50",  bar: "from-emerald-500 to-teal-600" },
    mindset:    { gradient: "from-rose-400 to-pink-500",     tint: "from-rose-50 to-pink-50",     bar: "from-rose-400 to-pink-500" },
    clarity:    { gradient: "from-violet-500 to-purple-600", tint: "from-violet-50 to-purple-50", bar: "from-violet-500 to-purple-600" },
    play:       { gradient: "from-indigo-500 to-violet-600", tint: "from-indigo-50 to-violet-50", bar: "from-indigo-500 to-violet-600" },
  };

  // ─── Loading splash ──────────────────────────────────────────────
  if (phase === "loading") {
    return (
      <div className="min-h-screen relative" style={{
        fontFamily: SANS,
        background: "linear-gradient(180deg, #FFFBEB 0%, #FEF3C7 14%, #DDD6FE 30%, #C7D2FE 45%, #A5B4FC 60%, #818CF8 75%, #4338CA 100%)",
      }}>
        <div className="relative z-10 px-6 pt-16 pb-12 flex flex-col items-center max-w-md mx-auto">
          {/* Branded mark */}
          <div className="w-20 h-20 rounded-2xl flex items-center justify-center shadow-2xl mb-5 animate-pulse"
            style={{ background: "linear-gradient(135deg, #0F172A 0%, #0F172A 50%, #0F172A 100%)" }}>
            <span className="text-white text-3xl font-bold tracking-tight" style={{ fontFamily: SERIF, fontStyle: "italic", color: "#FFD580" }}>ME</span>
          </div>
          <p className="text-[14px] uppercase tracking-[0.3em] text-white/95 font-bold mb-2 drop-shadow-md">Morning Edge</p>
          
          {/* Loading status — explicit, never blank */}
          <div className="flex items-center gap-2 text-white/90 text-[14px]">
            <RefreshCw className="w-4 h-4 animate-spin" strokeWidth={2.5} />
            <span>Loading your edge…</span>
          </div>
        </div>
      </div>
    );
  }

  // ─── Onboarding ──────────────────────────────────────────────────
  if (phase === "onboard-1" || phase === "onboard-2") {
    return (
      <div className="min-h-screen relative overflow-hidden" style={{
        fontFamily: SANS,
        background: "linear-gradient(180deg, #FFFBEB 0%, #FEF3C7 14%, #DDD6FE 30%, #C7D2FE 45%, #A5B4FC 60%, #818CF8 75%, #4338CA 100%)",
      }}>
        <MountainScene />
        <div className="relative z-10 px-6 pt-16 pb-12 flex flex-col items-center max-w-md mx-auto">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center shadow-xl mb-5"
            style={{ background: "linear-gradient(135deg, #0F172A 0%, #0F172A 50%, #0F172A 100%)" }}>
            <span className="text-white text-2xl font-bold tracking-tight" style={{ fontFamily: SERIF, fontStyle: "italic", color: "#F5D08C" }}>ME</span>
          </div>
          <p className="text-base font-bold text-slate-900 tracking-wide mb-1" style={{ fontFamily: SERIF }}>Morning Edge</p>
          <div className="flex gap-2 mb-8">
            <div className={`h-1.5 rounded-full transition-all ${phase === "onboard-1" ? "w-8 bg-slate-900" : "w-2 bg-slate-400"}`} />
            <div className={`h-1.5 rounded-full transition-all ${phase === "onboard-2" ? "w-8 bg-slate-900" : "w-2 bg-slate-400"}`} />
          </div>

          {phase === "onboard-1" && (
            <div className="w-full bg-white rounded-3xl p-6 shadow-xl border border-slate-100">
              <h1 className="text-3xl text-slate-900 mb-2 leading-tight" style={{ fontFamily: SERIF, fontWeight: 500 }}>
                Welcome <span className="italic text-slate-700">aboard.</span>
              </h1>
              <p className="text-[16px] text-slate-700 mb-5 leading-relaxed">
                30-second setup. Your data stays on your device.
              </p>
              <label className="text-[13px] uppercase tracking-widest text-slate-700 font-semibold mb-2 block">What should we call you?</label>
              <input
                value={tempName}
                onChange={(e) => setTempName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && tempName.trim() && setPhase("onboard-2")}
                placeholder="First name"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-base focus:outline-none focus:border-slate-900 focus:bg-white mb-5"
                autoFocus
              />
              <button
                onClick={() => tempName.trim() && setPhase("onboard-2")}
                disabled={!tempName.trim()}
                className={`w-full py-3.5 rounded-xl font-semibold flex items-center justify-center gap-2 transition ${
                  tempName.trim() ? "bg-slate-900 text-white hover:bg-slate-800" : "bg-slate-200 text-slate-500"
                }`}
              >
                Continue <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {phase === "onboard-2" && (
            <div className="w-full bg-white rounded-3xl p-6 shadow-xl border border-slate-100">
              <h1 className="text-3xl text-slate-900 mb-2 leading-tight" style={{ fontFamily: SERIF, fontWeight: 500 }}>
                Build your <span className="italic text-slate-700">watchlist.</span>
              </h1>
              <p className="text-[16px] text-slate-700 mb-5">Add tickers you track. Edit anytime.</p>
              <div className="flex gap-2 mb-3">
                <input
                  value={tickerInput}
                  onChange={(e) => setTickerInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const t = tickerInput.trim().toUpperCase();
                      if (t && !tempPortfolio.includes(t)) setTempPortfolio([...tempPortfolio, t]);
                      setTickerInput("");
                    }
                  }}
                  placeholder="Ticker (e.g. NVDA)"
                  className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-[16px] focus:outline-none focus:border-slate-900 focus:bg-white"
                />
                <button
                  onClick={() => {
                    const t = tickerInput.trim().toUpperCase();
                    if (t && !tempPortfolio.includes(t)) setTempPortfolio([...tempPortfolio, t]);
                    setTickerInput("");
                  }}
                  className="px-4 py-2.5 bg-slate-900 text-white rounded-xl font-semibold text-[16px]">Add</button>
              </div>
              <p className="text-[12px] uppercase tracking-widest text-slate-700 font-semibold mb-2">Suggestions</p>
              <div className="flex flex-wrap gap-1.5 mb-4">
                {SUGGESTED.filter((s) => !tempPortfolio.includes(s)).map((s) => (
                  <button key={s} onClick={() => setTempPortfolio([...tempPortfolio, s])}
                    className="px-2.5 py-1 rounded-lg text-[13px] font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200">
                    + {s}
                  </button>
                ))}
              </div>
              {tempPortfolio.length > 0 && (
                <>
                  <p className="text-[12px] uppercase tracking-widest text-slate-700 font-semibold mb-2">Your picks ({tempPortfolio.length})</p>
                  <div className="flex flex-wrap gap-1.5 mb-5">
                    {tempPortfolio.map((t) => (
                      <span key={t} className="inline-flex items-center gap-1 bg-slate-100 border border-slate-200 px-2 py-1 rounded-lg text-[13px] text-slate-800 font-medium">
                        {t}
                        <button onClick={() => setTempPortfolio(tempPortfolio.filter((x) => x !== t))} className="hover:text-rose-600">
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                </>
              )}
              <button onClick={completeOnboarding}
                className="w-full py-3.5 rounded-xl font-semibold text-white bg-slate-900 hover:bg-slate-800 flex items-center justify-center gap-2">
                <Sparkles className="w-4 h-4" /> Begin
              </button>
              <button onClick={() => setPhase("onboard-1")}
                className="w-full py-2 mt-2 text-[16px] text-slate-700 hover:text-slate-900">← Back</button>
            </div>
          )}

          <p className="text-[12px] text-slate-700 mt-6 text-center max-w-xs leading-relaxed">
            Informational only — not investment, medical, or financial advice.
          </p>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════
  //                            MAIN APP
  // ════════════════════════════════════════════════════════════════════

  // Shared Sync Portfolio block — same UI rendered in both empty state and
  // brief-state main panel. Defining it here as a JSX variable keeps both
  // states 1:1 in sync (account list, brokerage links, security copy, etc.)
  // without copy-paste drift.
  const syncPortfolioBlock = (
    <div className="relative rounded-2xl shadow-lg overflow-hidden" data-csv-import-anchor
      style={{
        background: "linear-gradient(160deg, #1E293B 0%, #0F172A 60%, #020617 100%)",
      }}>
      {/* Top gold accent line */}
      <div className="absolute top-0 left-0 right-0 h-[2px] z-10"
        style={{ background: "linear-gradient(90deg, transparent 0%, #D4A574 30%, #F5D08C 50%, #D4A574 70%, transparent 100%)" }} />
      {/* Subtle radial glow */}
      <div className="absolute -top-12 left-1/2 -translate-x-1/2 w-44 h-44 rounded-full opacity-20"
        style={{ background: "radial-gradient(circle, #D4A574 0%, transparent 60%)" }} />

      <button
        onClick={() => setShowCsvImport(!showCsvImport)}
        className="relative z-10 w-full text-left px-4 py-3 transition hover:bg-white/[0.03] active:bg-white/[0.06]"
      >
        <div className="flex items-center gap-3">
          <div className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center"
            style={{ background: "linear-gradient(135deg, #D4A574 0%, #F5D08C 100%)" }}>
            <Briefcase className="w-4 h-4" style={{ color: "#1E293B" }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[9px] tracking-[0.25em] uppercase font-semibold leading-none mb-1"
              style={{ color: "#D4A574" }}>
              Sync Portfolio
            </p>
            <p className="text-[16px] leading-tight truncate"
              style={{ fontFamily: SERIF, fontWeight: 400, color: "#F8FAFC" }}>
              {showCsvImport
                ? "Tap to close"
                : holdings.length > 0
                ? `${holdings.length} position${holdings.length === 1 ? "" : "s"} · ${accountsState.length || 1} account${(accountsState.length || 1) === 1 ? "" : "s"}`
                : "Connect your holdings from any brokerage"}
            </p>
          </div>
          {!showCsvImport && (
            <span className="flex-shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] uppercase tracking-wider font-bold"
              style={{
                background: "rgba(212, 165, 116, 0.15)",
                border: "1px solid rgba(212, 165, 116, 0.4)",
                color: "#D4A574",
              }}>
              {holdings.length > 0 ? "✓ Synced" : "Tap to begin"}
            </span>
          )}
        </div>
      </button>

      {showCsvImport && (
        <div className="relative z-10 px-4 pb-5 pt-1">
          <div className="px-3 py-3 rounded-lg bg-white text-[13px] text-slate-700 space-y-3 shadow-inner">
            <div>
              <p className="font-semibold text-slate-900 mb-2">Get your CSV from your brokerage</p>
              <p className="text-[13px] text-slate-700 leading-snug mb-2.5">
                Tap to open the broker in a new tab. Log in, find your positions, save the CSV, then come back and upload it.
                {isMobile && (
                  <span className="block mt-1 text-[12px] text-amber-700">
                    Heads up: brokerage CSV downloads usually work better on a computer.
                  </span>
                )}
              </p>
              <div className="space-y-1.5">
                {BROKERAGES.slice(0, 6).map((b) => (
                  <button
                    key={b.name}
                    onClick={() => {
                      if (typeof window !== "undefined") {
                        window.open(b.url, "_blank", "noopener,noreferrer");
                      }
                    }}
                    className="w-full flex items-center gap-2 bg-white border border-amber-200 rounded-lg px-2.5 py-2 hover:border-amber-300 hover:bg-amber-50/60 active:bg-amber-100 transition text-left"
                  >
                    <span className="text-[15px] font-bold text-slate-900 flex-shrink-0 w-[88px] truncate" style={{ fontFamily: SERIF }}>
                      {b.name}
                    </span>
                    <span className="text-[12px] text-slate-700 flex-1 truncate">
                      {b.path}
                    </span>
                    <ExternalLink className="w-3 h-3 text-amber-600 flex-shrink-0" />
                  </button>
                ))}
              </div>
              <button
                onClick={() => setShowBrokerageGuide(true)}
                className="w-full mt-2 px-2.5 py-2 rounded-lg border border-amber-300 bg-white text-[13px] font-semibold text-amber-800 hover:bg-amber-50 active:bg-amber-100 transition flex items-center justify-center gap-1.5"
              >
                See all {BROKERAGES.length} brokerages
                <ChevronRight className="w-3 h-3" />
              </button>
              <p className="text-[12px] text-slate-700 italic mt-2 leading-snug">
                We never see your password. We only read the CSV you upload. Holdings stay on this device until a brief is generated, and are never stored on our servers.
              </p>
            </div>

            <div>
              <p className="block font-semibold text-slate-900 mb-1.5">Upload your CSV</p>
              <input
                ref={csvFileInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={handleCsvUpload}
                style={{
                  position: "absolute",
                  width: 1,
                  height: 1,
                  padding: 0,
                  margin: -1,
                  overflow: "hidden",
                  clip: "rect(0,0,0,0)",
                  whiteSpace: "nowrap",
                  border: 0,
                  opacity: 0,
                }}
              />
              <button
                type="button"
                onClick={() => {
                  if (csvFileInputRef.current) {
                    csvFileInputRef.current.value = ""; // reset so same file can be re-selected
                    csvFileInputRef.current.click();
                  }
                }}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-slate-900 text-white text-[15px] font-semibold hover:bg-slate-800 active:bg-slate-700 transition cursor-pointer select-none"
              >
                <Plus className="w-3.5 h-3.5" />
                Choose CSV file
              </button>
              {csvImportMessage && (
                <div className={`mt-2 px-3 py-2 rounded-md text-[13px] ${
                  csvImportMessage.type === "ok"
                    ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
                    : "bg-rose-100 text-rose-800 border border-rose-200"
                }`}>
                  {csvImportMessage.text}
                </div>
              )}
              {accountsState.length > 0 && (
                <div className="mt-3 space-y-2">
                  <p className="font-semibold text-slate-900 text-[13px]">Connected accounts</p>
                  {accountsState.map((a) => (
                    <div key={a.id} className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-white border border-slate-200">
                      <div className="min-w-0 flex-1 mr-2">
                        <div className="font-semibold text-slate-900 text-[14px] truncate">{a.name}</div>
                        <div className="text-[12px] text-slate-500">{a.holdingCount} positions{a.brokerage ? ` · ${a.brokerage}` : ""}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm(`Remove ${a.name}?`)) {
                            setAccountsState((prev) => prev.filter((x) => x.id !== a.id));
                            setHoldings((prev) => prev.filter((h) => h.accountId !== a.id));
                          }
                        }}
                        className="px-3 py-1.5 rounded-md text-rose-600 hover:bg-rose-50 text-[12px] font-semibold flex-shrink-0"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {holdings.length > 0 && (
                <div className={`mt-2 px-3 py-2 rounded-md text-[13px] ${
                  holdingsAgeDays != null && holdingsAgeDays > 7
                    ? "bg-amber-50 border border-amber-200 text-amber-900"
                    : "bg-slate-100 border border-slate-200 text-slate-700"
                }`}>
                  <p className="font-semibold mb-0.5">
                    {holdings.length} position{holdings.length === 1 ? "" : "s"} loaded
                    {holdingsAgeDays != null && (
                      <span className="font-normal">
                        {" · "}
                        {holdingsAgeDays === 0 ? "today" : holdingsAgeDays === 1 ? "1 day ago" : `${holdingsAgeDays} days ago`}
                      </span>
                    )}
                  </p>
                  {holdingsAgeDays != null && holdingsAgeDays > 7 && (
                    <p className="text-[12px] mt-1">
                      ⚠ Data is stale — gain percentages may be off. Re-upload for accurate playbook recommendations.
                    </p>
                  )}
                  {holdingsAgeDays != null && holdingsAgeDays <= 7 && (
                    <p className="text-[12px] mt-1 text-slate-700">
                      Holdings power your personalized playbook. Re-upload weekly for best accuracy.
                    </p>
                  )}
                </div>
              )}
              <p className="text-[12px] text-slate-700 leading-relaxed mt-2">
                Holdings stay on your device. We only send them to generate today's brief — never stored on any server.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="min-h-screen relative overflow-hidden" style={{
      fontFamily: SANS,
      background: "linear-gradient(180deg, #FFFBEB 0%, #FEF3C7 14%, #DDD6FE 30%, #C7D2FE 45%, #A5B4FC 60%, #818CF8 75%, #4338CA 100%)",
    }}>
      <MountainScene />

      {/* Header */}
      <header className="relative px-6 pt-10 pb-6">
        <div className="flex items-start justify-between mb-7">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl flex items-center justify-center shadow-lg"
              style={{ background: "linear-gradient(135deg, #0F172A 0%, #0F172A 60%, #0F172A 100%)" }}>
              <span className="text-white text-base font-bold tracking-tight" style={{ fontFamily: SERIF, fontStyle: "italic", color: "#F5D08C" }}>ME</span>
            </div>
            <div>
              <p className="text-base font-bold text-slate-900 tracking-wide leading-tight" style={{ fontFamily: SERIF }}>Morning Edge</p>             </div>           </div>
          <div className="flex gap-2">
            {true && (
              <button onClick={shareBrief}
                className="p-2.5 rounded-full bg-white border border-slate-200 shadow-md transition active:scale-90 active:bg-slate-100 hover:bg-slate-50"
                aria-label="Share">
                <Share2 className="w-4 h-4 text-slate-700" />
              </button>
            )}
            <button onClick={() => setShowPremium(true)}
              className="p-2.5 rounded-full text-white shadow-md bg-gradient-to-br from-amber-500 to-orange-500 transition active:scale-90 hover:from-amber-600 hover:to-orange-600"
              aria-label="Premium">
              <Crown className="w-4 h-4" />
            </button>
            <button onClick={() => setShowSettings(!showSettings)}
              className={`p-2.5 rounded-full border shadow-md transition active:scale-90 ${
                showSettings
                  ? "bg-slate-900 border-slate-900"
                  : "bg-white border-slate-200 hover:bg-slate-50 active:bg-slate-100"
              }`}
              aria-label="Settings"
              aria-pressed={showSettings}>
              <Settings className={`w-4 h-4 ${showSettings ? "text-white" : "text-slate-700"}`} />
            </button>
          </div>
        </div>

        <h1 className="text-4xl leading-tight text-slate-900" style={{ fontFamily: SERIF, fontWeight: 500 }}>
          {greeting}{name ? `, ${name}` : ""},<br />
          <span className="italic text-slate-700">your morning edge.</span>
        </h1>
        <p className="text-[13px] text-slate-700 mt-3 tracking-[0.2em] uppercase font-medium">{today}</p>
      </header>

      {/* Pull-to-refresh + background-refresh indicator. When a brief is
          being generated while a cached one is on screen, show a rotating
          set of personalized status messages so the user sees the app is
          actively working for them rather than just spinning. */}
      {(pullProgress > 0 || (loading && brief)) && (
        <div className="relative flex items-center justify-center -mt-1 pb-1.5">
          {loading ? (
            (() => {
              const statusMessages = [
                holdings && holdings.length > 0 ? "Reading the tape for your holdings…" : "Reading the tape…",
                "Scanning smart money flow…",
                "Checking earnings & catalysts…",
                "Tuning your edge…",
                "Pulling congressional disclosures…",
                "Almost there…",
              ];
              const msg = statusMessages[loadingStatusIdx % statusMessages.length];
              return (
                <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-amber-50 border border-amber-300 shadow-sm">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-700" />
                  <span
                    key={msg}
                    className="text-[13px] font-semibold uppercase tracking-wider text-amber-800"
                    style={{ animation: "me-status-fade 0.5s ease-out" }}
                  >
                    {msg}
                  </span>
                  <style>{`
                    @keyframes me-status-fade {
                      0%   { opacity: 0; transform: translateY(2px); }
                      100% { opacity: 1; transform: translateY(0); }
                    }
                  `}</style>
                </div>
              );
            })()
          ) : (
            <div className="flex items-center gap-2 text-slate-700 text-[13px] font-semibold uppercase tracking-wider">
              <RefreshCw
                className="w-4 h-4"
                style={{ transform: `rotate(${pullProgress * 360}deg)`, opacity: 0.4 + pullProgress * 0.6 }}
              />
              <span style={{ opacity: 0.4 + pullProgress * 0.6 }}>
                {pullProgress >= 1 ? "Release to refresh" : "Pull to refresh"}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Movers ticker tape — streams biggest gainers/losers + unusual flow,
          enriched with the user's holdings and conviction signals from today's brief. */}
      <TickerTape userHoldings={holdings} brief={brief} accounts={accountsState} />

      {/* Filter pillars — always visible. Step 1 of the flow:
          user picks their pillar focus before generating the brief.
          The selection persists once the brief loads. */}
      <div className="relative px-4 pb-4">
        <div className="text-center mb-3">
          <span className="inline-block px-3 py-1 text-[10px] tracking-[0.3em] uppercase font-bold"
            style={{ color: "#92400e", borderTop: "1px solid rgba(212,165,116,0.4)", borderBottom: "1px solid rgba(212,165,116,0.4)" }}>
            ✦ Choose Your Pillar ✦
          </span>
        </div>
        <div className="grid grid-cols-4 gap-2">
          <FilterPill
            active={filter === "all"}
            onClick={() => setFilter("all")}
            icon={<LayoutGrid className="w-4 h-4" />}
            label="All Pillars"
            accent={{ bg: "bg-slate-900", text: "text-white", ring: "ring-slate-300", dot: "bg-slate-400" }}
          />
          <FilterPill
            active={filter === "wealth"}
            onClick={() => setFilter("wealth")}
            icon={<TrendingUp className="w-4 h-4" />}
            label="Wealth Pillar"
            accent={{ bg: "bg-amber-600", text: "text-white", ring: "ring-amber-200", dot: "bg-amber-500" }}
          />
          <FilterPill
            active={filter === "health"}
            onClick={() => setFilter("health")}
            icon={<Heart className="w-4 h-4" />}
            label="Health Pillar"
            accent={{ bg: "bg-emerald-600", text: "text-white", ring: "ring-emerald-200", dot: "bg-emerald-500" }}
          />
          <FilterPill
            active={filter === "clarity"}
            onClick={() => setFilter("clarity")}
            icon={<Sparkles className="w-4 h-4" />}
            label="Clarity Pillar"
            accent={{ bg: "bg-indigo-600", text: "text-white", ring: "ring-indigo-200", dot: "bg-indigo-500" }}
          />
        </div>
      </div>

      {/* Two royal twin buttons — Generate Brief + Sync Portfolio.
          Always visible so users can re-generate or re-sync at any time
          without going back. Step 2 of the flow after picking a pillar. */}
      <div className="relative px-4 pb-4">
        <div className="grid grid-cols-2 gap-3">
          {/* GENERATE BRIEF — deep navy → indigo gradient */}
          <button
            onClick={generateBrief}
            disabled={loading}
            className="relative rounded-2xl shadow-lg overflow-hidden text-left active:scale-[0.99] transition disabled:opacity-60"
            style={{
              background: "linear-gradient(160deg, #1E293B 0%, #312E81 60%, #1E1B4B 100%)",
            }}
          >
            <div className="absolute top-0 left-0 right-0 h-[2px] z-10"
              style={{ background: "linear-gradient(90deg, transparent 0%, #D4A574 30%, #F5D08C 50%, #D4A574 70%, transparent 100%)" }} />
            <div className="absolute -top-12 left-1/2 -translate-x-1/2 w-44 h-44 rounded-full opacity-25"
              style={{ background: "radial-gradient(circle, #818CF8 0%, transparent 60%)" }} />
            <div className="relative z-10 px-3 py-4 flex flex-col items-start gap-2 min-h-[110px]">
              <div className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center shadow"
                style={{ background: "linear-gradient(135deg, #D4A574 0%, #F5D08C 100%)" }}>
                <Sparkles className="w-4 h-4" style={{ color: "#1E293B" }} />
              </div>
              <div className="flex-1">
                <p className="text-[9px] tracking-[0.25em] uppercase font-bold leading-none mb-1"
                  style={{ color: "#D4A574" }}>
                  ✦ {brief ? "Refresh" : "Begin"}
                </p>
                <p className="text-[16px] leading-tight"
                  style={{ fontFamily: SERIF, fontWeight: 500, color: "#F8FAFC" }}>
                  {brief ? "Regenerate" : "Generate Brief"}
                </p>
                <p className="text-[11px] leading-snug mt-1" style={{ color: "rgba(248,250,252,0.65)" }}>
                  {loading ? "Reading the tape…" : brief ? "Pull fresh data" : "See today's tape"}
                </p>
              </div>
            </div>
          </button>

          {/* SYNC PORTFOLIO — black & gold */}
          <button
            onClick={() => {
              setShowCsvImport(true);
              setTimeout(() => {
                const el = document.querySelector("[data-csv-import-anchor]");
                if (el && el.scrollIntoView) {
                  el.scrollIntoView({ behavior: "smooth", block: "center" });
                }
              }, 50);
            }}
            className="relative rounded-2xl shadow-lg overflow-hidden text-left active:scale-[0.99] transition"
            style={{
              background: "linear-gradient(160deg, #1E293B 0%, #0F172A 60%, #020617 100%)",
            }}
          >
            <div className="absolute top-0 left-0 right-0 h-[2px] z-10"
              style={{ background: "linear-gradient(90deg, transparent 0%, #D4A574 30%, #F5D08C 50%, #D4A574 70%, transparent 100%)" }} />
            <div className="absolute -top-12 left-1/2 -translate-x-1/2 w-44 h-44 rounded-full opacity-25"
              style={{ background: "radial-gradient(circle, #D4A574 0%, transparent 60%)" }} />
            <div className="relative z-10 px-3 py-4 flex flex-col items-start gap-2 min-h-[110px]">
              <div className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center shadow"
                style={{ background: "linear-gradient(135deg, #D4A574 0%, #F5D08C 100%)" }}>
                <Briefcase className="w-4 h-4" style={{ color: "#1E293B" }} />
              </div>
              <div className="flex-1">
                <p className="text-[9px] tracking-[0.25em] uppercase font-bold leading-none mb-1"
                  style={{ color: "#D4A574" }}>
                  ✦ {holdings.length > 0 ? "Manage" : "Personalize"}
                </p>
                <p className="text-[16px] leading-tight"
                  style={{ fontFamily: SERIF, fontWeight: 500, color: "#F8FAFC" }}>
                  Sync Portfolio
                </p>
                <p className="text-[11px] leading-snug mt-1" style={{ color: "rgba(248,250,252,0.65)" }}>
                  {holdings.length > 0 ? `${holdings.length} positions` : "Connect holdings"}
                </p>
              </div>
            </div>
          </button>
        </div>

        {/* Sync Portfolio expanded panel — visible when sync button tapped.
            Full brokerage list and CSV upload. */}
        {showCsvImport && <div className="mt-3">{syncPortfolioBlock}</div>}
      </div>

      {/* Premium modal */}
      {showPremium && <PremiumModal onClose={() => setShowPremium(false)} />}
      {routineFlowOpen && (
        <RoutineFlow
          routine={todayRoutine()}
          onClose={() => setRoutineFlowOpen(false)}
          onComplete={() => {
            // Mark the routine done for today
            setRoutineDays((prev) => ({ ...prev, [todayKey]: true }));
            setRoutineFlowOpen(false);
          }}
        />
      )}

      {/* In-app browser sheet for source links */}
      {inAppBrowserUrl && (
        <InAppBrowser url={inAppBrowserUrl} onClose={() => setInAppBrowserUrl(null)} />
      )}

      {/* Card reading page — full reading view that opens when user taps
          "Read why · Ask about this" on Conviction or Radar cards.
          Shows the deep_reasoning paragraph, then has an Ask button at
          the bottom that opens the chat sheet for personalized follow-up. */}
      {readingPage && (
        <CardReadingPage
          data={readingPage}
          onClose={() => setReadingPage(null)}
          onAskAboutThis={(data) => {
            // Open chat with the reading page's context, then close the
            // reading page so chat is the focus.
            openChat({
              id: data.id,
              type: data.type,
              ticker: data.ticker,
              description: data.chatDescription || data.headline || data.ticker,
            });
            setReadingPage(null);
          }}
        />
      )}

      {/* Source Detail Sheet — opens when user taps any Insider Flow row.
          Shows the trade, why it matters, and a list of source buttons
          each labeled with what the user will find there. */}
      {sourceDetail && (
        <SourceDetailSheet
          data={sourceDetail}
          onClose={() => setSourceDetail(null)}
          onOpenLink={(url) => {
            openLinkInBrowser(url);
            setSourceDetail(null);
          }}
        />
      )}

      {/* Conversational chat sheet — opens when user taps "Ask about this"
          on any card. Provides live AI chat with full context. */}
      {chatContext && (
        <ChatSheet
          context={chatContext}
          messages={chatMessages}
          input={chatInput}
          setInput={setChatInput}
          loading={chatLoading}
          error={chatError}
          cashBalance={cashBalance}
          onSetCash={(n) => {
            setCashBalance(n);
            try { localStorage.setItem("me-cash", String(n)); } catch (_e) {}
          }}
          onSend={sendChatMessage}
          onClose={closeChat}
        />
      )}

      {/* Playbook decision detail modal — opens when user taps an action card */}
      {openDecisionIdx !== null && brief && brief.decisions && brief.decisions[openDecisionIdx] && (
        <PlaybookDetailModal
          decision={brief.decisions[openDecisionIdx]}
          idx={openDecisionIdx}
          done={(completedDecisions[todayKey] || []).includes(openDecisionIdx)}
          dismissed={(dismissedDecisions[todayKey] || []).includes(openDecisionIdx)}
          deepReasoning={Array.isArray(brief.decisions_reasoning) ? brief.decisions_reasoning[openDecisionIdx] : null}
          onClose={() => setOpenDecisionIdx(null)}
          onMarkDone={(idx) => toggleDecision(idx)}
          onDismiss={(idx) => toggleDismiss(idx)}
          onAddToCalendar={(d, idx) => addDecisionToCalendar(d, idx)}
          onAskAboutThis={(decision, idx) => {
            const parsed = parseDecision(decision);
            const reasoning = Array.isArray(brief.decisions_reasoning) ? brief.decisions_reasoning[idx] : "";
            openChat({
              id: `playbook-${idx}-${todayKey}`,
              type: "playbook",
              ticker: parsed.ticker,
              description: `${decision}${reasoning ? ` — Reasoning: ${reasoning}` : ""}`,
            });
            setOpenDecisionIdx(null); // close the detail modal so chat is the focus
          }}
        />
      )}

      {/* Brokerage guide modal — device-aware. On desktop, broker buttons open
          the broker login in a new tab. On mobile, an honest notice tells the
          user to use a computer, since broker CSV exports are essentially
          desktop-only flows. */}
      {showBrokerageGuide && (
        <BrokerageGuide
          isMobile={isMobile}
          onClose={() => setShowBrokerageGuide(false)}
          onOpenLink={(url, opts = {}) => {
            if (opts.mobileMessage) {
              setShowBrokerageGuide(false);
              setShowCsvImport(true);
              setCsvImportMessage({
                type: "error",
                text: `Open Morning Edge on your computer to download your ${opts.brokerName} CSV. Once it's saved, come back here to upload.`,
              });
              return;
            }
            setShowBrokerageGuide(false);
            // Desktop: open in a new tab; no in-app browser needed
            if (typeof window !== "undefined") {
              window.open(url, "_blank", "noopener,noreferrer");
            }
          }}
        />
      )}

      {/* Settings */}
      {showSettings && (
        <section className="relative mx-4 mb-6 p-5 rounded-2xl bg-white shadow-md border border-slate-100">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[16px] font-semibold text-slate-900">Settings</h2>
            <button onClick={() => setShowSettings(false)} className="text-slate-700 hover:text-slate-900">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="mb-4">
            <label className="text-[12px] uppercase tracking-widest text-slate-700 font-semibold mb-1 block">Your name</label>
            <input value={name} onChange={(e) => setName(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-[16px] focus:outline-none focus:border-slate-900 focus:bg-white" />
          </div>
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <label className="text-[12px] uppercase tracking-widest text-slate-700 font-semibold">Watchlist</label>
              <span className="text-[13px] text-slate-700">{portfolio.length} tickers</span>
            </div>
            <div className="flex gap-2 mb-3">
              <input value={tickerInput} onChange={(e) => setTickerInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addTicker()}
                placeholder="Add ticker"
                className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-[16px] focus:outline-none focus:border-slate-900 focus:bg-white" />
              <button onClick={addTicker} className="px-4 py-2 bg-slate-900 text-white rounded-xl font-semibold text-[16px]">
                <Plus className="w-4 h-4" />
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {portfolio.map((t) => (
                <span key={t} className="inline-flex items-center gap-1 bg-slate-100 border border-slate-200 px-2 py-1 rounded-lg text-[13px] text-slate-800 font-medium">
                  {t}
                  <button onClick={() => removeTicker(t)} className="hover:text-rose-600">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          </div>

          {/* Manage Accounts — per-account view with delete buttons.
              Lets the user remove a single brokerage account without
              having to nuke everything via "Reset all data". */}
          {(accountsState.length > 0 || holdings.length > 0) && (
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-[12px] uppercase tracking-[0.2em] text-slate-700 font-semibold">
                  Synced Accounts
                </h3>
                <span className="text-[12px] text-slate-500">
                  {accountsState.length} account{accountsState.length === 1 ? "" : "s"} · {holdings.length} position{holdings.length === 1 ? "" : "s"}
                </span>
              </div>
              {accountsState.length > 0 ? (
                <div className="space-y-2">
                  {accountsState.map((acct) => {
                    const acctHoldings = holdings.filter((h) => h.accountId === acct.id);
                    return (
                      <div key={acct.id} className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5">
                        <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center">
                          <Briefcase className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[14px] font-semibold text-slate-900 truncate" style={{ fontFamily: SERIF }}>
                            {acct.name || "Unnamed account"}
                          </p>
                          <p className="text-[11px] text-slate-700 uppercase tracking-wider">
                            {acctHoldings.length} position{acctHoldings.length === 1 ? "" : "s"}
                            {acct.brokerage ? ` · ${acct.brokerage}` : ""}
                          </p>
                        </div>
                        <button
                          onClick={() => deleteAccount(acct.id)}
                          className="flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center text-rose-600 hover:bg-rose-50 active:bg-rose-100 transition"
                          aria-label={`Delete ${acct.name}`}
                          title="Delete this account"
                        >
                          <Trash2 className="w-4 h-4" strokeWidth={2.2} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                // Untagged legacy holdings — show a "Clear holdings" option
                <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-amber-900">
                      {holdings.length} unassigned position{holdings.length === 1 ? "" : "s"}
                    </p>
                    <p className="text-[11px] text-amber-800">
                      From an older import. Clear and re-upload to organize by account.
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      if (typeof window !== "undefined" && !window.confirm("Clear all unassigned holdings?")) return;
                      setHoldings([]);
                      setHoldingsRefreshedAt(null);
                    }}
                    className="flex-shrink-0 px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-white border border-amber-300 text-amber-900 hover:bg-amber-100"
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>
          )}

          <button
            onClick={() => { setShowSettings(false); setShowBrokerageGuide(true); }}
            className="w-full mb-3 py-2.5 rounded-xl text-[13px] text-amber-800 hover:bg-amber-50 border border-amber-300 font-semibold flex items-center justify-center gap-1.5"
          >
            <Briefcase className="w-3.5 h-3.5" />
            Brokerage Help — Where to find your CSV
          </button>
          <button onClick={resetAll}
            className="w-full py-2 rounded-xl text-[13px] text-rose-600 hover:bg-rose-50 border border-rose-200 font-semibold">
            Reset all data
          </button>
        </section>
      )}

      {/* Generate / Refresh — only visible when no brief yet at all.
          When a brief IS on screen and we're loading (optimistic refresh
          from cached brief), the big button stays hidden — the small
          "Refreshing brief…" banner up top is enough. The user can read
          the cached brief while the new one loads in background. */}
      {/* Loading state button — rotating evocative messages while brief
          generates. Empty state is handled by separate block below. */}
      {!brief && loading && (
        <div className="relative px-6 pb-6 space-y-2">
          <button
            disabled
            className="w-full py-4 rounded-xl font-semibold tracking-wide flex items-center justify-center gap-2 transition shadow-lg bg-slate-200 text-slate-700 shadow-none"
          >
            {(() => {
              const msgs = [
                "Reading the tape…",
                "Scanning smart money flow…",
                "Checking earnings & catalysts…",
                "Tuning your edge…",
                "Pulling congressional disclosures…",
                "Almost there…",
              ];
              const m = msgs[loadingStatusIdx % msgs.length];
              return (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span key={m} style={{ animation: "me-status-fade 0.5s ease-out" }}>{m}</span>
                </>
              );
            })()}
          </button>
          {error && (
            <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-xl flex gap-2 text-[16px] text-amber-800">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span className="break-words">{error}</span>
            </div>
          )}
        </div>
      )}
      {error && brief && !loading && (
        <div className="relative px-6 pb-2">
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex gap-2 text-[16px] text-amber-800">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span className="break-words">{error}</span>
          </div>
        </div>
      )}

      {/* Loading skeleton — branded placeholder cards that show the shape
          of the brief, with section labels visible so users see what's
          coming. Each card has a colored top bar matching the real card
          for that section, plus a small "Building your X..." status. */}
      {loading && !brief && (
        <main className="relative px-4 pb-16 space-y-4">
          {/* Status banner */}
          <div className="rounded-xl p-3 bg-gradient-to-br from-violet-100 to-indigo-100 border border-violet-200 flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-violet-700 animate-spin flex-shrink-0" strokeWidth={2.5} />
            <p className="text-[13px] text-violet-900 font-semibold">
              Building your edge — reading today's tape, checking your holdings…
            </p>
          </div>
          {/* Affirmation skeleton */}
          <div className="rounded-3xl p-8 shadow-md border border-slate-100 bg-gradient-to-br from-amber-50 via-rose-50 to-violet-50">
            <div className="w-12 h-12 rounded-full mx-auto mb-4 bg-white/60 animate-pulse" />
            <div className="h-3 w-24 mx-auto mb-3 rounded bg-slate-200/60 animate-pulse" />
            <div className="h-5 w-3/4 mx-auto mb-2 rounded bg-slate-300/60 animate-pulse" />
            <div className="h-5 w-2/3 mx-auto rounded bg-slate-300/60 animate-pulse" />
          </div>
          {/* Section skeletons with labels so the user knows what's loading */}
          {[
            { label: "Market Pulse", color: "#3b82f6" },
            { label: "Your Holdings · Today", color: "#10b981" },
            { label: "Your Holdings · Ongoing Watch", color: "#059669" },
            { label: "Insider Flow", color: "#d97706" },
            { label: "Discovery · Opportunities & Radar", color: "#0891b2" },
          ].map((sec) => (
            <div key={sec.label} className="rounded-2xl bg-white shadow-md border border-slate-100 overflow-hidden">
              {/* Colored top bar */}
              <div className="h-1 w-full" style={{ background: sec.color }} />
              {/* Label */}
              <div className="px-4 py-3 flex items-center gap-2 border-b border-slate-100">
                <div className="w-7 h-7 rounded-md animate-pulse" style={{ background: sec.color, opacity: 0.2 }} />
                <p className="text-[12px] uppercase tracking-[0.2em] font-bold text-slate-500">
                  {sec.label}
                </p>
              </div>
              <div className="px-5 py-4 space-y-3">
                <div className="h-4 w-full rounded bg-slate-200 animate-pulse" />
                <div className="h-4 w-5/6 rounded bg-slate-200 animate-pulse" />
                <div className="h-4 w-4/6 rounded bg-slate-200 animate-pulse" />
              </div>
            </div>
          ))}
        </main>
      )}

      {/* Brief */}
      {brief && (
        <main
          className="relative px-4 pb-16 space-y-4"
          style={{
            // Subtle dimming + slight pulse on the cached brief while fresh
            // data loads in the background, so the user senses the brief is
            // being refreshed but can still read it. When loading ends, this
            // smoothly fades back to full brightness as the new brief lands.
            opacity: loading ? 0.85 : 1,
            transition: "opacity 0.6s ease",
          }}
        >
          {/* Sync Portfolio block is now rendered persistently via the twin
              buttons section near the top — no need to render it here too. */}

          {/* Ask Anything — top-level entry point for general questions about
              the user's portfolio, today's market, or anything investing-
              related. Differs from the per-card "Ask about this" buttons in
              that it has no specific card context — Claude has access to
              the full brief and full portfolio. The user types whatever
              they want. */}
          <button
            onClick={() => {
              openChat({
                id: `general-${todayKey}`,
                type: "general",
                description: "General question about today's brief or your portfolio. The user has the full brief in front of them and may reference any section.",
              });
            }}
            className="w-full rounded-2xl px-4 py-3.5 transition active:scale-[0.99] hover:shadow-md flex items-center gap-3 text-left border"
            style={{
              background: "linear-gradient(135deg, #f5f3ff 0%, #faf5ff 60%, #fdf4ff 100%)",
              borderColor: "#ddd6fe",
              boxShadow: "0 2px 8px -2px rgba(139, 92, 246, 0.12)",
            }}
          >
            <div
              className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center"
              style={{ background: "linear-gradient(135deg, #8B5CF6 0%, #A78BFA 100%)" }}
            >
              <Sparkles className="w-5 h-5 text-white" strokeWidth={2.5} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] uppercase tracking-[0.2em] font-bold text-violet-700 leading-none mb-1">
                Ask Morning Edge
              </p>
              <p className="text-[15px] text-slate-800 leading-snug truncate">
                Anything about your portfolio or today's brief…
              </p>
            </div>
            <ChevronRight className="w-5 h-5 text-violet-400 flex-shrink-0" strokeWidth={2.5} />
          </button>

          {visible.market_pulse && brief.market_pulse && (() => {
            // Tone drives the hero color treatment so the card feels alive
            // rather than dry. Bullish = teal energy, cautious = amber care,
            // bearish = rose alert. Each tone gets a gradient banner + matching
            // bullet accent so the eye lands on the energy of today's market.
            const tone = (brief.market_pulse.tone || "neutral").toLowerCase();
            const toneTheme =
              tone.includes("bull") ? {
                heroBg: "linear-gradient(135deg, #ecfdf5 0%, #d1fae5 60%, #a7f3d0 100%)",
                heroBorder: "#6ee7b7",
                accent: "#047857",
                accentDark: "#064e3b",
                badge: "rgba(5,150,105,0.18)",
                bulletDot: "linear-gradient(135deg, #34d399, #059669)",
                emoji: "📈",
                kicker: "Bullish tape",
              }
              : tone.includes("bear") ? {
                heroBg: "linear-gradient(135deg, #fef2f2 0%, #fee2e2 60%, #fecaca 100%)",
                heroBorder: "#fca5a5",
                accent: "#b91c1c",
                accentDark: "#7f1d1d",
                badge: "rgba(220,38,38,0.18)",
                bulletDot: "linear-gradient(135deg, #f87171, #dc2626)",
                emoji: "📉",
                kicker: "Bearish tape",
              }
              : tone.includes("caut") || tone.includes("mix") ? {
                heroBg: "linear-gradient(135deg, #fffbeb 0%, #fef3c7 60%, #fde68a 100%)",
                heroBorder: "#fcd34d",
                accent: "#b45309",
                accentDark: "#78350f",
                badge: "rgba(217,119,6,0.18)",
                bulletDot: "linear-gradient(135deg, #fbbf24, #d97706)",
                emoji: "⚖️",
                kicker: "Cautious tape",
              }
              : {
                heroBg: "linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 60%, #cbd5e1 100%)",
                heroBorder: "#94a3b8",
                accent: "#475569",
                accentDark: "#1e293b",
                badge: "rgba(71,85,105,0.18)",
                bulletDot: "linear-gradient(135deg, #94a3b8, #475569)",
                emoji: "📊",
                kicker: "Tape read",
              };

            return (
              <Card theme={themes.pulse}>
                <CardHeader icon={<Sun className="w-4 h-4" />} label="Market Pulse" theme={themes.pulse} />

                {/* Hero — compact tone read, takes minimal vertical space */}
                <div
                  className="mx-4 mt-3 rounded-xl px-4 py-3 relative overflow-hidden"
                  style={{
                    background: toneTheme.heroBg,
                    border: `1px solid ${toneTheme.heroBorder}`,
                    boxShadow: `0 3px 12px -6px ${toneTheme.badge}`,
                  }}
                >
                  <div
                    aria-hidden
                    style={{
                      position: "absolute",
                      top: -20,
                      right: -20,
                      width: 80,
                      height: 80,
                      borderRadius: "50%",
                      background: `radial-gradient(circle, ${toneTheme.heroBorder} 0%, transparent 70%)`,
                      opacity: 0.4,
                      pointerEvents: "none",
                    }}
                  />
                  <div className="relative">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span style={{ fontSize: 18, lineHeight: 1 }}>{toneTheme.emoji}</span>
                      <span
                        className="text-[10px] font-bold uppercase tracking-[0.18em]"
                        style={{ color: toneTheme.accent, letterSpacing: "0.16em" }}
                      >
                        {toneTheme.kicker}
                      </span>
                      <span
                        className="text-[16px] font-bold leading-none uppercase tracking-wide"
                        style={{ fontFamily: SERIF, color: toneTheme.accentDark }}
                      >
                        {brief.market_pulse.tone}
                      </span>
                    </div>
                    {brief.market_pulse.summary && (
                      <p
                        className="text-[14px] leading-snug m-0"
                        style={{ color: "#0f172a" }}
                      >
                        {brief.market_pulse.summary}
                      </p>
                    )}
                  </div>
                </div>

                {/* Key-level mini-cards — each level gets its own pill, tappable to expand */}
                <div className="px-5 pt-4 pb-4">
                  <p
                    className="text-[12px] font-bold uppercase tracking-[0.2em] mb-3 flex items-center gap-2"
                    style={{ color: toneTheme.accent }}
                  >
                    <span className="inline-block w-6 h-px" style={{ background: toneTheme.accent }}></span>
                    What's moving
                    <span className="inline-block flex-1 h-px" style={{ background: toneTheme.accent, opacity: 0.3 }}></span>
                  </p>
                  <div className="flex flex-col gap-2.5">
                    {(brief.market_pulse.key_levels || []).map((k, i) => (
                      <ExpandableLevelRow key={i} index={i + 1} text={k} theme={toneTheme} />
                    ))}
                  </div>
                </div>
              </Card>
            );
          })()}
          {/* PLAYBOOK — tappable check-offs that persist per day */}
          {visible.decisions && Array.isArray(brief.decisions) && brief.decisions.length > 0 && (
            <Card theme={themes.play}>
              <CardHeader icon={<CheckSquare className="w-4 h-4" />} label="Today's Playbook" theme={themes.play} />
              <div className="px-5 py-6">
                <p className="text-[13px] uppercase tracking-[0.2em] text-emerald-700/80 font-medium mb-1 -mt-2">
                  Your portfolio at a glance
                </p>
                <p className="text-[13px] text-slate-700 italic mb-4">
                  What to act on today, plus high-conviction signals to monitor. Tap any card for full reasoning.
                </p>
                {/* Personalization indicator */}
                {holdings.length > 0 ? (
                  <div className="mb-4 flex items-center gap-2 text-[12px] tracking-wider uppercase font-semibold">
                    <span className="px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 border border-violet-200">
                      ✓ Personalized
                    </span>
                    <span className="text-slate-700">
                      Built from your {holdings.length} position{holdings.length === 1 ? "" : "s"}
                    </span>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      // Open the wealth filter and the CSV import panel
                      setFilter("wealth");
                      setShowCsvImport(true);
                      // Scroll to the wealth section
                      setTimeout(() => {
                        const el = document.querySelector('[data-csv-import-anchor]');
                        if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
                      }, 100);
                    }}
                    className="w-full mb-5 p-4 rounded-xl text-left transition-all duration-150 hover:shadow-lg active:scale-[0.99] group"
                    style={{
                      background: "linear-gradient(135deg, #1E293B 0%, #0F172A 100%)",
                      border: "1px solid #334155",
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex-shrink-0 w-11 h-11 rounded-lg flex items-center justify-center"
                        style={{ background: "linear-gradient(135deg, #D4A574 0%, #F5D08C 100%)" }}>
                        <Briefcase className="w-5 h-5" style={{ color: "#1E293B" }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] tracking-[0.25em] uppercase font-bold mb-1"
                          style={{ color: "#D4A574" }}>
                          Unlock Personalized Playbook
                        </p>
                        <p className="text-[16px] font-semibold leading-snug"
                          style={{ color: "#F8FAFC", fontFamily: SERIF }}>
                          Sync your portfolio for trade recommendations built on your actual positions.
                        </p>
                      </div>
                      <ArrowRight className="w-5 h-5 flex-shrink-0 transition-transform group-hover:translate-x-0.5"
                        style={{ color: "#D4A574" }} />
                    </div>
                    <p className="text-[13px] text-slate-500 mt-3 ml-14 leading-relaxed">
                      Tap to open. Upload a CSV from any brokerage. Holdings stay on your device.
                    </p>
                  </button>
                )}

                {/* Progress bar */}
                <div className="flex items-center justify-between mb-5">
                  <p className="text-[12px] tracking-[0.2em] uppercase font-semibold text-slate-700">
                    {decisionsDoneToday.length} of {brief.decisions.length} done
                  </p>
                  <div className="flex-1 ml-3 h-1 rounded-full bg-slate-100 overflow-hidden">
                    <div className="h-full bg-emerald-500 transition-all duration-300"
                      style={{ width: `${brief.decisions.length ? (decisionsDoneToday.length / brief.decisions.length) * 100 : 0}%` }} />
                  </div>
                </div>

                {/* TWO-COLUMN layout: TODAY actions on left, HIGH CONVICTION watch on right.
                    Each column has its own colorful header so the two are distinct at a glance. */}
                <div className="grid grid-cols-2 gap-3">
                  {/* LEFT COLUMN — Today's Moves (act now) */}
                  <div>
                    <div className="rounded-lg px-2 py-1.5 mb-2 text-center"
                      style={{
                        background: "linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%)",
                        border: "1px solid #6ee7b7",
                      }}>
                      <p className="text-[10px] uppercase tracking-[0.18em] font-bold text-emerald-900 m-0 leading-tight">
                        Today's Moves
                      </p>
                      <p className="text-[9px] text-emerald-800 m-0 leading-tight mt-0.5">
                        Act now
                      </p>
                    </div>
                    <ol className="flex flex-col gap-2 list-none p-0 m-0">
                      {brief.decisions.map((d, i) => {
                        const done = decisionsDoneToday.includes(i);
                        const dismissed = decisionsDismissedToday.includes(i);
                        return (
                          <li key={i} className="m-0 p-0">
                            <PlaybookActionCard
                              decision={d}
                              idx={i}
                              done={done}
                              dismissed={dismissed}
                              onOpen={(idx) => setOpenDecisionIdx(idx)}
                            />
                          </li>
                        );
                      })}
                    </ol>
                  </div>

                  {/* RIGHT COLUMN — High Conviction (watch / monitor) */}
                  <div>
                    <div className="rounded-lg px-2 py-1.5 mb-2 text-center"
                      style={{
                        background: "linear-gradient(135deg, #ddd6fe 0%, #c4b5fd 100%)",
                        border: "1px solid #a78bfa",
                      }}>
                      <p className="text-[10px] uppercase tracking-[0.18em] font-bold text-violet-900 m-0 leading-tight">
                        High Conviction
                      </p>
                      <p className="text-[9px] text-violet-800 m-0 leading-tight mt-0.5">
                        Worth watching
                      </p>
                    </div>
                    {Array.isArray(brief.conviction_watch) && brief.conviction_watch.length > 0 ? (
                      <ul className="flex flex-col gap-2 list-none p-0 m-0">
                        {brief.conviction_watch.filter(Boolean).map((c, i) => {
                          if (!c || typeof c !== "object") return null;
                          const hasAction = !!c.action;
                          const summaryLine = c.note || (c.why_now ? c.why_now.split(/[.!?]/)[0] + "." : "Tap for full reasoning");
                          // Use the SAME themes/icons as Today's Moves so the columns match.
                          // Map signal → action type (with sensible fallbacks).
                          const actionType =
                            c.signal === "trim" ? "trim"
                            : c.signal === "add" ? "add"
                            : c.signal === "protect" ? "protect"
                            : "watch";
                          const sigTheme = DECISION_THEMES[actionType] || DECISION_THEMES.watch;
                          const SignalIcon = ACTION_ICON_MAP[actionType] || Eye;
                          const signalLabel = (c.signal || "watch").toUpperCase();
                          return (
                            <li key={i} className="m-0 p-0">
                              <button
                                onClick={() => setReadingPage({
                                  id: `conviction-${c.ticker || i}-${todayKey}`,
                                  type: "conviction",
                                  ticker: c.ticker,
                                  signal: c.signal,
                                  headline: `${signalLabel} ${c.ticker}`,
                                  action: c.action,
                                  why_now: c.why_now,
                                  note: c.note,
                                  deep_reasoning: c.deep_reasoning,
                                  holding: holdings.find(h => h.symbol === c.ticker),
                                  chatDescription: `${signalLabel} ${c.ticker}${c.action ? ` — ${c.action}` : ""}${c.why_now ? `. ${c.why_now}` : ""}${c.deep_reasoning ? ` Full reasoning: ${c.deep_reasoning}` : ""}`,
                                })}
                                className="w-full h-full text-left transition-all duration-150 active:scale-[0.99] hover:shadow-md"
                                style={{
                                  background: sigTheme.bg,
                                  border: `2px solid ${sigTheme.border}`,
                                  borderRadius: 10,
                                  padding: "6px 8px",
                                  boxShadow: `0 3px 10px -3px ${sigTheme.shadow}, inset 0 1.5px 0 rgba(255,255,255,0.85), inset 0 -1.5px 0 rgba(0,0,0,0.05)`,
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: 4,
                                  minHeight: 68,
                                }}
                              >
                                {/* Top row: colored icon square + ticker + label — matches Today's Moves */}
                                <div className="flex items-center gap-1.5">
                                  <div
                                    className="flex-shrink-0 flex items-center justify-center"
                                    style={{ width: 24, height: 24, borderRadius: 6, background: sigTheme.iconBg }}
                                  >
                                    <SignalIcon className="w-3 h-3" style={{ color: "white", strokeWidth: 2.6 }} />
                                  </div>
                                  {c.ticker && (
                                    <p
                                      className="text-[14px] font-bold m-0 leading-tight truncate"
                                      style={{ color: "#0f172a", fontFamily: SERIF }}
                                    >
                                      {c.ticker}
                                    </p>
                                  )}
                                  <span className="ml-auto text-[8.5px] font-bold tracking-[0.14em] uppercase" style={{ color: sigTheme.labelText }}>
                                    {signalLabel}
                                  </span>
                                </div>
                                {/* Reasoning preview */}
                                <div className="flex-1 min-w-0">
                                  <p className="text-[11.5px] m-0 leading-snug" style={{
                                    color: "#1e293b",
                                    display: "-webkit-box",
                                    WebkitLineClamp: 2,
                                    WebkitBoxOrient: "vertical",
                                    overflow: "hidden",
                                  }}>
                                    {hasAction && c.action ? c.action : summaryLine}
                                  </p>
                                </div>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      // Empty state for conviction column — keeps the column visible
                      <div className="rounded-xl p-3"
                        style={{
                          background: "linear-gradient(135deg, #ede9fe 0%, #ddd6fe 100%)",
                          border: "1px solid #c4b5fd",
                          minHeight: 88,
                        }}>
                        <p className="text-[12px] text-violet-900 leading-relaxed m-0">
                          {(holdings && holdings.length > 0)
                            ? "Quiet day for your positions. No high-conviction signals."
                            : "Sync your portfolio to see signals on stocks you own."}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Helper text */}
                <p className="mt-4 text-[13px] text-slate-700 text-center italic">
                  Tap any card for full reasoning and to act on it.
                </p>

                {/* Completion celebration */}
                {brief.decisions.length > 0 && decisionsDoneToday.length === brief.decisions.length && (
                  <div className="mt-5 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-center">
                    <p className="text-[16px] font-semibold text-emerald-800" style={{ fontFamily: SERIF }}>
                      ✓ Day complete. You did the work.
                    </p>
                  </div>
                )}
              </div>
            </Card>
          )}
          {/* Conviction section is now MERGED into Today's Playbook above as the right column.
              We hide the standalone conviction card to avoid duplication. */}
          {false && visible.conviction && (
            (Array.isArray(brief.conviction_watch) && brief.conviction_watch.length > 0) ? (
            <Card theme={themes.conviction}>
              <CardHeader icon={<TrendingUp className="w-4 h-4" />} label="Your Holdings · Ongoing Watch" theme={themes.conviction} />
              <div className="px-3 pt-1 pb-3 space-y-2">
                <p className="text-[13px] uppercase tracking-[0.2em] text-emerald-700/80 font-medium px-1 mb-1">
                  Hold · Add · Trim signals worth monitoring
                </p>
                <p className="text-[12px] text-slate-700 italic px-1 mb-3">
                  Not necessarily today. Background watch on your positions. Tap any signal for full reasoning.
                </p>
                <div className="grid grid-cols-2 gap-2">
                {brief.conviction_watch.filter(Boolean).map((c, i) => {
                  if (!c || typeof c !== "object") return null;
                  const hasAction = !!c.action;
                  const dow = new Date().getDay();
                  const actionLabel = (dow === 0 || dow === 6) ? "NEXT SESSION" : "ACTION TODAY";
                  const actionAccent = c.signal === "trim"
                    ? { bar: "bg-rose-500", chip: "bg-rose-100 text-rose-800 border-rose-200", label: actionLabel }
                    : c.signal === "add"
                      ? { bar: "bg-emerald-500", chip: "bg-emerald-100 text-emerald-800 border-emerald-200", label: actionLabel }
                      : { bar: "bg-amber-500", chip: "bg-amber-100 text-amber-800 border-amber-200", label: actionLabel };
                  // Scannable summary line — short version of why_now or note,
                  // truncated to a single readable line for the brief view.
                  // Full text stays available on the reading page.
                  const summaryLine = c.note || (c.why_now ? c.why_now.split(/[.!?]/)[0] + "." : "Tap for full reasoning");
                  return (
                    <button
                      key={i}
                      onClick={() => setReadingPage({
                        id: `conviction-${c.ticker || i}-${todayKey}`,
                        type: "conviction",
                        ticker: c.ticker,
                        signal: c.signal,
                        headline: `${c.signal?.toUpperCase() || "WATCH"} ${c.ticker}`,
                        action: c.action,
                        why_now: c.why_now,
                        note: c.note,
                        deep_reasoning: c.deep_reasoning,
                        holding: holdings.find(h => h.symbol === c.ticker),
                        chatDescription: `${c.signal?.toUpperCase() || "WATCH"} ${c.ticker}${c.action ? ` — ${c.action}` : ""}${c.why_now ? `. ${c.why_now}` : ""}${c.deep_reasoning ? ` Full reasoning: ${c.deep_reasoning}` : ""}`,
                      })}
                      className={`relative w-full h-full text-left rounded-xl px-2.5 py-2.5 bg-slate-50 border ${hasAction ? "border-slate-200 shadow-sm" : "border-slate-100"} overflow-hidden transition active:scale-[0.99] active:bg-slate-100 hover:bg-slate-100 flex flex-col gap-1.5`}
                      style={{ minHeight: 88 }}
                    >
                      {/* Colored left-edge bar — only for high-conviction action items */}
                      {hasAction && (
                        <span className={`absolute left-0 top-0 bottom-0 w-1 ${actionAccent.bar}`} aria-hidden="true" />
                      )}
                      {/* Top row: signal chip + ticker */}
                      <div className={`flex items-center gap-1.5 flex-wrap ${hasAction ? "pl-1.5" : ""}`}>
                        <span className={`px-1.5 py-0.5 rounded-md text-[10px] uppercase tracking-wider border font-bold flex items-center gap-0.5 flex-shrink-0 ${signalStyle(c.signal)}`}>
                          {signalIcon(c.signal)}{c.signal}
                        </span>
                        <p className="text-[15px] font-bold text-slate-900 flex-shrink-0" style={{ fontFamily: SERIF }}>{c.ticker}</p>
                      </div>
                      {hasAction && (
                        <span className={`text-[9px] uppercase tracking-wider font-bold w-fit ${actionAccent.chip} px-1.5 py-0.5 rounded border ${hasAction ? "ml-1.5" : ""}`}>
                          {actionAccent.label}
                        </span>
                      )}
                      <p className={`text-[12px] text-slate-700 leading-snug flex-1 ${hasAction ? "pl-1.5" : ""}`} style={{
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                      }}>
                        {hasAction && c.action ? c.action : summaryLine}
                      </p>
                      <div className={`flex items-center justify-between mt-auto ${hasAction ? "pl-1.5" : ""}`}>
                        <span className="text-[10px] italic text-slate-500">Tap for reasoning</span>
                        <ChevronRight className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" strokeWidth={2.2} />
                      </div>
                    </button>
                  );
                })}
                </div>
              </div>
            </Card>
            ) : (
              // Empty state — when there are no high-conviction signals on
              // user's holdings today (or holdings aren't synced yet). The
              // section header still shows so the user knows the feature
              // exists; the body explains what to do.
              <Card theme={themes.conviction}>
                <CardHeader icon={<TrendingUp className="w-4 h-4" />} label="Your Holdings · Ongoing Watch" theme={themes.conviction} />
                <div className="px-5 pt-1 pb-5">
                  <p className="text-[13px] uppercase tracking-[0.2em] text-emerald-700/80 font-medium mb-3">
                    Hold · Add · Trim signals worth monitoring
                  </p>
                  <div className="rounded-xl bg-emerald-50/60 border border-emerald-200 p-4">
                    <p className="text-[14px] text-emerald-900 leading-relaxed m-0">
                      {(holdings && holdings.length > 0)
                        ? "Quiet day for your positions — no high-conviction signals today. Sometimes the best move is to do nothing."
                        : "Sync your portfolio to see hold/add/trim signals tailored to the stocks you actually own."}
                    </p>
                  </div>
                </div>
              </Card>
            )
          )}
          {visible.smart_money && (
            brief.smart_money ? (
            <Card theme={themes.money}>
              <CardHeader icon={<Eye className="w-4 h-4" />} label="Insider Flow" theme={themes.money} />
              <div className="px-5 pt-1 pb-5">
                <p className="text-[13px] uppercase tracking-[0.2em] text-amber-700/80 font-medium mb-4">
                  Whales · Congress · Hedge Funds
                </p>

                {/* Compact summary banner — Today's Edge alerts + Most Bought/Sold tiles */}
                {brief.smart_money.summary && (
                  <div className="mb-5 rounded-xl bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200 px-3.5 py-3">
                    <div className="flex items-center gap-2 mb-1">
                      <Sparkles className="w-3 h-3 text-amber-700" />
                      <p className="text-[12px] uppercase tracking-[0.2em] text-amber-800 font-bold">
                        Today's Smart Money Read
                      </p>
                    </div>

                    {/* ─── SECTION 1: Today's Edge alerts (only shows when real alerts exist) ─── */}
                    {brief.todays_edge && (
                      (brief.todays_edge.earnings_alerts?.length || 0) +
                      (brief.todays_edge.binary_catalysts?.length || 0) +
                      (brief.todays_edge.risk_flags?.length || 0) > 0 ? (
                        <div className="mb-4 mt-2">
                          <div className="flex items-center gap-1.5 mb-2">
                            <span className="relative flex h-1.5 w-1.5">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-500 opacity-75" />
                              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-rose-500" />
                            </span>
                            <p className="text-[9px] uppercase tracking-wider text-rose-700 font-bold">
                              Today's Edge · Time-sensitive
                            </p>
                          </div>
                          <div className="space-y-1.5">
                            {/* Earnings alerts — RED */}
                            {(brief.todays_edge.earnings_alerts || []).map((e, i) => (
                              <button
                                key={`earn-${i}`}
                                onClick={() => openLinkInBrowser(`https://finance.yahoo.com/quote/${e.ticker.toUpperCase()}`)}
                                className="w-full flex items-center gap-2 rounded-lg bg-rose-100/80 border border-rose-300 px-2.5 py-1.5 hover:bg-rose-200 active:bg-rose-300 transition text-left"
                              >
                                <span className="text-[9px] uppercase tracking-wider font-bold text-rose-800 flex-shrink-0">Earnings</span>
                                <span className="text-[16px] font-bold text-slate-900 flex-shrink-0" style={{ fontFamily: SERIF }}>{e.ticker}</span>
                                <span className="text-[13px] text-rose-900 flex-1 leading-tight truncate">
                                  {e.when}{e.your_shares ? ` · ${e.your_shares} sh` : ""}
                                </span>
                                <ExternalLink className="w-3 h-3 text-rose-700 flex-shrink-0" />
                              </button>
                            ))}
                            {/* Binary catalysts — AMBER */}
                            {(brief.todays_edge.binary_catalysts || []).map((c, i) => (
                              <button
                                key={`cat-${i}`}
                                onClick={() => openLinkInBrowser(`https://finance.yahoo.com/quote/${c.ticker.toUpperCase()}`)}
                                className="w-full flex items-center gap-2 rounded-lg bg-amber-100/80 border border-amber-300 px-2.5 py-1.5 hover:bg-amber-200 active:bg-amber-300 transition text-left"
                              >
                                <span className="text-[9px] uppercase tracking-wider font-bold text-amber-800 flex-shrink-0">Catalyst</span>
                                <span className="text-[16px] font-bold text-slate-900 flex-shrink-0" style={{ fontFamily: SERIF }}>{c.ticker}</span>
                                <div className="flex-1 min-w-0">
                                  <p className="text-[13px] text-amber-900 leading-tight font-semibold truncate">{c.event}</p>
                                  {c.context && <p className="text-[12px] text-amber-800/80 leading-tight truncate">{c.context}</p>}
                                </div>
                                <ExternalLink className="w-3 h-3 text-amber-700 flex-shrink-0" />
                              </button>
                            ))}
                            {/* Risk flags — ORANGE */}
                            {(brief.todays_edge.risk_flags || []).map((r, i) => (
                              <button
                                key={`risk-${i}`}
                                onClick={() => openLinkInBrowser(`https://finance.yahoo.com/quote/${r.ticker.toUpperCase()}`)}
                                className="w-full flex items-center gap-2 rounded-lg bg-orange-100/80 border border-orange-300 px-2.5 py-1.5 hover:bg-orange-200 active:bg-orange-300 transition text-left"
                              >
                                <span className="text-[9px] uppercase tracking-wider font-bold text-orange-800 flex-shrink-0">Risk</span>
                                <span className="text-[16px] font-bold text-slate-900 flex-shrink-0" style={{ fontFamily: SERIF }}>{r.ticker}</span>
                                <div className="flex-1 min-w-0">
                                  <p className="text-[13px] text-orange-900 leading-tight font-semibold truncate">{r.flag}</p>
                                  {r.suggested_action && <p className="text-[12px] text-orange-800/80 leading-tight truncate">→ {r.suggested_action}</p>}
                                </div>
                                <ExternalLink className="w-3 h-3 text-orange-700 flex-shrink-0" />
                              </button>
                            ))}
                          </div>
                          {/* Divider between Today's Edge and Most Bought/Sold */}
                          <div className="mt-3 border-t border-amber-300/60" />
                        </div>
                      ) : null
                    )}

                    {/* ─── SECTION 2: Most Bought / Most Sold ─── */}
                    <p className="text-[9px] uppercase tracking-wider text-amber-800 font-bold mb-2">
                      Top Flow · Smart Money
                    </p>
                    <p className="text-[13px] text-slate-700 leading-snug mb-2.5">
                      The top 2 most-bought and top 2 most-sold names across whales, Congress, and hedge funds today. Tap to view performance.
                    </p>
                    {/* Most bought / sold — top 2 per side, tappable tickers open Yahoo Finance in-app */}
                    <div className="grid grid-cols-2 gap-2 mb-3">
                      {/* Most Bought column — top 2 */}
                      <div className="space-y-1.5">
                        <p className="text-[9px] uppercase tracking-wider text-emerald-700 font-bold px-1">
                          ▲ Most Bought
                        </p>
                        {(Array.isArray(brief.smart_money.summary.most_bought)
                          ? brief.smart_money.summary.most_bought
                          : brief.smart_money.summary.most_bought
                            ? [brief.smart_money.summary.most_bought]
                            : []
                        ).filter((t) => t && typeof t === "string" && !/^DATA_UNAVAIL|^N\/?A$|^NONE$|^UNKNOWN$/i.test(t.trim())).slice(0, 2).map((tkr, i) => (
                          <button
                            key={i}
                            onClick={() => openLinkInBrowser(`https://finance.yahoo.com/quote/${tkr.toUpperCase()}`)}
                            className="w-full flex items-center gap-2 rounded-lg bg-white border border-emerald-200 px-2.5 py-1.5 hover:bg-emerald-50 active:bg-emerald-100 transition text-left min-w-0 overflow-hidden"
                          >
                            <span className="text-[12px] text-emerald-700 font-semibold flex-shrink-0">#{i + 1}</span>
                            <span className="text-[16px] font-bold text-slate-900 flex-1 truncate" style={{ fontFamily: SERIF }}>
                              {tkr}
                            </span>
                            <ExternalLink className="w-3 h-3 text-emerald-600 flex-shrink-0" />
                          </button>
                        ))}
                      </div>
                      {/* Most Sold column — top 2 */}
                      <div className="space-y-1.5">
                        <p className="text-[9px] uppercase tracking-wider text-rose-700 font-bold px-1">
                          ▼ Most Sold
                        </p>
                        {(Array.isArray(brief.smart_money.summary.most_sold)
                          ? brief.smart_money.summary.most_sold
                          : brief.smart_money.summary.most_sold
                            ? [brief.smart_money.summary.most_sold]
                            : []
                        ).filter((t) => t && typeof t === "string" && !/^DATA_UNAVAIL|^N\/?A$|^NONE$|^UNKNOWN$/i.test(t.trim())).slice(0, 2).map((tkr, i) => (
                          <button
                            key={i}
                            onClick={() => openLinkInBrowser(`https://finance.yahoo.com/quote/${tkr.toUpperCase()}`)}
                            className="w-full flex items-center gap-2 rounded-lg bg-white border border-rose-200 px-2.5 py-1.5 hover:bg-rose-50 active:bg-rose-100 transition text-left min-w-0 overflow-hidden"
                          >
                            <span className="text-[12px] text-rose-700 font-semibold flex-shrink-0">#{i + 1}</span>
                            <span className="text-[16px] font-bold text-slate-900 flex-1 truncate" style={{ fontFamily: SERIF }}>
                              {tkr}
                            </span>
                            <ExternalLink className="w-3 h-3 text-rose-600 flex-shrink-0" />
                          </button>
                        ))}
                      </div>
                    </div>
                    {/* Sector chips — compact single-line layout */}
                    {(brief.smart_money.summary.net_bullish_sectors?.length || brief.smart_money.summary.net_bearish_sectors?.length) ? (
                      <div className="space-y-1.5">
                        {brief.smart_money.summary.net_bullish_sectors && brief.smart_money.summary.net_bullish_sectors.length > 0 && (
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[9px] uppercase tracking-wider text-emerald-700 font-bold flex-shrink-0">▲ Bullish</span>
                            {brief.smart_money.summary.net_bullish_sectors.map((s, i) => (
                              <span key={i} className="text-[13px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-medium">
                                {s}
                              </span>
                            ))}
                          </div>
                        )}
                        {brief.smart_money.summary.net_bearish_sectors && brief.smart_money.summary.net_bearish_sectors.length > 0 && (
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[9px] uppercase tracking-wider text-rose-700 font-bold flex-shrink-0">▼ Bearish</span>
                            {brief.smart_money.summary.net_bearish_sectors.map((s, i) => (
                              <span key={i} className="text-[13px] px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 font-medium">
                                {s}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                )}

                {/* Sector heatmap — visual stripe of sector flow direction */}
                {brief.smart_money.sector_heatmap && brief.smart_money.sector_heatmap.length > 0 && (
                  <div className="mb-5">
                    <p className="text-[12px] uppercase tracking-[0.2em] text-amber-700 font-semibold mb-2.5">Sector Flow</p>
                    <div className="space-y-1.5">
                      {brief.smart_money.sector_heatmap.map((s, i) => (
                        <SectorHeatmapBar key={i} sector={s.sector} direction={s.direction} intensity={s.intensity} />
                      ))}
                    </div>
                  </div>
                )}

                {/* Three boxed sub-sections — Whales, Congress, Hedge Funds */}
                <div className="space-y-3">
                  {/* Whales (institutional 13F filings) */}
                  <div className="rounded-xl border border-amber-200 bg-white/60 p-3.5">
                    <div className="flex items-center justify-between mb-2.5">
                      <h3 className="text-[13px] uppercase tracking-[0.18em] text-amber-800 font-bold flex items-center gap-1.5">
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500" />
                        Institutional Whales
                      </h3>
                      <span className="text-[9px] text-slate-500 italic">13F filings</span>
                    </div>
                    {(() => {
                      const moves = (brief.smart_money.whale_moves || []).filter(
                        (w) => w && (typeof w === "string" ? !/DATA_UNAVAIL|^N\/?A$|^NONE$/i.test(w) : !/DATA_UNAVAIL|^N\/?A$|^NONE$/i.test(w.text || ""))
                      );
                      return moves.length > 0 ? (
                        <ul className="space-y-1">
                          {moves.map((w, i) => (
                            <SmartMoneyRow key={i} item={w} category="whale" onOpenSourceDetail={(d) => setSourceDetail(d)} />
                          ))}
                        </ul>
                      ) : (
                        <p className="text-[13px] text-slate-600 italic">No notable 13F activity in the latest filing window.</p>
                      );
                    })()}
                  </div>

                  {/* Congress (STOCK Act disclosures) */}
                  <div className="rounded-xl border border-amber-200 bg-white/60 p-3.5">
                    <div className="flex items-center justify-between mb-2.5">
                      <h3 className="text-[13px] uppercase tracking-[0.18em] text-amber-800 font-bold flex items-center gap-1.5">
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500" />
                        Congress
                      </h3>
                      <span className="text-[9px] text-slate-500 italic">STOCK Act · ~30–45d delay</span>
                    </div>
                    {(() => {
                      const moves = (brief.smart_money.congress_moves || []).filter(
                        (c) => c && (typeof c === "string" ? !/DATA_UNAVAIL|^N\/?A$|^NONE$/i.test(c) : !/DATA_UNAVAIL|^N\/?A$|^NONE$/i.test(c.text || ""))
                      );
                      return moves.length > 0 ? (
                        <ul className="space-y-1">
                          {moves.map((c, i) => (
                            <SmartMoneyRow key={i} item={c} category="congress" onOpenSourceDetail={(d) => setSourceDetail(d)} />
                          ))}
                        </ul>
                      ) : (
                        <p className="text-[13px] text-slate-600 italic">No new STOCK Act disclosures in the latest window.</p>
                      );
                    })()}
                  </div>

                  {/* Hedge Funds — always render so users see the section is intentional */}
                  <div className="rounded-xl border border-amber-200 bg-white/60 p-3.5">
                    <div className="flex items-center justify-between mb-2.5">
                      <h3 className="text-[13px] uppercase tracking-[0.18em] text-amber-800 font-bold flex items-center gap-1.5">
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500" />
                        Hedge Funds
                      </h3>
                      <span className="text-[9px] text-slate-500 italic">fund-level rotations</span>
                    </div>
                    {(() => {
                      const moves = (brief.smart_money.hedge_fund_moves || []).filter(
                        (h) => h && (typeof h === "string" ? !/DATA_UNAVAIL|^N\/?A$|^NONE$/i.test(h) : !/DATA_UNAVAIL|^N\/?A$|^NONE$/i.test(h.text || ""))
                      );
                      return moves.length > 0 ? (
                        <ul className="space-y-1">
                          {moves.map((h, i) => (
                            <SmartMoneyRow key={i} item={h} category="hedge" onOpenSourceDetail={(d) => setSourceDetail(d)} />
                          ))}
                        </ul>
                      ) : (
                        <p className="text-[13px] text-slate-600 italic">No major fund rotations flagged today.</p>
                      );
                    })()}
                  </div>
                </div>

                <p className="mt-5 text-[12px] text-slate-700 leading-relaxed italic">
                  AI-summarized from public filings. Tap any row to see why it matters and verify the trade.
                </p>
              </div>
            </Card>
            ) : (
              // Fallback when smart_money chunk failed entirely - show the
              // section header so users know the feature exists, with an
              // honest message about why content is missing today.
              <Card theme={themes.money}>
                <CardHeader icon={<Eye className="w-4 h-4" />} label="Insider Flow" theme={themes.money} />
                <div className="px-5 pt-1 pb-5">
                  <p className="text-[13px] uppercase tracking-[0.2em] text-amber-700/80 font-medium mb-3">
                    Whales · Congress · Hedge Funds
                  </p>
                  <div className="rounded-xl bg-amber-50/60 border border-amber-200 p-4">
                    <p className="text-[14px] text-amber-900 leading-relaxed m-0">
                      Couldn't load institutional flow data right now. Pull to refresh, or check back in a few minutes.
                    </p>
                  </div>
                </div>
              </Card>
            )
          )}


          {visible.radar && (() => {
            const hasRadar = Array.isArray(brief.radar_watch) && brief.radar_watch.length > 0;
            const hasOpportunity = Array.isArray(brief.opportunity_watch) && brief.opportunity_watch.length > 0;
            // Show the section if EITHER list has content. If both are
            // empty, show a graceful empty state.
            if (!hasRadar && !hasOpportunity) {
              return (
                <Card theme={themes.radar}>
                  <CardHeader icon={<Telescope className="w-4 h-4" />} label="Discovery" theme={themes.radar} />
                  <div className="px-5 pt-1 pb-5">
                    <p className="text-[13px] uppercase tracking-[0.2em] text-cyan-700/80 font-medium mb-3">
                      Opportunities · On Your Radar
                    </p>
                    <div className="rounded-xl bg-cyan-50/60 border border-cyan-200 p-4">
                      <p className="text-[14px] text-cyan-900 leading-relaxed m-0">
                        No high-conviction discovery picks today. Quiet across AI, nuclear, quantum, and biotech themes — sometimes there's no signal worth acting on.
                      </p>
                    </div>
                  </div>
                </Card>
              );
            }

            // Default tab: Opportunity if it has content (more actionable),
            // otherwise Radar. The user can toggle.
            const defaultTab = hasOpportunity ? "opportunity" : "radar";
            return (
              <Card theme={themes.radar}>
                <CardHeader icon={<Telescope className="w-4 h-4" />} label="Discovery" theme={themes.radar} />
                <div className="px-3 pt-1 pb-4">
                  {/* Tab selector — Opportunity (portfolio-aware buys) vs Radar (general thematic) */}
                  <DiscoverySection
                    radar={hasRadar ? brief.radar_watch : []}
                    opportunity={hasOpportunity ? brief.opportunity_watch : []}
                    defaultTab={defaultTab}
                    holdings={holdings}
                    todayKey={todayKey}
                    onOpenReading={(d) => setReadingPage(d)}
                  />
                </div>
              </Card>
            );
          })()}


          {visible.mindset && brief.mindset && (
            <Card theme={themes.mindset}>
              <CardHeader icon={<Heart className="w-4 h-4" />} label="Mindset & Fuel" theme={themes.mindset} />
              <div className="px-5 py-5 space-y-3">
                <MindsetRowExpandable
                  icon={<Heart className="w-4 h-4" />}
                  kicker="Gratitude"
                  color="rose"
                  body={brief.mindset.gratitude}
                  expanded={expandedMindset === "gratitude"}
                  onToggle={() => setExpandedMindset(expandedMindset === "gratitude" ? null : "gratitude")}
                  detail={{
                    intent: "Today's voice — your inner anchor before the market opens.",
                    action: "Carry this line into your first decision today. Say it once, then act.",
                  }}
                />
                <MindsetRowExpandable
                  icon={<Coffee className="w-4 h-4" />}
                  kicker="Fuel"
                  color="amber"
                  body={(() => {
                    // Backwards-compatible: fuel might be a plain string
                    // (older briefs) or a structured object (newer briefs).
                    const f = brief.mindset.fuel;
                    if (typeof f === "string") return f;
                    if (f && typeof f === "object") return f.headline || "10-min activation: mobility, breath, strength, cooldown";
                    return "10-min vitality routine";
                  })()}
                  expanded={expandedMindset === "fuel"}
                  onToggle={() => setExpandedMindset(expandedMindset === "fuel" ? null : "fuel")}
                  detail={(() => {
                    const f = brief.mindset.fuel;
                    // Structured fuel — pass through the rich blocks
                    if (f && typeof f === "object" && Array.isArray(f.blocks)) {
                      return {
                        intent: `Today's routine: ${f.headline || "10-min activation"}. ${f.total_min || 10} minutes total.`,
                        fuelBlocks: f.blocks, // new field consumed by MindsetRowExpandable
                        tip: f.tip,
                        showStartButton: true,
                        onStart: () => setRoutineFlowOpen(true),
                      };
                    }
                    // Legacy string fuel — fall back to the old segment list
                    return {
                      intent: `Today's routine: ${todayRoutine().name}. Four segments, ten minutes total.`,
                      segments: todayRoutine().segments,
                      showStartButton: true,
                      onStart: () => setRoutineFlowOpen(true),
                    };
                  })()}
                />
                <MindsetRowExpandable
                  icon={<Wind className="w-4 h-4" />}
                  kicker="Focus"
                  color="teal"
                  body={brief.mindset.focus}
                  expanded={expandedMindset === "focus"}
                  onToggle={() => setExpandedMindset(expandedMindset === "focus" ? null : "focus")}
                  detail={{
                    intent: "A breath cue that activates your parasympathetic system — the body's calm signal.",
                    why: "Slower exhales tell your nervous system you're safe. Three rounds is enough to settle the heart rate before the open.",
                    action: "Do this before you check premarket prices, not after.",
                  }}
                />

                {/* Routine completion + streak */}
                <div className="pt-4 border-t border-slate-100">
                  <div className="flex items-center justify-between gap-3">
                    <button
                      onClick={toggleRoutineComplete}
                      className={`flex-1 px-4 py-2.5 rounded-xl text-[16px] font-semibold transition flex items-center justify-center gap-2 ${
                        routineDoneToday
                          ? "bg-emerald-500 text-white shadow-md"
                          : "bg-slate-100 text-slate-700 hover:bg-slate-200 active:bg-slate-300"
                      }`}
                    >
                      {routineDoneToday ? (
                        <><CheckSquare className="w-4 h-4" /> Routine done today</>
                      ) : (
                        <>Mark routine complete</>
                      )}
                    </button>
                    <div className="flex flex-col items-center px-3 py-1.5 rounded-xl bg-amber-50 border border-amber-100 min-w-[68px]">
                      <span className="text-lg font-bold text-amber-700 leading-none" style={{ fontFamily: SERIF }}>
                        {routineStreak}
                      </span>
                      <span className="text-[9px] tracking-wider uppercase text-amber-600 font-semibold mt-0.5">
                        {routineStreak === 1 ? "day" : "days"}
                      </span>
                    </div>
                  </div>
                  {routineStreak >= 3 && (
                    <p className="text-[13px] text-emerald-700 text-center mt-2 italic">
                      🔥 {routineStreak}-day streak. Keep showing up.
                    </p>
                  )}
                </div>

                {/* Daily Power Plate — high-protein dinner with grocery list & quick prep */}
                {brief.power_plate && (
                  <div className="pt-5 border-t border-slate-100">
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-[12px] uppercase tracking-[0.2em] text-amber-700 font-semibold flex items-center gap-1.5">
                        <Utensils className="w-3 h-3" /> Daily Power Plate
                      </p>
                      {brief.power_plate.style && (
                        <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200 font-semibold">
                          {brief.power_plate.style}
                        </span>
                      )}
                    </div>
                    <PowerPlateCard plate={brief.power_plate} />
                  </div>
                )}
              </div>
            </Card>
          )}

          {/* CLARITY — spiritual practices: contemplation, eastern wisdom, breath */}
          {visible.clarity_card && brief.clarity && (
            <Card theme={themes.clarity}>
              <CardHeader icon={<Flower2 className="w-4 h-4" />} label="Clarity" theme={themes.clarity} />
              <div className="px-5 pt-1 pb-5">
                <p className="text-[13px] uppercase tracking-[0.2em] text-violet-700/80 font-medium mb-5">
                  Contemplation · Wisdom · Breath
                </p>

                {/* Contemplation */}
                {brief.clarity.contemplation && (
                  <div className="mb-5">
                    <p className="text-[12px] uppercase tracking-[0.2em] text-violet-600 font-semibold mb-2 flex items-center gap-2">
                      <Sparkles className="w-3 h-3" /> Today's Contemplation
                    </p>
                    <p className="text-[16px] text-slate-800 leading-relaxed italic" style={{ fontFamily: SERIF }}>
                      {brief.clarity.contemplation}
                    </p>
                    <p className="text-[13px] text-slate-700 mt-2 leading-relaxed">
                      Sit with this for 60 seconds before market open. No phone.
                    </p>
                  </div>
                )}

                {/* Eastern wisdom quote */}
                {brief.clarity.eastern_wisdom && (
                  <div className="mb-5 pl-4 border-l-2 border-violet-300">
                    <p className="text-[12px] uppercase tracking-[0.2em] text-violet-600 font-semibold mb-2">
                      Eastern Wisdom
                    </p>
                    <p className="text-[16px] text-slate-800 leading-relaxed" style={{ fontFamily: SERIF }}>
                      "{brief.clarity.eastern_wisdom.quote || brief.clarity.eastern_wisdom}"
                    </p>
                    {brief.clarity.eastern_wisdom.source && (
                      <p className="text-[13px] text-violet-700 mt-2 font-medium">
                        — {brief.clarity.eastern_wisdom.source}
                      </p>
                    )}
                  </div>
                )}

                {/* Breath practice */}
                {brief.clarity.breath_practice && (
                  <div className="rounded-xl p-4 bg-gradient-to-br from-violet-50 to-purple-50 border border-violet-100">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center flex-shrink-0 shadow-sm">
                        <Activity className="w-4 h-4 text-violet-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] uppercase tracking-[0.2em] text-violet-700 font-semibold mb-1">
                          {brief.clarity.breath_practice.name || "Breath Practice"}
                        </p>
                        <p className="text-[16px] text-slate-800 font-semibold leading-snug mb-1" style={{ fontFamily: SERIF }}>
                          {brief.clarity.breath_practice.pattern || brief.clarity.breath_practice}
                        </p>
                        {brief.clarity.breath_practice.description && (
                          <p className="text-[15px] text-slate-700 leading-relaxed">
                            {brief.clarity.breath_practice.description}
                          </p>
                        )}
                        {brief.clarity.breath_practice.rounds && (
                          <p className="text-[13px] text-violet-700 font-semibold mt-1.5">
                            {brief.clarity.breath_practice.rounds}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </Card>
          )}


          {/* Today's Wisdom — black & gold hero, at bottom */}
          {visible.affirmation && brief.affirmation && (
            <div className="relative rounded-2xl p-8 text-center shadow-xl overflow-hidden"
              style={{
                background: "linear-gradient(160deg, #1E293B 0%, #0F172A 60%, #020617 100%)",
              }}>
              {/* Top gold accent line */}
              <div className="absolute top-0 left-0 right-0 h-[2px]"
                style={{ background: "linear-gradient(90deg, transparent 0%, #D4A574 30%, #F5D08C 50%, #D4A574 70%, transparent 100%)" }} />
              {/* Subtle radial glow */}
              <div className="absolute -top-20 left-1/2 -translate-x-1/2 w-72 h-72 rounded-full opacity-20"
                style={{ background: "radial-gradient(circle, #D4A574 0%, transparent 60%)" }} />

              <div className="relative z-10">
                <div className="w-12 h-12 rounded-full mx-auto mb-5 flex items-center justify-center"
                  style={{ background: "linear-gradient(135deg, #D4A574 0%, #F5D08C 100%)" }}>
                  <Sparkles className="w-5 h-5" style={{ color: "#1E293B" }} />
                </div>
                <p className="text-[12px] tracking-[0.35em] uppercase font-semibold mb-4"
                  style={{ color: "#D4A574" }}>
                  Today's Wisdom
                </p>
                <p className="text-2xl leading-relaxed italic px-2"
                  style={{ fontFamily: SERIF, fontWeight: 400, color: "#F8FAFC" }}>
                  "{brief.affirmation}"
                </p>
              </div>
            </div>
          )}

          <SignatureFooter verified={sigVerified} hash={sigHash} />
        </main>
      )}

      {/* Empty state — brand promise card only. Twin buttons moved up
          near the top so they're always visible. */}
      {!brief && !loading && (
        <div className="relative px-6 pb-16 space-y-4">
          <div className="rounded-3xl p-8 text-center bg-white shadow-md border border-slate-100" style={{ fontFamily: SERIF }}>
            <div className="w-12 h-12 rounded-2xl mx-auto mb-4 flex items-center justify-center shadow-md"
              style={{ background: "linear-gradient(135deg, #1e293b 0%, #0f172a 100%)" }}>
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <p className="text-2xl leading-snug text-slate-800 mb-2">Slow rhythm. <span className="italic">Sharp moves.</span></p>
            <p className="text-[16px] text-slate-700" style={{ fontFamily: SANS }}>
              Today's tape, smart-money flow, and your decision playbook — all in one calm read.
            </p>
          </div>
          <SignatureFooter verified={sigVerified} hash={sigHash} compact />
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
//                       Reusable Components
// ════════════════════════════════════════════════════════════════════


const WATER_PAINTING = "data:image/jpeg;base64,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";

function SmartMoneyRow({ item, onOpenSourceDetail, category }) {
  // Graceful fallback if item is still a string (older briefs)
  if (typeof item === "string") {
    return (
      <li className="text-[16px] flex gap-2 text-slate-700">
        <span className="text-amber-500 font-bold">·</span>
        <span>{item}</span>
      </li>
    );
  }
  const { text, ticker, why_matters } = item || {};

  const RowInner = (
    <>
      {ticker && (
        <span
          className="px-2.5 py-1 rounded-md text-[11px] font-bold tracking-wider bg-amber-100 text-amber-800 border-2 border-amber-300 flex-shrink-0 text-center shadow-sm"
          style={{ minWidth: "60px" }}
        >
          {ticker}
        </span>
      )}
      <span className="flex-1 text-slate-700 leading-snug">{text}</span>
      <ChevronRight className="w-3.5 h-3.5 flex-shrink-0 text-amber-500 mt-0.5" />
    </>
  );
  return (
    <li>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          if (onOpenSourceDetail) {
            onOpenSourceDetail({ category, text, ticker, why_matters });
          }
        }}
        className="w-full text-left text-[16px] flex items-start gap-2 px-2 py-1.5 -mx-2 rounded-lg hover:bg-amber-50 active:bg-amber-100 transition cursor-pointer"
      >
        {RowInner}
      </button>
    </li>
  );
}

// SectorHeatmapBar — shows a sector with a horizontal flow indicator
// direction: "buying" (green) | "selling" (red) | "neutral" (slate)
// intensity: 1-5 (controls bar width / saturation)
function SectorHeatmapBar({ sector, direction, intensity = 3 }) {
  const clamped = Math.max(1, Math.min(5, intensity));
  const widthPct = clamped * 18; // 18, 36, 54, 72, 90
  const palette = direction === "buying"
    ? { bar: "bg-emerald-500", track: "bg-emerald-50", label: "text-emerald-700", arrow: "▲" }
    : direction === "selling"
      ? { bar: "bg-rose-500", track: "bg-rose-50", label: "text-rose-700", arrow: "▼" }
      : { bar: "bg-slate-400", track: "bg-slate-100", label: "text-slate-700", arrow: "·" };
  return (
    <div className="flex items-center gap-2.5">
      <span className="text-[13px] text-slate-700 font-medium flex-shrink-0 w-[110px] truncate" title={sector}>
        {sector}
      </span>
      <div className={`flex-1 h-3 rounded-full ${palette.track} relative overflow-hidden border border-slate-100`}>
        <div
          className={`absolute inset-y-0 left-0 ${palette.bar} rounded-full transition-all`}
          style={{ width: `${widthPct}%`, opacity: 0.55 + (clamped * 0.09) }}
        />
      </div>
      <span className={`text-[12px] font-bold ${palette.label} flex-shrink-0 w-3 text-center`}>
        {palette.arrow}
      </span>
    </div>
  );
}

function TickerTape({ userHoldings = [], brief = null, accounts = [] }) {
  // Default movers — used when the user hasn't synced any holdings yet.
  // Each gets a sector tag so even the empty state has a story.
  const defaultMovers = [
    { symbol: "NVDA", change: +3.42, flow: "high", sector: "AI Infra" },
    { symbol: "TSLA", change: -4.18, flow: "dip", sector: "EV" },
    { symbol: "AAPL", change: +1.87, flow: "normal", sector: "Mega Cap" },
    { symbol: "META", change: +2.94, flow: "high", sector: "Mega Cap" },
    { symbol: "MSFT", change: -2.11, flow: "dip", sector: "Mega Cap" },
    { symbol: "GOOGL", change: +2.35, flow: "high", sector: "Mega Cap" },
    { symbol: "AMZN", change: -3.76, flow: "dip", sector: "Mega Cap" },
    { symbol: "AMD", change: +5.22, flow: "high", sector: "Semis" },
    { symbol: "IONQ", change: -7.88, flow: "dip", sector: "Quantum" },
    { symbol: "OKLO", change: +6.14, flow: "high", sector: "Nuclear" },
    { symbol: "PLTR", change: +4.05, flow: "high", sector: "AI" },
    { symbol: "COIN", change: -3.41, flow: "dip", sector: "Crypto" },
    { symbol: "MU", change: +3.89, flow: "high", sector: "Memory" },
    { symbol: "VRT", change: -2.67, flow: "dip", sector: "Data Ctr" },
    { symbol: "SMCI", change: +8.21, flow: "high", sector: "AI Infra" },
  ];

  // When user holdings exist, build a personalized stream from them.
  const items = (() => {
    if (!userHoldings || userHoldings.length === 0) return defaultMovers;

    const convictionByTicker = {};
    if (brief && Array.isArray(brief.conviction_watch)) {
      for (const c of brief.conviction_watch) {
        if (c && c.ticker) convictionByTicker[c.ticker] = c.signal;
      }
    }
    const accountById = {};
    for (const a of accounts || []) accountById[a.id] = a.name;

    const sorted = [...userHoldings]
      .filter((h) => h.symbol)
      .sort((a, b) => Math.abs(b.gainPct || 0) - Math.abs(a.gainPct || 0))
      .slice(0, 12);

    if (sorted.length === 0) return defaultMovers;

    return sorted.map((h) => ({
      symbol: h.symbol,
      // Pass null through (rather than substituting 0) so the renderer
      // knows to hide the percentage when we don't have real data.
      change: h.gainPct != null ? h.gainPct : null,
      flow: (h.gainPct || 0) > 5 ? "high" : (h.gainPct || 0) < -5 ? "dip" : "normal",
      shares: h.qty,
      accountLabel: h.accountId ? accountById[h.accountId] : null,
      signal: convictionByTicker[h.symbol] || null,
    }));
  })();

  // Live price overlay — fetch /api/prices for the symbols on screen and
  // overwrite change% with the real intraday number. Polls every 60s while
  // visible. If the endpoint fails, items keep whatever change they had.
  const symbolList = React.useMemo(
    () => Array.from(new Set(items.map((m) => m.symbol).filter(Boolean))).slice(0, 20),
    [items]
  );
  const [livePrices, setLivePrices] = React.useState({});
  React.useEffect(() => {
    if (symbolList.length === 0) return;
    let cancelled = false;
    let timer = null;
    const poll = async () => {
      try {
        const res = await fetch(`/api/prices?symbols=${symbolList.join(",")}`);
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = await res.json();
        if (!cancelled && data?.prices) {
          setLivePrices(data.prices);
        }
      } catch {
        // Silent — keep showing whatever we had. UI degrades gracefully.
      }
    };
    poll();
    timer = setInterval(() => {
      // Skip if the document is hidden (saves API calls when phone is locked
      // or app is backgrounded — Yahoo's chart endpoint isn't free forever).
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        poll();
      }
    }, 60_000);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [symbolList.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  // Merge live prices into items — overlay change% if we got a real value.
  const itemsWithLive = items.map((m) => {
    const live = livePrices[m.symbol];
    if (live && typeof live.changePct === "number" && !Number.isNaN(live.changePct)) {
      return {
        ...m,
        change: live.changePct,
        flow: live.changePct > 5 ? "high" : live.changePct < -5 ? "dip" : "normal",
      };
    }
    return m;
  });

  // Duplicate so the marquee loops seamlessly
  const stream = [...itemsWithLive, ...itemsWithLive];
  const isPersonalized = userHoldings && userHoldings.length > 0;

  return (
    <div
      className="relative -mt-2 mb-3 overflow-hidden shadow-md border-y"
      style={{
        borderColor: "rgba(245, 208, 140, 0.35)",
        // Cleaner gradient — premium navy without the muddy stone texture.
        // Brighter midtones so the ticker reads vibrant rather than dim.
        background: `linear-gradient(180deg, #1e3a5f 0%, #142b48 50%, #0c1f37 100%)`,
      }}
    >
      {/* Top crenellation line — gold accent */}
      <div
        className="absolute top-0 left-0 right-0 h-[2px]"
        style={{
          background:
            "linear-gradient(90deg, transparent 0%, #F5D08C 25%, #FFEAB6 50%, #F5D08C 75%, transparent 100%)",
        }}
      />

      <div className="flex items-stretch">
        {/* Compact ME monogram — matches the app icon, takes minimal space
            so the ticker has room to breathe. */}
        <div
          className="flex-shrink-0 flex items-center justify-center px-2.5 border-r border-amber-900/40"
          style={{
            background: "linear-gradient(135deg, rgba(245,208,140,0.18) 0%, rgba(212,165,116,0.08) 100%)",
          }}
        >
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              background: "linear-gradient(135deg, #F5D08C 0%, #D4A574 60%, #B88A4F 100%)",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.4), 0 1px 3px rgba(0,0,0,0.25)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span
              style={{
                fontFamily: "'Cormorant Garamond', Georgia, serif",
                fontSize: 14,
                fontWeight: 700,
                letterSpacing: "0.02em",
                color: "#3F2A12",
                lineHeight: 1,
              }}
            >
              ME
            </span>
          </div>
        </div>

        {/* Scrolling banner — tickers on the wall */}
        <div className="flex-1 overflow-hidden relative">
          <div
            className="flex items-center gap-5 py-2 whitespace-nowrap"
            style={{
              animation: "ticker-slide 60s linear infinite",
              width: "max-content",
            }}
          >
            {stream.map((m, i) => {
              const up = (Number(m.change) || 0) >= 0;
              const isHigh = m.flow === "high";
              const isDip = m.flow === "dip";
              return (
                <div key={i} className="flex flex-col gap-0.5 text-[13px] font-semibold py-0.5 px-0.5">
                  {/* Top row — symbol + change. Only show the percentage
                      when we have actual price data (non-zero). Showing
                      "+0.00%" when prices haven't been fetched is worse
                      than showing nothing — it implies stocks aren't
                      moving when really we just don't have the data yet. */}
                  <div className="flex items-center gap-1.5 leading-none">
                    {isHigh && <span className="text-emerald-300 text-[12px]">▲▲</span>}
                    {isDip && <span className="text-rose-300 text-[12px]">▼▼</span>}
                    <span className="text-white tracking-tight font-bold">
                      {m.symbol}
                    </span>
                    {m.shares != null && (
                      <span className="text-slate-300 text-[12px]">{m.shares}sh</span>
                    )}
                    {/* Only render the percentage if we have a real value.
                        m.change comes from h.gainPct on user holdings —
                        which is null/undefined until live prices are
                        fetched. Once the prices endpoint is wired up
                        with a Finnhub key, this will populate. */}
                    {m.change != null && Number(m.change) !== 0 && (
                      <span className={up ? "text-emerald-300 font-bold" : "text-rose-300 font-bold"}>
                        {up ? "+" : ""}
                        {Number(m.change).toFixed(2)}%
                      </span>
                    )}
                  </div>
                  {/* Bottom row — sector / signal / account label */}
                  <div className="flex items-center gap-1.5 leading-none text-[9px]">
                    {m.signal && (
                      <span
                        className={`px-1 py-0.5 rounded uppercase tracking-wider font-bold ${
                          m.signal === "add"
                            ? "bg-emerald-500/40 text-emerald-100"
                            : m.signal === "trim"
                            ? "bg-amber-500/40 text-amber-100"
                            : "bg-slate-500/40 text-slate-100"
                        }`}
                      >
                        {m.signal}
                      </span>
                    )}
                    {m.sector && (
                      <span className="text-slate-200 uppercase tracking-wider">
                        {m.sector}
                      </span>
                    )}
                    {m.accountLabel && (
                      <span className="text-amber-200 uppercase tracking-wider font-semibold">
                        · {m.accountLabel}
                      </span>
                    )}
                    {!m.signal && !m.sector && !m.accountLabel && (
                      <span className="text-slate-400 text-[8px] italic">
                        on watch
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes ticker-slide {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
      `}</style>
    </div>
  );
}

function MountainScene() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      <img src={WATER_PAINTING} alt=""
        className="w-full h-full"
        style={{ objectFit: "cover", objectPosition: "center", opacity: 0.55 }} />
      <div className="absolute inset-0" style={{
        background: "linear-gradient(180deg, rgba(255,255,255,0.35) 0%, rgba(255,255,255,0.15) 40%, rgba(255,255,255,0.05) 70%, rgba(255,255,255,0.25) 100%)",
      }} />
    </div>
  );
}

function FilterPill({ active, onClick, emoji, icon, label, accent }) {
  // accent = { bg, text, ring, dot } -- color tokens for active state and inactive dot indicator
  const a = accent || { bg: "bg-slate-900", text: "text-white", ring: "ring-slate-900", dot: "bg-slate-400" };
  return (
    <button
      onClick={onClick}
      className={`relative py-3.5 px-2 rounded-xl flex flex-col items-center gap-1.5 border transition-all duration-150 ${
        active
          ? `${a.bg} ${a.text} border-transparent shadow-md ring-2 ring-offset-1 ${a.ring}`
          : "bg-white border-slate-200 text-slate-700 hover:border-slate-300 hover:shadow-sm"
      }`}
    >
      {/* Color dot indicator when not active — tells the user this filter has a color identity */}
      {!active && accent && (
        <span className={`absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full ${a.dot}`} />
      )}
      {/* Icon (larger now) */}
      <span className={active ? "text-white" : ""}>
        {icon ? React.cloneElement(icon, { className: "w-5 h-5" }) : <span className="text-lg">{emoji}</span>}
      </span>
      <span className="text-[12px] font-bold uppercase tracking-[0.12em]">{label}</span>
    </button>
  );
}

function PremiumModal({ onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl relative">
        <button onClick={onClose} className="absolute top-4 right-4 text-slate-700 hover:text-slate-900">
          <X className="w-5 h-5" />
        </button>
        <div className="w-12 h-12 rounded-xl mb-4 flex items-center justify-center shadow-md bg-gradient-to-br from-amber-500 to-orange-500">
          <Crown className="w-6 h-6 text-white" />
        </div>
        <h3 className="text-2xl mb-1 text-slate-900" style={{ fontFamily: SERIF, fontWeight: 600 }}>
          Morning Edge <span className="italic">Premium</span>
        </h3>
        <p className="text-[16px] text-slate-700 mb-5">Your edge, multiplied.</p>
        <ul className="space-y-3 mb-6">
          {[
            ["Real-time data", "Live pre-market, options flow, Congress disclosures"],
            ["Push alerts", "Wake up to your brief"],
            ["Multiple watchlists", "IRA, taxable, trades — separated"],
            ["Custom themes", "Your colors, your vibe"],
            ["Ad-free forever", "Just you and the tape"],
          ].map(([title, desc]) => (
            <li key={title} className="flex gap-3">
              <div className="flex-shrink-0 w-6 h-6 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center mt-0.5">
                <Crown className="w-3 h-3 text-white" />
              </div>
              <div>
                <p className="text-[16px] font-semibold text-slate-900">{title}</p>
                <p className="text-[13px] text-slate-700">{desc}</p>
              </div>
            </li>
          ))}
        </ul>
        <button className="w-full py-3.5 rounded-xl font-semibold text-white shadow-lg flex items-center justify-center gap-2 bg-gradient-to-r from-amber-500 to-orange-500">
          <Lock className="w-4 h-4" /> Join the waitlist
        </button>
        <p className="text-[12px] text-slate-700 text-center mt-3">Coming soon.</p>
      </div>
    </div>
  );
}

function Card({ children, theme }) {
  return (
    <div className="bg-white rounded-2xl shadow-md border border-slate-100 overflow-hidden">
      <div className={`h-1 bg-gradient-to-r ${theme.bar}`} />
      {children}
    </div>
  );
}

function CardHeader({ icon, label, theme }) {
  return (
    <div className={`flex items-center gap-3 px-5 py-4 border-b border-slate-100 bg-gradient-to-r ${theme.tint}`}>
      <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${theme.gradient} flex items-center justify-center text-white shadow-sm`}>
        {icon}
      </div>
      <h2 className="text-[13px] uppercase tracking-[0.22em] text-slate-800 font-bold">{label}</h2>
    </div>
  );
}

function MindsetRow({ icon, kicker, body, color }) {
  const colorMap = {
    rose: "bg-rose-100 text-rose-600",
    amber: "bg-amber-100 text-amber-700",
    teal: "bg-teal-100 text-teal-700",
  };
  return (
    <div className="flex gap-3">
      <div className={`flex-shrink-0 w-9 h-9 rounded-full ${colorMap[color]} flex items-center justify-center`}>
        {icon}
      </div>
      <div className="flex-1 pt-0.5">
        <p className="text-[12px] uppercase tracking-[0.2em] text-slate-700 font-semibold mb-1">{kicker}</p>
        <p className="text-[16px] leading-relaxed text-slate-800" style={{ fontFamily: SERIF }}>{body}</p>
      </div>
    </div>
  );
}

function MindsetRowExpandable({ icon, kicker, body, color, expanded, onToggle, detail }) {
  const colorMap = {
    rose: { dot: "bg-rose-100 text-rose-600", panel: "bg-rose-50 border-rose-100" },
    amber: { dot: "bg-amber-100 text-amber-700", panel: "bg-amber-50 border-amber-100" },
    teal: { dot: "bg-teal-100 text-teal-700", panel: "bg-teal-50 border-teal-100" },
  };
  const c = colorMap[color] || colorMap.rose;
  return (
    <div>
      <button
        onClick={onToggle}
        className="w-full flex gap-3 items-start text-left p-2 -mx-2 rounded-xl hover:bg-slate-50 active:bg-slate-100 transition"
      >
        <div className={`flex-shrink-0 w-9 h-9 rounded-full ${c.dot} flex items-center justify-center`}>
          {icon}
        </div>
        <div className="flex-1 pt-0.5 min-w-0">
          <p className="text-[12px] uppercase tracking-[0.2em] text-slate-700 font-semibold mb-1 flex items-center gap-2">
            {kicker}
            <span className="text-slate-300 text-base leading-none">{expanded ? "−" : "+"}</span>
          </p>
          <p className="text-[16px] leading-relaxed text-slate-800" style={{ fontFamily: SERIF }}>{body}</p>
        </div>
      </button>

      {expanded && (
        <div className={`mt-2 ml-12 mr-2 p-4 rounded-xl border ${c.panel}`}>
          {detail.intent && (
            <p className="text-[15px] text-slate-700 leading-relaxed mb-3 italic" style={{ fontFamily: SERIF }}>
              {detail.intent}
            </p>
          )}
          {detail.why && (
            <p className="text-[15px] text-slate-700 leading-relaxed mb-3">
              {detail.why}
            </p>
          )}
          {detail.segments && (
            <div className="space-y-2 mb-3">
              {detail.segments.map((seg, i) => (
                <div key={i} className="flex items-center gap-3 text-[15px]">
                  <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-white border border-slate-200 flex items-center justify-center">
                    <WorkoutSchematic kicker={seg.kicker} color="#0F766E" size={32} />
                  </div>
                  <span className="flex-shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider bg-white text-slate-700 border border-slate-200">
                    {Math.round(seg.durationSec / 60)}m
                  </span>
                  <span className="text-slate-700">
                    <span className="font-semibold">{seg.kicker}</span> · {seg.title}
                  </span>
                </div>
              ))}
            </div>
          )}
          {detail.fuelBlocks && Array.isArray(detail.fuelBlocks) && (
            <div className="space-y-2.5 mb-3">
              {detail.fuelBlocks.map((block, i) => {
                // Map block name to a lucide icon + color theme. Real library icons,
                // not generated SVG drawings, so they look clean and professional.
                const name = (block.name || "").toLowerCase();
                let BlockIcon = Activity;
                let accent = { bg: "#f0f9ff", border: "#bae6fd", iconBg: "linear-gradient(135deg, #0ea5e9, #0284c7)", labelColor: "#0c4a6e" };
                if (name.includes("mobil")) {
                  BlockIcon = Move;
                  accent = { bg: "#ecfeff", border: "#a5f3fc", iconBg: "linear-gradient(135deg, #06b6d4, #0891b2)", labelColor: "#155e75" };
                } else if (name.includes("breath")) {
                  BlockIcon = Wind;
                  accent = { bg: "#f0fdfa", border: "#99f6e4", iconBg: "linear-gradient(135deg, #14b8a6, #0d9488)", labelColor: "#115e59" };
                } else if (name.includes("strength") || name.includes("power") || name.includes("core")) {
                  BlockIcon = Dumbbell;
                  accent = { bg: "#fef2f2", border: "#fecaca", iconBg: "linear-gradient(135deg, #ef4444, #dc2626)", labelColor: "#991b1b" };
                } else if (name.includes("cool") || name.includes("stretch") || name.includes("recover")) {
                  BlockIcon = Snowflake;
                  accent = { bg: "#eef2ff", border: "#c7d2fe", iconBg: "linear-gradient(135deg, #6366f1, #4f46e5)", labelColor: "#3730a3" };
                } else if (name.includes("focus") || name.includes("mind")) {
                  BlockIcon = Sparkles;
                  accent = { bg: "#faf5ff", border: "#e9d5ff", iconBg: "linear-gradient(135deg, #a855f7, #9333ea)", labelColor: "#6b21a8" };
                }
                return (
                  <div
                    key={i}
                    className="rounded-lg border overflow-hidden"
                    style={{ background: accent.bg, borderColor: accent.border }}
                  >
                    {/* Header strip with icon + name */}
                    <div className="flex items-center gap-2 px-2.5 py-2 border-b" style={{ borderColor: accent.border }}>
                      <div
                        className="flex-shrink-0 flex items-center justify-center"
                        style={{ width: 28, height: 28, borderRadius: 8, background: accent.iconBg, boxShadow: "0 1px 3px rgba(0,0,0,0.15)" }}
                      >
                        <BlockIcon className="w-4 h-4 text-white" strokeWidth={2.4} />
                      </div>
                      <p className="text-[12px] uppercase tracking-[0.16em] font-bold m-0" style={{ color: accent.labelColor }}>
                        {block.name}
                      </p>
                    </div>
                    {/* Moves list */}
                    <div className="px-2.5 py-2">
                      {Array.isArray(block.moves) && block.moves.length > 0 && (
                        <ul className="space-y-1.5 mb-1.5">
                          {block.moves.map((m, j) => (
                            <li key={j} className="text-[13.5px] text-slate-800 leading-snug flex gap-2">
                              <span className="flex-shrink-0 mt-1.5 w-1.5 h-1.5 rounded-full" style={{ background: accent.labelColor }} />
                              <span>{m}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {block.why && (
                        <p className="text-[12px] text-slate-600 italic leading-snug mt-1.5">
                          {block.why}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {detail.tip && (
            <div className="rounded-lg bg-amber-100/60 border border-amber-200 px-3 py-2 mb-3">
              <p className="text-[10px] uppercase tracking-wider font-bold text-amber-800 mb-0.5">Pro tip</p>
              <p className="text-[13px] text-amber-900 leading-relaxed m-0">{detail.tip}</p>
            </div>
          )}
          {detail.action && (
            <p className="text-[13px] text-slate-700 leading-relaxed">
              → {detail.action}
            </p>
          )}
          {detail.showStartButton && (
            <button
              onClick={detail.onStart}
              className="mt-3 w-full px-4 py-2.5 rounded-lg bg-slate-900 text-white text-[16px] font-semibold hover:bg-slate-800 active:bg-slate-700 transition flex items-center justify-center gap-2"
            >
              <Play className="w-4 h-4" /> Start guided routine
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function RoutineFlow({ routine, onClose, onComplete }) {
  const [segIdx, setSegIdx] = React.useState(0);
  const [secondsLeft, setSecondsLeft] = React.useState(routine.segments[0].durationSec);
  const [running, setRunning] = React.useState(false);

  const segment = routine.segments[segIdx];
  const isLast = segIdx === routine.segments.length - 1;

  // Reset timer when segment changes
  React.useEffect(() => {
    setSecondsLeft(routine.segments[segIdx].durationSec);
    setRunning(false);
  }, [segIdx, routine]);

  // Tick when running
  React.useEffect(() => {
    if (!running) return;
    if (secondsLeft <= 0) return;
    const t = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [running, secondsLeft]);

  // When timer hits zero, gentle audio cue + auto-advance
  React.useEffect(() => {
    if (running && secondsLeft === 0) {
      // Soft beep using Web Audio API (no asset needed)
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = 660;
        g.gain.value = 0.15;
        o.connect(g);
        g.connect(ctx.destination);
        o.start();
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
        o.stop(ctx.currentTime + 0.4);
      } catch {}
      setRunning(false);
    }
  }, [running, secondsLeft]);

  const next = () => {
    if (isLast) {
      onComplete();
    } else {
      setSegIdx(segIdx + 1);
    }
  };
  const back = () => {
    if (segIdx > 0) setSegIdx(segIdx - 1);
  };

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;
  const totalSec = segment.durationSec;
  const progress = ((totalSec - secondsLeft) / totalSec) * 100;

  // Segment colors
  const segColors = ["#0E7490", "#7C3AED", "#DC2626", "#059669"];
  const segColor = segColors[segIdx % segColors.length];

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-sm flex items-stretch justify-center p-0 sm:p-4">
      <div className="w-full max-w-md bg-white sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 flex items-center justify-between border-b border-slate-100">
          <div>
            <p className="text-[12px] tracking-[0.2em] uppercase font-semibold text-slate-700">
              {routine.name} · Step {segIdx + 1} of {routine.segments.length}
            </p>
            <p className="text-base font-bold text-slate-900 mt-0.5">{segment.kicker}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-100" aria-label="Close">
            <X className="w-5 h-5 text-slate-700" />
          </button>
        </div>

        {/* Progress dots */}
        <div className="px-5 py-3 flex gap-1.5">
          {routine.segments.map((_, i) => (
            <div key={i} className="flex-1 h-1 rounded-full overflow-hidden bg-slate-100">
              <div
                className="h-full transition-all"
                style={{
                  width: i < segIdx ? "100%" : i === segIdx ? `${progress}%` : "0%",
                  backgroundColor: segColors[i % segColors.length],
                }}
              />
            </div>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          <p className="text-[12px] tracking-[0.25em] uppercase font-semibold mb-1" style={{ color: segColor }}>
            {segment.kicker}
          </p>
          <h2 className="text-3xl text-slate-900 mb-4" style={{ fontFamily: SERIF, fontWeight: 500 }}>
            {segment.title}
          </h2>

          {/* Visual schematic for this segment */}
          <div className="flex items-center justify-center my-4">
            <div className="w-32 h-32 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-center">
              <WorkoutSchematic kicker={segment.kicker} color={segColor} size={104} />
            </div>
          </div>

          {/* Breath rhythm visualizer for breathwork segments */}
          {segment.kicker.toLowerCase().includes("breath") && (() => {
            // Try to extract a rhythm pattern from the first exercise's name (e.g., "4-4-4-4", "4-7-8")
            const ex = segment.exercises[0];
            const match = ex && ex.name && ex.name.match(/(\d+)[\s\-·]+(\d+)(?:[\s\-·]+(\d+))?(?:[\s\-·]+(\d+))?/);
            if (!match) return null;
            const pattern = match.slice(1).filter(Boolean).join("-");
            return <BreathRhythm pattern={pattern} color={segColor} />;
          })()}

          {/* Big timer */}
          <div className="text-center my-6">
            <p className="text-7xl font-light tabular-nums text-slate-900" style={{ fontFamily: SERIF }}>
              {String(minutes).padStart(1, "0")}:{String(seconds).padStart(2, "0")}
            </p>
            <button
              onClick={() => setRunning(!running)}
              className="mt-4 px-5 py-2.5 rounded-full text-[16px] font-semibold transition shadow-md"
              style={{
                backgroundColor: running ? "#F1F5F9" : segColor,
                color: running ? "#0F172A" : "#fff",
              }}
            >
              {running ? "Pause" : secondsLeft === segment.durationSec ? "Start" : "Resume"}
            </button>
          </div>

          {/* Exercise list */}
          <div className="mt-8 space-y-3">
            {segment.exercises.map((ex, i) => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100">
                <span className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[13px] font-bold text-white"
                  style={{ backgroundColor: segColor }}>
                  {i + 1}
                </span>
                <div className="flex-1">
                  <p className="text-[16px] font-semibold text-slate-900">{ex.name}</p>
                  <p className="text-[15px] text-slate-700 mt-0.5">{ex.cue}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer nav */}
        <div className="px-5 py-4 border-t border-slate-100 flex items-center gap-3">
          <button
            onClick={back}
            disabled={segIdx === 0}
            className={`px-4 py-2.5 rounded-xl text-[16px] font-semibold transition ${
              segIdx === 0 ? "text-slate-300" : "text-slate-700 hover:bg-slate-100 active:bg-slate-200"
            }`}
          >
            Back
          </button>
          <button
            onClick={next}
            className="flex-1 px-4 py-2.5 rounded-xl text-[16px] font-semibold text-white transition shadow-md"
            style={{ backgroundColor: segColor }}
          >
            {isLast ? "Complete routine" : "Next segment →"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Workout schematics — minimalist SVG illustrations for each segment
// kicker (Mobility, Breathwork, Strength, Stretch), plus a breath
// rhythm visualizer for breathwork patterns.
// ────────────────────────────────────────────────────────────────────
function WorkoutSchematic({ kicker, color = "#0E7490", size = 88 }) {
  // Motivational gradient icon badge — replaces the old stick figures.
  // Each segment kicker maps to a clean Lucide icon set inside a circular
  // gradient background with a subtle inner highlight and outer glow.
  // The visual goal: feel premium and inviting, not clinical or cartoonish,
  // so the user actually wants to tap "Start" on the routine.
  const k = (kicker || "").toLowerCase();

  let Icon = Activity;
  let from = "#06B6D4";
  let to = "#0E7490";
  let label = "Move";

  if (k.includes("loosen") || k.includes("mobil") || k.includes("warm")) {
    Icon = Activity;
    from = "#22D3EE"; to = "#0E7490"; label = "Loosen up";
  } else if (k.includes("breath") || k.includes("breathe")) {
    Icon = Wind;
    from = "#A78BFA"; to = "#6D28D9"; label = "Breathe";
  } else if (k.includes("steady") || k.includes("strength") || k.includes("strong") || k.includes("lift")) {
    Icon = Dumbbell;
    from = "#FB923C"; to = "#C2410C"; label = "Steady";
  } else if (k.includes("stretch") || k.includes("cool") || k.includes("release") || k.includes("decompress")) {
    Icon = Move;
    from = "#34D399"; to = "#047857"; label = "Stretch";
  } else if (k.includes("flow") || k.includes("restorative") || k.includes("calm") || k.includes("long")) {
    Icon = Flower2;
    from = "#F0ABFC"; to = "#A21CAF"; label = "Flow";
  } else {
    Icon = Sparkles;
    from = "#94A3B8"; to = "#475569"; label = "Move";
  }

  // Smaller versions hide the inner highlight to stay crisp at thumbnail size
  const showHighlight = size >= 64;
  const iconSize = Math.round(size * 0.45);
  const haloSize = Math.round(size * 0.55);

  return (
    <div
      role="img"
      aria-label={`${label} illustration`}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: `linear-gradient(135deg, ${from} 0%, ${to} 100%)`,
        boxShadow: `0 ${Math.max(4, size * 0.08)}px ${Math.max(12, size * 0.18)}px -6px ${to}55, inset 0 1px 0 rgba(255,255,255,0.25)`,
        position: "relative",
        overflow: "hidden",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      {showHighlight && (
        <span
          style={{
            position: "absolute",
            top: -size * 0.15,
            left: -size * 0.05,
            width: haloSize,
            height: haloSize,
            borderRadius: "50%",
            background: "rgba(255,255,255,0.32)",
            filter: "blur(8px)",
            pointerEvents: "none",
          }}
        />
      )}
      <Icon
        size={iconSize}
        color="white"
        strokeWidth={2.2}
        style={{ position: "relative", zIndex: 1, filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.15))" }}
      />
    </div>
  );
}

// Breath rhythm visualizer — animated horizontal bars showing inhale/hold/exhale phases
function BreathRhythm({ pattern = "4-4-4-4", color = "#7C3AED" }) {
  // Parse "4-7-8" or "4-4-4-4" into segments. Treat each number as relative duration.
  const parts = pattern.split(/[-·\s]+/).map((p) => parseInt(p, 10)).filter((n) => !isNaN(n) && n > 0);
  if (!parts.length) return null;
  const labels = parts.length === 4
    ? ["IN", "HOLD", "OUT", "HOLD"]
    : parts.length === 3
      ? ["IN", "HOLD", "OUT"]
      : parts.length === 2
        ? ["IN", "OUT"]
        : parts.map((_, i) => `${i + 1}`);
  const total = parts.reduce((a, b) => a + b, 0);
  return (
    <div className="mt-3">
      <div className="flex w-full h-6 rounded-full overflow-hidden bg-slate-100 border border-slate-200">
        {parts.map((p, i) => (
          <div
            key={i}
            className="flex items-center justify-center text-[9px] font-bold tracking-wider text-white relative"
            style={{
              width: `${(p / total) * 100}%`,
              backgroundColor: i % 2 === 0 ? color : `${color}88`,
            }}
          >
            {labels[i]}
          </div>
        ))}
      </div>
      <div className="flex w-full mt-1 px-0.5">
        {parts.map((p, i) => (
          <div key={i} className="text-[12px] text-center text-slate-700 font-semibold tabular-nums" style={{ width: `${(p / total) * 100}%` }}>
            {p}s
          </div>
        ))}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Playbook action card grid + detail modal.
// Replaces the long checkbox list with a 2-up grid of colorful tappable
// cards. Each card maps to one decision from the brief. Action types
// (TRIM/ADD/WATCH/PROTECT) drive the color scheme. Tapping a card opens
// a full-screen detail modal with the longer reasoning, account context,
// and three actions: Mark done, Dismiss, Open broker.
// ────────────────────────────────────────────────────────────────────

const ACTION_ICON_MAP = {
  trim:    ArrowDownRight,
  add:     Plus,
  watch:   Eye,
  protect: ShieldCheck,
  act:     CheckSquare,
};

// Tappable level row for Market Pulse "What's moving" bullets and similar
// list items elsewhere. Shows the headline by default; tap toggles a brief
// inline expansion that reveals additional context if available, or a
// generic explanatory fallback if the model didn't provide more depth.
function ExpandableLevelRow({ index, text, theme, detail = null }) {
  const [open, setOpen] = React.useState(false);
  // If no detail provided, generate a short contextual explanation from the
  // text itself — so the user always gets *something* on tap rather than
  // an empty expansion. The model's own brief writing is preferred when
  // available; this is a graceful fallback.
  const expansion = detail || autoExpand(text);

  return (
    <button
      onClick={() => setOpen((o) => !o)}
      className="text-left transition-all"
      style={{
        background: open ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.6)",
        border: `1px solid ${theme.heroBorder}`,
        borderRadius: 12,
        padding: "10px 12px",
        backdropFilter: "blur(4px)",
        cursor: "pointer",
      }}
    >
      <div className="flex items-start gap-3">
        <span
          className="flex-shrink-0 inline-flex items-center justify-center text-[12px] font-bold"
          style={{
            width: 24,
            height: 24,
            borderRadius: 8,
            background: theme.bulletDot,
            color: "white",
            boxShadow: `0 2px 6px ${theme.badge}`,
          }}
        >
          {index}
        </span>
        <span
          className="flex-1 text-[15px] leading-snug pt-0.5"
          style={{ color: "#0f172a", fontFamily: SERIF, fontWeight: 500 }}
        >
          {colorizePercents(text)}
        </span>
        <ChevronRight
          className="w-4 h-4 flex-shrink-0 mt-1"
          style={{
            color: theme.accent,
            transform: open ? "rotate(90deg)" : "none",
            transition: "transform 0.2s ease",
          }}
          strokeWidth={2.5}
        />
      </div>
      {open && (
        <div
          className="mt-2 pl-9 pr-1 pt-2 border-t text-[13px] leading-relaxed"
          style={{ borderColor: theme.heroBorder, color: "#334155", fontFamily: SERIF }}
        >
          {expansion}
        </div>
      )}
    </button>
  );
}

// Generic context-builder used by ExpandableLevelRow when the model didn't
// supply explicit detail. Keeps the UX from being empty when the user taps
// a row. Pattern-matches on common market terms to add a one-line "why
// this matters" framing without inventing facts.
function autoExpand(text) {
  if (!text) return "Tap again to collapse.";
  const t = text.toLowerCase();
  // Pull simple cues from the line and add a brief framing
  if (/vix|volatility/.test(t))
    return text + " — Volatility moves like this often signal hedging activity ahead of binary events. Watch for confirmation in put/call ratios.";
  if (/futures/.test(t))
    return text + " — Premarket futures direction sets the early tone but often reverses by midday. Wait for the first 30 minutes before chasing.";
  if (/yields|treasury|fed/.test(t))
    return text + " — Rate-sensitive sectors (homebuilders, regional banks, REITs) tend to move first. Growth/tech is second-order.";
  if (/oil|crude|wti|brent/.test(t))
    return text + " — Energy moves often lead inflation expectations by 3-6 weeks. Track XLE relative strength against SPY.";
  if (/dxy|dollar/.test(t))
    return text + " — A stronger dollar pressures multinational earnings. Tech earnings exposure is highest among megacaps.";
  if (/gold|gld|silver/.test(t))
    return text + " — Precious metals flows often signal real-rate expectations rather than inflation alone.";
  if (/semis|semiconductors|chip/.test(t))
    return text + " — Semis remain the bellwether for AI capex cycles. Watch SOX/SMH for sector breadth.";
  if (/earnings/.test(t))
    return text + " — Reactions tend to be larger when guidance surprises diverge from EPS surprises. Trust the guide.";
  // Generic fallback
  return text + " — Tap again to collapse.";
}

// ────────────────────────────────────────────────────────────────────
// DiscoverySection — combined Opportunity Watch + Radar in one card
// with a 2-tab toggle. Opportunity is portfolio-aware (buy ideas that
// fill thematic gaps in user's holdings); Radar is general thematic
// discovery. Both use the same scannable tile layout — tap any tile
// for the full reasoning + sources + ask-about-this chat.
// ────────────────────────────────────────────────────────────────────
// Discovery jewel-tone palettes — split by column so the two columns
// read as visually distinct families.
//   NEW BUYS  → COOL jewels (cyan, teal, emerald, sky, indigo, blue, sapphire)
//   WATCHING  → WARM jewels (violet, purple, fuchsia, pink, rose, magenta, plum, coral)
// No yellow / amber / orange — those belong to the Insider Flow family.
const DISCOVERY_COOL = [
  { iconBg: "from-cyan-400 to-cyan-600",       rowBg: "bg-cyan-50",     border: "border-cyan-200",     stripe: "bg-cyan-500",     ticker: "text-cyan-900",     theme: "text-cyan-700" },
  { iconBg: "from-teal-400 to-teal-600",       rowBg: "bg-teal-50",     border: "border-teal-200",     stripe: "bg-teal-500",     ticker: "text-teal-900",     theme: "text-teal-700" },
  { iconBg: "from-emerald-400 to-emerald-600", rowBg: "bg-emerald-50",  border: "border-emerald-200",  stripe: "bg-emerald-500",  ticker: "text-emerald-900",  theme: "text-emerald-700" },
  { iconBg: "from-sky-400 to-sky-600",         rowBg: "bg-sky-50",      border: "border-sky-200",      stripe: "bg-sky-500",      ticker: "text-sky-900",      theme: "text-sky-700" },
  { iconBg: "from-indigo-400 to-indigo-600",   rowBg: "bg-indigo-50",   border: "border-indigo-200",   stripe: "bg-indigo-500",   ticker: "text-indigo-900",   theme: "text-indigo-700" },
  { iconBg: "from-blue-400 to-blue-600",       rowBg: "bg-blue-50",     border: "border-blue-200",     stripe: "bg-blue-500",     ticker: "text-blue-900",     theme: "text-blue-700" },
  { iconBg: "from-blue-500 to-indigo-700",     rowBg: "bg-slate-50",    border: "border-blue-300",     stripe: "bg-blue-700",     ticker: "text-blue-950",     theme: "text-blue-800" },
];
const DISCOVERY_WARM = [
  { iconBg: "from-violet-400 to-violet-600",   rowBg: "bg-violet-50",   border: "border-violet-200",   stripe: "bg-violet-500",   ticker: "text-violet-900",   theme: "text-violet-700" },
  { iconBg: "from-purple-400 to-purple-600",   rowBg: "bg-purple-50",   border: "border-purple-200",   stripe: "bg-purple-500",   ticker: "text-purple-900",   theme: "text-purple-700" },
  { iconBg: "from-fuchsia-400 to-fuchsia-600", rowBg: "bg-fuchsia-50",  border: "border-fuchsia-200",  stripe: "bg-fuchsia-500",  ticker: "text-fuchsia-900",  theme: "text-fuchsia-700" },
  { iconBg: "from-pink-400 to-pink-600",       rowBg: "bg-pink-50",     border: "border-pink-200",     stripe: "bg-pink-500",     ticker: "text-pink-900",     theme: "text-pink-700" },
  { iconBg: "from-rose-400 to-rose-600",       rowBg: "bg-rose-50",     border: "border-rose-200",     stripe: "bg-rose-500",     ticker: "text-rose-900",     theme: "text-rose-700" },
  { iconBg: "from-pink-500 to-fuchsia-700",    rowBg: "bg-pink-50",     border: "border-pink-300",     stripe: "bg-fuchsia-600",  ticker: "text-fuchsia-950",  theme: "text-fuchsia-800" },
  { iconBg: "from-purple-500 to-violet-800",   rowBg: "bg-purple-50",   border: "border-purple-300",   stripe: "bg-purple-700",   ticker: "text-purple-950",   theme: "text-purple-800" },
  { iconBg: "from-rose-400 to-pink-600",       rowBg: "bg-rose-50",     border: "border-rose-300",     stripe: "bg-rose-600",     ticker: "text-rose-950",     theme: "text-rose-800" },
];

function DiscoverySection({ radar, opportunity, defaultTab, holdings, todayKey, onOpenReading }) {
  const hasOpportunity = Array.isArray(opportunity) && opportunity.length > 0;
  const hasRadar = Array.isArray(radar) && radar.length > 0;

  // Compact row card used in both columns
  const renderRow = (item, i, palettes, type) => {
    const p = palettes[i % palettes.length];
    const reading = type === "opportunity"
      ? {
          id: `opportunity-${item.ticker || i}-${todayKey}`,
          type: "opportunity",
          ticker: item.ticker,
          theme: item.theme,
          fits_gap: item.fits_gap,
          headline: item.headline,
          deep_reasoning: item.deep_reasoning,
          chatDescription: `${item.ticker}${item.theme ? ` (${item.theme})` : ""}: ${item.headline}${item.fits_gap ? `. Fits gap: ${item.fits_gap}` : ""}${item.deep_reasoning ? ` Full reasoning: ${item.deep_reasoning}` : ""}`,
        }
      : {
          id: `radar-${item.ticker || i}-${todayKey}`,
          type: "radar",
          ticker: item.ticker,
          theme: item.theme,
          headline: item.headline,
          why_now: item.why_now,
          deep_reasoning: item.deep_reasoning,
          chatDescription: `${item.ticker}${item.theme ? ` (${item.theme})` : ""}: ${item.headline}${item.why_now ? `. ${item.why_now}` : ""}${item.deep_reasoning ? ` Full reasoning: ${item.deep_reasoning}` : ""}`,
        };
    return (
      <button
        key={i}
        onClick={() => onOpenReading(reading)}
        className={`text-left rounded-lg ${p.rowBg} border ${p.border} hover:shadow-md active:scale-[0.98] transition-all overflow-hidden flex items-stretch`}
      >
        <div className={`w-1 ${p.stripe}`} />
        <div className="flex items-center gap-2 px-2 py-2 flex-1 min-w-0">
          <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${p.iconBg} flex items-center justify-center shadow-sm flex-shrink-0`}>
            <Sparkles className="w-4 h-4 text-white" strokeWidth={2.5} />
          </div>
          <div className="min-w-0 flex-1">
            <p className={`text-[14px] font-bold leading-tight ${p.ticker}`} style={{ fontFamily: SERIF }}>
              {item.ticker}
            </p>
            {item.theme && (
              <p className={`text-[10px] font-semibold tracking-wide leading-tight truncate ${p.theme}`}>
                {item.theme}
              </p>
            )}
            <p className="text-[11px] text-slate-700 mt-0.5 leading-tight truncate">
              {item.fits_gap || item.headline || item.why_now || "Tap for reasoning"}
            </p>
          </div>
        </div>
      </button>
    );
  };

  return (
    <div>
      <p className="text-[12px] text-slate-700 italic mb-3 px-1">
        High-conviction names outside your portfolio, plus catalyst setups on watch. Tap any row for the full thesis.
      </p>

      {/* Two-column header: NEW BUYS + WATCHING */}
      <div className="grid grid-cols-2 gap-2 mb-2">
        <div className="rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 px-2.5 py-2 shadow-sm">
          <div className="flex items-center gap-1.5">
            <Sparkles className="w-3 h-3 text-white" strokeWidth={2.5} />
            <p className="text-[10px] font-bold tracking-wider text-white">NEW BUYS</p>
            {hasOpportunity && (
              <span className="ml-auto text-[9px] font-bold text-emerald-700 bg-white px-1.5 py-0.5 rounded-full">
                {opportunity.length}
              </span>
            )}
          </div>
          <p className="text-[9.5px] mt-0.5 leading-tight text-white/90">High conviction · not held</p>
        </div>
        <div className="rounded-xl bg-gradient-to-br from-fuchsia-500 to-purple-600 px-2.5 py-2 shadow-sm">
          <div className="flex items-center gap-1.5">
            <Telescope className="w-3 h-3 text-white" strokeWidth={2.5} />
            <p className="text-[10px] font-bold tracking-wider text-white">WATCHING</p>
            {hasRadar && (
              <span className="ml-auto text-[9px] font-bold text-fuchsia-700 bg-white px-1.5 py-0.5 rounded-full">
                {radar.length}
              </span>
            )}
          </div>
          <p className="text-[9.5px] mt-0.5 leading-tight text-white/90">Setting up · catalyst ahead</p>
        </div>
      </div>

      {/* Two-column row grid */}
      <div className="grid grid-cols-2 gap-2">
        {/* LEFT — NEW BUYS (cool jewels) */}
        <div className="flex flex-col gap-1.5">
          {hasOpportunity ? (
            opportunity
              .filter((o) => o && typeof o === "object")
              .map((o, i) => renderRow(o, i, DISCOVERY_COOL, "opportunity"))
          ) : (
            <div className="rounded-lg bg-emerald-50/60 border border-emerald-200 p-3">
              <p className="text-[11px] text-emerald-900 leading-relaxed m-0">
                No high-conviction buys today. Quality over quantity.
              </p>
            </div>
          )}
        </div>
        {/* RIGHT — WATCHING (warm jewels) */}
        <div className="flex flex-col gap-1.5">
          {hasRadar ? (
            radar
              .filter((r) => r && typeof r === "object")
              .map((r, i) => renderRow(r, i, DISCOVERY_WARM, "radar"))
          ) : (
            <div className="rounded-lg bg-fuchsia-50/60 border border-fuchsia-200 p-3">
              <p className="text-[11px] text-fuchsia-900 leading-relaxed m-0">
                Markets quiet on your themes today.
              </p>
            </div>
          )}
        </div>
      </div>

      <p className="mt-3 text-[11px] text-slate-700 leading-relaxed italic px-1">
        Picks chosen to fit your existing themes and fill diversification gaps. Educational only — verify before buying.
      </p>
    </div>
  );
}

function PlaybookActionCard({ decision, idx, done, dismissed, onOpen }) {
  const parsed = parseDecision(decision);
  const theme = DECISION_THEMES[parsed.type] || DECISION_THEMES.act;
  const Icon = ACTION_ICON_MAP[parsed.type] || CheckSquare;

  const opacity = dismissed ? 0.4 : done ? 0.7 : 1;

  return (
    <button
      onClick={() => onOpen(idx)}
      className="text-left transition-all duration-150 active:scale-[0.99] hover:shadow-md w-full h-full"
      style={{
        background: theme.bg,
        border: `2px solid ${theme.border}`,
        borderRadius: 10,
        padding: "6px 8px",
        boxShadow: `0 3px 10px -3px ${theme.shadow}, inset 0 1.5px 0 rgba(255,255,255,0.85), inset 0 -1.5px 0 rgba(0,0,0,0.05)`,
        opacity,
        display: "flex",
        flexDirection: "column",
        gap: 4,
        minHeight: 68,
      }}
    >
      {/* Top row: Icon + ticker + done check */}
      <div className="flex items-center gap-1.5">
        <div
          className="flex-shrink-0 flex items-center justify-center"
          style={{ width: 24, height: 24, borderRadius: 6, background: theme.iconBg }}
        >
          <Icon className="w-3 h-3" style={{ color: "white", strokeWidth: 2.6 }} />
        </div>
        {parsed.ticker && (
          <p
            className="text-[14px] font-bold m-0 leading-tight truncate"
            style={{ color: "#0f172a", fontFamily: SERIF }}
          >
            {parsed.ticker}
          </p>
        )}
        <span className="ml-auto text-[8.5px] font-bold tracking-[0.14em] uppercase" style={{ color: theme.labelText }}>
          {parsed.typeLabel}
        </span>
        {done && (
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 flex-shrink-0" strokeWidth={2.5} />
        )}
      </div>

      {/* Center text block — the action itself, single-line clamp keeps box compact */}
      <div className="flex-1 min-w-0">
        <p className="text-[11.5px] m-0 leading-snug" style={{
          color: "#1e293b",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}>
          {parsed.ticker
            ? (parsed.headline || decision).replace(parsed.ticker, "").replace(/^[\s:.\-—]+/, "")
            : (parsed.headline || decision)}
        </p>
        {parsed.account && (
          <p className="text-[8.5px] font-semibold uppercase tracking-wider mt-0.5 m-0" style={{ color: theme.accentText }}>
            {parsed.account}
          </p>
        )}
      </div>
    </button>
  );
}

// ────────────────────────────────────────────────────────────────────
// ChatSheet — conversational AI sheet that opens when the user taps
// "Ask about this" on any card. Provides live chat with Claude, fully
// aware of: the card's content, the user's portfolio, optional cash
// balance, today's market pulse. Conversations persist per card-id.
// ────────────────────────────────────────────────────────────────────
function ChatSheet({
  context,        // { id, type, ticker, description }
  messages,       // [{ role, content }]
  input,          // current input text
  setInput,       // setter for input
  loading,        // bool — request in flight
  error,          // string | null
  cashBalance,    // number | null
  onSetCash,      // (n) => void
  onSend,         // (text) => void
  onClose,        // () => void
}) {
  const scrollRef = React.useRef(null);
  const inputRef = React.useRef(null);
  const [showCashInput, setShowCashInput] = React.useState(false);
  const [cashDraft, setCashDraft] = React.useState(
    cashBalance != null ? String(cashBalance) : ""
  );

  // Auto-scroll to bottom when new messages arrive
  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  // Focus input when sheet opens
  React.useEffect(() => {
    if (context && inputRef.current) {
      // Small delay so the sheet animation completes
      const t = setTimeout(() => {
        if (inputRef.current) inputRef.current.focus();
      }, 200);
      return () => clearTimeout(t);
    }
  }, [context]);

  if (!context) return null;

  // Suggested starter questions based on the card type — gives the user
  // an obvious jumping-off point if they don't know what to ask.
  const starterPrompts = (() => {
    const tkr = context.ticker ? ` ${context.ticker}` : "";
    if (context.type === "playbook") {
      return [
        `Why this move${tkr}?`,
        `What if I disagree?`,
        cashBalance != null ? `How many shares can I afford?` : `How should I size this?`,
        `What's the risk?`,
      ];
    }
    if (context.type === "conviction") {
      return [
        `Why this signal${tkr}?`,
        `Should I add more or wait?`,
        `What's the bear case?`,
        `How does it fit my portfolio?`,
      ];
    }
    if (context.type === "radar") {
      return [
        cashBalance != null ? `How many shares can I afford?` : `How should I size a starter position?`,
        `Buy now or wait?`,
        `Does this fit my themes?`,
        `What's the risk vs upside?`,
      ];
    }
    if (context.type === "insider") {
      return [
        `Why does this trade matter?`,
        `Should I follow this signal?`,
        `What's the typical reaction?`,
        `Does this affect my portfolio?`,
      ];
    }
    if (context.type === "opportunity") {
      return [
        cashBalance != null ? `How many shares can I afford?` : `How should I size a starter position?`,
        `Why does this fit my portfolio?`,
        `What could go wrong?`,
        `Buy now or wait for a dip?`,
      ];
    }
    if (context.type === "general") {
      return [
        `Where am I overexposed?`,
        `What earnings should I watch?`,
        `Anything I should trim?`,
        `Where are my biggest gaps?`,
      ];
    }
    return [`Tell me more`, `What should I think about?`, `What's the catch?`];
  })();

  const submitCash = () => {
    const parsed = parseFloat(cashDraft.replace(/[$,\s]/g, ""));
    if (!isNaN(parsed) && parsed >= 0) {
      onSetCash(parsed);
      setShowCashInput(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ background: "rgba(15,23,42,0.55)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md bg-white shadow-2xl flex flex-col"
        style={{
          height: "85vh",
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: "linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)" }}>
              <Sparkles className="w-4 h-4 text-white" strokeWidth={2.5} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-bold text-slate-900 truncate" style={{ fontFamily: SERIF }}>
                Ask Morning Edge
              </p>
              <p className="text-[11px] text-slate-700 truncate uppercase tracking-wider">
                {context.type === "general" ? "Anything goes" : context.type}{context.ticker ? ` · ${context.ticker}` : ""}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center hover:bg-slate-100 active:bg-slate-200 transition"
            aria-label="Close chat"
          >
            <X className="w-4 h-4 text-slate-700" strokeWidth={2.5} />
          </button>
        </div>

        {/* Cash balance setter (collapsed pill, expandable) */}
        <div className="px-4 py-2 bg-slate-50 border-b border-slate-200">
          {!showCashInput ? (
            <button
              onClick={() => { setShowCashInput(true); setCashDraft(cashBalance != null ? String(cashBalance) : ""); }}
              className="w-full flex items-center justify-between text-[12px] text-slate-700 hover:text-slate-900 transition"
            >
              <span className="flex items-center gap-1.5">
                <Briefcase className="w-3 h-3" />
                {cashBalance != null
                  ? <>Cash to deploy: <span className="font-semibold text-slate-900">${cashBalance.toLocaleString()}</span></>
                  : "Set cash to deploy (optional, helps with sizing math)"
                }
              </span>
              <Pencil className="w-3 h-3" />
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-slate-700 flex-shrink-0">Cash $</span>
              <input
                type="text"
                inputMode="decimal"
                value={cashDraft}
                onChange={(e) => setCashDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submitCash(); }}
                className="flex-1 px-2 py-1 text-[14px] border border-slate-300 rounded outline-none focus:border-violet-500"
                placeholder="e.g. 5000"
                autoFocus
              />
              <button
                onClick={submitCash}
                className="px-3 py-1 text-[12px] font-semibold bg-slate-900 text-white rounded hover:bg-slate-800 active:bg-slate-700"
              >
                Save
              </button>
              <button
                onClick={() => setShowCashInput(false)}
                className="text-[12px] text-slate-500 hover:text-slate-700"
              >
                Cancel
              </button>
            </div>
          )}
        </div>

        {/* Card context preview */}
        <div className="px-4 py-2.5 bg-violet-50/50 border-b border-violet-100">
          <p className="text-[11px] uppercase tracking-wider font-bold text-violet-700 mb-0.5">
            About:
          </p>
          <p className="text-[13px] text-slate-700 leading-snug line-clamp-2">
            {context.description}
          </p>
        </div>

        {/* Message list */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="w-14 h-14 rounded-full flex items-center justify-center mb-3"
                style={{ background: "linear-gradient(135deg, #EDE9FE 0%, #DDD6FE 100%)" }}>
                <Sparkles className="w-6 h-6 text-violet-700" strokeWidth={2} />
              </div>
              <p className="text-[15px] text-slate-700 mb-4 max-w-xs leading-relaxed" style={{ fontFamily: SERIF }}>
                {context.type === "general"
                  ? "Ask me anything about your portfolio, today's market, or the brief."
                  : "Ask anything about this. I know your portfolio and today's market read."}
              </p>
              <div className="flex flex-col gap-2 w-full max-w-xs">
                {starterPrompts.map((q, i) => (
                  <button
                    key={i}
                    onClick={() => onSend(q)}
                    className="text-left text-[13px] px-3 py-2 rounded-lg border border-violet-200 bg-white hover:bg-violet-50 active:bg-violet-100 transition text-slate-800"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, i) => (
              <ChatMessageBubble key={i} role={m.role} content={m.content} />
            ))
          )}
          {loading && (
            <div className="flex items-center gap-2 text-[13px] text-slate-500 italic px-1">
              <span className="inline-block w-2 h-2 rounded-full bg-violet-400 animate-pulse" />
              Thinking…
            </div>
          )}
          {error && (
            <div className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2.5">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-rose-700 flex-shrink-0 mt-0.5" strokeWidth={2.5} />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] text-rose-900 font-semibold leading-snug">
                    Couldn't get a response
                  </p>
                  <p className="text-[12px] text-rose-700 leading-snug mt-0.5">
                    The AI is taking longer than usual. Try sending your question again, or check back in a moment.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Input */}
        <div className="px-3 py-2.5 border-t border-slate-200 bg-white">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (input.trim()) onSend(input);
                }
              }}
              placeholder={loading ? "Waiting…" : "Type your question…"}
              rows={1}
              disabled={loading}
              className="flex-1 px-3 py-2 text-[14px] border border-slate-300 rounded-xl outline-none focus:border-violet-500 resize-none max-h-32"
              style={{ minHeight: 40 }}
            />
            <button
              onClick={() => { if (input.trim()) onSend(input); }}
              disabled={loading || !input.trim()}
              className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition active:scale-95 disabled:opacity-50"
              style={{
                background: input.trim() && !loading
                  ? "linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)"
                  : "#E2E8F0",
              }}
              aria-label="Send message"
            >
              <ArrowRight className="w-4 h-4 text-white" strokeWidth={3} />
            </button>
          </div>
          <p className="text-[10px] text-slate-500 italic mt-1.5 text-center">
            Informational only. Not financial advice.
          </p>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// CardReadingPage — full-screen reading view that opens when the user
// taps "Read why · Ask about this" on Conviction Watch or Radar cards.
// Shows the deep_reasoning paragraph in a clean readable layout, with
// the original signal/headline at the top and an "Ask about this"
// button at the bottom for personalized chat follow-up.
// ────────────────────────────────────────────────────────────────────
// StockChart — TradingView Advanced Chart embedded as an iframe.
//
// Why iframe + TradingView instead of fetching prices ourselves: Yahoo's
// public chart endpoint (whether direct or via yahoo-finance2) rate-limits
// hard when a single user opens the brief and 10+ chart fetches fire in
// parallel from the same Vercel IP. TradingView serves chart data from
// their own CDN with no rate limit on us, supports every US ticker, and
// gives the user proper timeframe controls (1D / 5D / 1M / 3M / 6M / YTD
// / 1Y / 5Y / All) baked into the chart itself.
//
// Trade-off: small TradingView logo in the chart corner. Acceptable —
// users recognize the brand and it lends the chart credibility.
//
// The /api/prices/history endpoint is kept deployed (unused by this
// component) in case we want to bring back custom charts later.
function StockChart({ ticker }) {
  if (!ticker) return null;

  const symbol = String(ticker).toUpperCase().trim();

  // TradingView widget URL params — light theme, line chart (cleaner than
  // candles for a quick read), only timeframes shown in the toolbar. We
  // disable: chart-type picker, indicator picker, compare, fullscreen,
  // settings, save/load, screenshot, symbol-search — to keep the embed
  // focused on "what's the price doing" inside a stock card.
  const disabledFeatures = [
    "header_chart_type",
    "header_indicators",
    "header_compare",
    "header_settings",
    "header_fullscreen_button",
    "header_saveload",
    "header_symbol_search",
    "header_screenshot",
    "header_undo_redo",
    "edit_buttons_in_legend",
    "context_menus",
    "control_bar",
    "border_around_the_chart",
  ];

  const params = new URLSearchParams({
    symbol,
    interval: "D",
    hidesidetoolbar: "1",
    symboledit: "0",
    saveimage: "0",
    toolbarbg: "ffffff",
    hideideas: "1",
    hidetrading: "1",
    hidevolume: "1",
    hide_legend: "0",
    details: "0",
    hotlist: "0",
    calendar: "0",
    theme: "light",
    style: "2", // 2 = area / line chart
    timezone: "America/New_York",
    withdateranges: "1",
    showpopupbutton: "0",
    locale: "en",
    disabled_features: JSON.stringify(disabledFeatures),
  });

  const src = `https://s.tradingview.com/widgetembed/?${params.toString()}`;

  return (
    <div className="mb-4 rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="px-3 pt-2 pb-1 flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-[0.18em] font-bold text-slate-500 m-0 leading-none">
          Price chart · {symbol}
        </p>
        <p className="text-[9px] text-slate-400 m-0 leading-none italic">
          via TradingView
        </p>
      </div>
      <iframe
        src={src}
        title={`${symbol} price chart`}
        style={{ width: "100%", height: 280, border: 0, display: "block" }}
        allow="encrypted-media *"
        allowFullScreen
      />
      {/* Fallback link in case iframe is blocked by browser (rare) */}
      <div className="px-3 py-1.5 bg-slate-50 border-t border-slate-200">
        <a
          href={`https://www.tradingview.com/symbols/${encodeURIComponent(symbol)}/`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] text-slate-500 hover:text-slate-700 underline"
        >
          Open {symbol} on TradingView →
        </a>
      </div>
    </div>
  );
}


function CardReadingPage({ data, onClose, onAskAboutThis }) {
  if (!data) return null;

  // Theme by signal/type — match the card's color so the reading page
  // feels like a natural extension of the card the user tapped.
  const theme = (() => {
    if (data.type === "conviction") {
      const sig = (data.signal || "").toLowerCase();
      if (sig === "trim") return { bg: "linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%)", border: "#fca5a5", accent: "#b91c1c", accentDark: "#7f1d1d", chipBg: "#fee2e2" };
      if (sig === "add")  return { bg: "linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)", border: "#6ee7b7", accent: "#047857", accentDark: "#064e3b", chipBg: "#d1fae5" };
      return                    { bg: "linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)", border: "#fcd34d", accent: "#b45309", accentDark: "#78350f", chipBg: "#fef3c7" };
    }
    if (data.type === "radar") {
      return { bg: "linear-gradient(135deg, #ecfeff 0%, #cffafe 100%)", border: "#67e8f9", accent: "#0891b2", accentDark: "#155e75", chipBg: "#cffafe" };
    }
    if (data.type === "opportunity") {
      // Opportunity uses violet — distinguishes from radar's cyan.
      // Buy ideas are personalized and higher-stakes, so they warrant
      // their own visual signal.
      return { bg: "linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%)", border: "#c4b5fd", accent: "#6d28d9", accentDark: "#4c1d95", chipBg: "#ede9fe" };
    }
    return { bg: "linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%)", border: "#cbd5e1", accent: "#475569", accentDark: "#0f172a", chipBg: "#e2e8f0" };
  })();

  // Build a portfolio-context line if we know the holding
  const portfolioContext = (() => {
    if (!data.holding) return null;
    const h = data.holding;
    const parts = [];
    if (h.qty) parts.push(`${h.qty} sh`);
    if (h.value) parts.push(`$${h.value.toLocaleString()}`);
    if (h.gainPct != null) parts.push(`${h.gainPct > 0 ? "+" : ""}${h.gainPct.toFixed(1)}%`);
    return parts.length > 0 ? parts.join(" · ") : null;
  })();

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      style={{ background: "rgba(15,23,42,0.55)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md bg-white shadow-2xl flex flex-col"
        style={{
          maxHeight: "92vh",
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Colored header band */}
        <div style={{ background: theme.bg, padding: "16px 18px 14px", borderBottom: `1px solid ${theme.border}`, borderTopLeftRadius: 20, borderTopRightRadius: 20 }}>
          <div className="flex items-center justify-between mb-3">
            <p className="text-[12px] font-bold tracking-[0.2em] uppercase m-0" style={{ color: theme.accent }}>
              {data.type === "conviction" ? "Conviction · Why" : data.type === "radar" ? "Radar · Why" : data.type === "opportunity" ? "Opportunity · Why" : "Why"}
            </p>
            <button
              onClick={onClose}
              className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition active:scale-90"
              style={{ background: "rgba(255,255,255,0.7)" }}
              aria-label="Close"
            >
              <X className="w-4 h-4 text-slate-700" strokeWidth={2.5} />
            </button>
          </div>

          {data.headline && (
            <p className="text-[24px] font-bold m-0 leading-tight" style={{ color: "#0f172a", fontFamily: SERIF }}>
              {data.headline}
            </p>
          )}
          {!data.headline && data.ticker && (
            <p className="text-[24px] font-bold m-0 leading-tight" style={{ color: "#0f172a", fontFamily: SERIF }}>
              {data.ticker}
            </p>
          )}
          {data.theme && (
            <p className="text-[13px] m-0 mt-1 uppercase tracking-wider" style={{ color: theme.accent, fontWeight: 600 }}>
              {data.theme}
            </p>
          )}
          {data.action && (
            <p className="text-[14px] m-0 mt-2" style={{ color: theme.accentDark }}>
              <span className="font-semibold">Action:</span> {data.action}
            </p>
          )}
          {portfolioContext && (
            <p className="text-[12px] m-0 mt-2 opacity-80" style={{ color: theme.accentDark }}>
              Your position: {portfolioContext}
            </p>
          )}
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto px-5 py-5">
          {/* Live price chart — only renders when we have a ticker. Shows
              1D / 1W / 1M / 1Y / 5Y switcher with a clean SVG sparkline. */}
          {data.ticker && <StockChart ticker={data.ticker} />}

          {/* Fits gap callout — only for Opportunity type, distinguishes
              this from generic radar by emphasizing the portfolio fit. */}
          {data.fits_gap && (
            <div className="mb-4 rounded-lg p-3" style={{ background: theme.chipBg, border: `1px solid ${theme.border}` }}>
              <p className="text-[10px] uppercase tracking-[0.18em] font-bold mb-1" style={{ color: theme.accent }}>
                Fits your portfolio gap
              </p>
              <p className="text-[15px] leading-snug font-bold m-0" style={{ color: theme.accentDark, fontFamily: SERIF }}>
                {data.fits_gap}
              </p>
            </div>
          )}
          {/* Quick summary if we have why_now */}
          {data.why_now && (
            <div className="mb-4">
              <p className="text-[11px] uppercase tracking-[0.18em] font-bold text-slate-700 mb-1.5">
                Quick read
              </p>
              <p className="text-[15px] leading-relaxed m-0" style={{ color: "#1e293b", fontFamily: SERIF }}>
                {data.why_now}
              </p>
            </div>
          )}

          {/* Deep reasoning — the main content */}
          {data.deep_reasoning ? (
            <div>
              <p className="text-[11px] uppercase tracking-[0.18em] font-bold text-slate-700 mb-2">
                Why this · the case · what to consider
              </p>
              <p
                className="text-[16px] leading-relaxed m-0 whitespace-pre-wrap"
                style={{ color: "#0f172a", fontFamily: SERIF }}
              >
                {data.deep_reasoning}
              </p>
            </div>
          ) : (
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-3">
              <p className="text-[13px] text-amber-900 m-0 leading-relaxed">
                Deeper reasoning isn't available for this card yet — pull-to-refresh your brief to regenerate, or tap "Ask about this" below to get a custom explanation right now.
              </p>
            </div>
          )}

          {/* Verify · Learn more — source links so users can dive deeper
              into the stock on their preferred research site. */}
          {data.ticker && (
            <div className="mt-5 pt-4 border-t border-slate-200">
              <p className="text-[11px] uppercase tracking-[0.18em] font-bold text-slate-700 mb-2">
                Verify · Learn more about {data.ticker}
              </p>
              <div className="space-y-2">
                <a
                  href={`https://www.investing.com/search/?q=${data.ticker}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full text-left rounded-xl px-3.5 py-3 border bg-white hover:bg-slate-50 transition active:scale-[0.98]"
                  style={{ borderColor: "#e2e8f0" }}
                >
                  <p className="text-[14px] font-bold text-slate-900 leading-snug">
                    Investing.com — {data.ticker}
                  </p>
                  <p className="text-[12px] text-slate-700 leading-snug mt-0.5">
                    Full quote, charts, news, technical analysis, and earnings — clean dashboard.
                  </p>
                </a>
                <a
                  href={`https://seekingalpha.com/symbol/${data.ticker}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full text-left rounded-xl px-3.5 py-3 border bg-white hover:bg-slate-50 transition active:scale-[0.98]"
                  style={{ borderColor: "#e2e8f0" }}
                >
                  <p className="text-[14px] font-bold text-slate-900 leading-snug">
                    Seeking Alpha — {data.ticker}
                  </p>
                  <p className="text-[12px] text-slate-700 leading-snug mt-0.5">
                    Analyst articles, earnings analysis, bull/bear takes (some content paywalled).
                  </p>
                </a>
                <a
                  href={`https://finance.yahoo.com/quote/${data.ticker}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full text-left rounded-xl px-3.5 py-3 border bg-white hover:bg-slate-50 transition active:scale-[0.98]"
                  style={{ borderColor: "#e2e8f0" }}
                >
                  <p className="text-[14px] font-bold text-slate-900 leading-snug">
                    Yahoo Finance — {data.ticker}
                  </p>
                  <p className="text-[12px] text-slate-700 leading-snug mt-0.5">
                    Quick price, news headlines, and basic chart. Always works as a fallback.
                  </p>
                </a>
                <a
                  href={`https://fintel.io/so/us/${data.ticker.toLowerCase()}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full text-left rounded-xl px-3.5 py-3 border bg-white hover:bg-slate-50 transition active:scale-[0.98]"
                  style={{ borderColor: "#e2e8f0" }}
                >
                  <p className="text-[14px] font-bold text-slate-900 leading-snug">
                    Fintel — {data.ticker} institutional ownership
                  </p>
                  <p className="text-[12px] text-slate-700 leading-snug mt-0.5">
                    See which hedge funds and institutions hold this stock. Clean ownership data.
                  </p>
                </a>
              </div>
            </div>
          )}

          {/* Disclaimer */}
          <p className="text-[11px] text-slate-500 italic mt-5">
            Educational and informational only. Not financial advice. Verify catalysts and current prices before acting.
          </p>
        </div>

        {/* Footer — Ask about this CTA */}
        <div className="px-5 pt-3 pb-4 border-t border-slate-200 bg-white">
          <button
            onClick={() => onAskAboutThis(data)}
            className="w-full py-3 rounded-xl font-bold text-[15px] tracking-wide transition active:scale-[0.98] flex items-center justify-center gap-2 text-white"
            style={{
              background: "linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)",
              boxShadow: "0 6px 18px -3px rgba(67,56,202,0.55), inset 0 1px 0 rgba(255,255,255,0.25)", border: "2px solid #4338CA",
            }}
          >
            <Sparkles className="w-4 h-4" strokeWidth={2.5} />
            Ask about this — your situation
          </button>
          <p className="text-[11px] text-slate-500 italic text-center mt-2">
            Talk to AI about how this fits your portfolio, your cash, your concerns.
          </p>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// SourceDetailSheet — opens when the user taps any Insider Flow row
// (whale, congress, or hedge fund). Shows the trade in context with a
// "why it matters" paragraph, then a list of color-coded source buttons.
// Each button is clearly labeled with WHAT the user will find there, so
// they can choose primary verification or general stock context.
// ────────────────────────────────────────────────────────────────────
function SourceDetailSheet({ data, onClose, onOpenLink }) {
  if (!data) return null;
  const { category, text, ticker, why_matters } = data;

  // Theme by category
  const theme = (() => {
    if (category === "whale") {
      return {
        gradient: "linear-gradient(135deg, #ecfdf5 0%, #a7f3d0 100%)",
        accent: "#047857",
        accentDark: "#064e3b",
        chipBg: "#d1fae5",
        chipText: "#065f46",
        label: "Whale Move",
      };
    }
    if (category === "congress") {
      return {
        gradient: "linear-gradient(135deg, #fffbeb 0%, #fde68a 100%)",
        accent: "#b45309",
        accentDark: "#78350f",
        chipBg: "#fef3c7",
        chipText: "#92400e",
        label: "Congressional Trade",
      };
    }
    return {
      gradient: "linear-gradient(135deg, #eff6ff 0%, #bfdbfe 100%)",
      accent: "#1d4ed8",
      accentDark: "#1e3a8a",
      chipBg: "#dbeafe",
      chipText: "#1e40af",
      label: "Hedge Fund Move",
    };
  })();

  // Build the source list — each entry has a label, a description of what
  // the user will find there, an icon, and a URL. Labels are written so a
  // new investor understands what each source actually delivers.
  const sources = (() => {
    const tkr = (ticker || "").toUpperCase();
    const list = [];

    if (category === "congress") {
      if (tkr) {
        list.push({
          name: "Quiver Quant — Congressional trades",
          desc: `See every disclosed congressional trade in ${tkr}, including this one. Free, no login.`,
          url: `https://www.quiverquant.com/congresstrading/stock/${tkr}`,
          primary: true,
        });
      }
      list.push({
        name: "House Stock Watcher",
        desc: "Searchable archive of House STOCK Act disclosures by name or ticker.",
        url: "https://housestockwatcher.com/",
        primary: false,
      });
      if (tkr) {
        list.push({
          name: `Investing.com — ${tkr}`,
          desc: "Full quote, charts, news, and analysis for context on the stock.",
          url: `https://www.investing.com/search/?q=${tkr}`,
          primary: false,
        });
        list.push({
          name: `Seeking Alpha — ${tkr}`,
          desc: "Analyst takes and earnings coverage (some content paywalled).",
          url: `https://seekingalpha.com/symbol/${tkr}`,
          primary: false,
        });
        list.push({
          name: `Yahoo Finance — ${tkr} quote`,
          desc: "Quick price + news. Always works as a fallback.",
          url: `https://finance.yahoo.com/quote/${tkr}`,
          primary: false,
        });
      }
    } else if (category === "whale") {
      if (tkr) {
        list.push({
          name: `Fintel — ${tkr} institutional holders`,
          desc: `Clean view of every 13F filer holding ${tkr}, ranked by position size. Less ad-heavy than WhaleWisdom.`,
          url: `https://fintel.io/so/us/${tkr.toLowerCase()}`,
          primary: true,
        });
        list.push({
          name: `Investing.com — ${tkr}`,
          desc: "Full quote, charts, news, technical analysis, and recent earnings — clean dashboard view.",
          url: `https://www.investing.com/search/?q=${tkr}`,
          primary: false,
        });
        list.push({
          name: `Seeking Alpha — ${tkr}`,
          desc: "Analyst articles, earnings analysis, and bull/bear takes (some content requires subscription).",
          url: `https://seekingalpha.com/symbol/${tkr}`,
          primary: false,
        });
        list.push({
          name: "WhaleWisdom — backup view",
          desc: `Same data as Fintel, more comprehensive but cluttered. Use if Fintel is missing data.`,
          url: `https://whalewisdom.com/stock/${tkr}`,
          primary: false,
        });
        list.push({
          name: `Yahoo Finance — ${tkr} quote`,
          desc: "Quick price + news. Always works as a fallback.",
          url: `https://finance.yahoo.com/quote/${tkr}`,
          primary: false,
        });
      }
    } else {
      // hedge
      if (tkr) {
        list.push({
          name: `Fintel — ${tkr} fund holders`,
          desc: `Clean list of hedge funds holding ${tkr}. The named fund appears with its position size and changes.`,
          url: `https://fintel.io/so/us/${tkr.toLowerCase()}`,
          primary: true,
        });
        list.push({
          name: `Investing.com — ${tkr}`,
          desc: "Full quote, charts, news, technical analysis, and earnings.",
          url: `https://www.investing.com/search/?q=${tkr}`,
          primary: false,
        });
        list.push({
          name: `Seeking Alpha — ${tkr}`,
          desc: "Analyst takes, earnings coverage, and quant ratings (some content paywalled).",
          url: `https://seekingalpha.com/symbol/${tkr}`,
          primary: false,
        });
        list.push({
          name: "HedgeFollow — fund profiles",
          desc: "Search by fund name to see their full disclosed portfolio.",
          url: "https://hedgefollow.com/",
          primary: false,
        });
        list.push({
          name: `Yahoo Finance — ${tkr} quote`,
          desc: "Quick price + news. Always works as a fallback.",
          url: `https://finance.yahoo.com/quote/${tkr}`,
          primary: false,
        });
      }
    }

    if (list.length === 0) {
      list.push({
        name: "Google Search",
        desc: "Search for the trade or filing manually.",
        url: `https://www.google.com/search?q=${encodeURIComponent(text || "")}`,
        primary: false,
      });
    }
    return list;
  })();

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      style={{ background: "rgba(15,23,42,0.55)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md bg-white shadow-2xl flex flex-col"
        style={{
          maxHeight: "92vh",
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Colored header */}
        <div style={{ background: theme.gradient, padding: "16px 18px 14px", borderTopLeftRadius: 20, borderTopRightRadius: 20 }}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="px-2 py-1 rounded-md text-[10px] font-bold tracking-wider uppercase" style={{ background: theme.chipBg, color: theme.chipText }}>
                {theme.label}
              </span>
              {ticker && (
                <span className="px-2 py-1 rounded-md text-[10px] font-bold tracking-wider uppercase border" style={{ background: "white", color: theme.accentDark, borderColor: theme.chipBg }}>
                  {ticker}
                </span>
              )}
            </div>
            <button
              onClick={onClose}
              className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition active:scale-90"
              style={{ background: "rgba(255,255,255,0.7)" }}
              aria-label="Close"
            >
              <X className="w-4 h-4 text-slate-700" strokeWidth={2.5} />
            </button>
          </div>
          <p className="text-[18px] font-bold m-0 leading-snug" style={{ color: "#0f172a", fontFamily: SERIF }}>
            {text || "Trade details"}
          </p>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* Why it matters */}
          {why_matters ? (
            <div className="mb-5 rounded-xl p-3.5" style={{ background: "#f1f5f9", border: `1px solid ${theme.chipBg}` }}>
              <p className="text-[10px] uppercase tracking-[0.18em] font-bold mb-1.5" style={{ color: theme.accent }}>
                Why it matters
              </p>
              <p className="text-[14px] leading-relaxed text-slate-800 m-0" style={{ fontFamily: SERIF }}>
                {why_matters}
              </p>
            </div>
          ) : (
            <div className="mb-5 rounded-xl p-3 bg-slate-50 border border-slate-200">
              <p className="text-[12px] text-slate-600 italic m-0">
                Tap a source below to verify and learn more.
              </p>
            </div>
          )}

          {/* Source list */}
          <p className="text-[10px] uppercase tracking-[0.18em] font-bold text-slate-700 mb-2">
            Verify · Learn more
          </p>
          <div className="space-y-2">
            {sources.map((src, i) => (
              <button
                key={i}
                onClick={() => {
                  if (onOpenLink) onOpenLink(src.url);
                }}
                className={`w-full text-left rounded-xl px-3.5 py-3 transition active:scale-[0.98] ${
                  src.primary
                    ? "border-2"
                    : "border bg-white hover:bg-slate-50"
                }`}
                style={src.primary ? {
                  background: theme.gradient,
                  borderColor: theme.accent,
                } : { borderColor: "#e2e8f0" }}
              >
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-bold leading-snug" style={{ color: src.primary ? theme.accentDark : "#0f172a" }}>
                      {src.primary && "★ "}{src.name}
                    </p>
                    <p className="text-[12px] text-slate-700 leading-snug mt-0.5">
                      {src.desc}
                    </p>
                  </div>
                  <ExternalLink className="w-3.5 h-3.5 flex-shrink-0 mt-1" style={{ color: src.primary ? theme.accent : "#64748b" }} />
                </div>
              </button>
            ))}
          </div>

          {/* Disclaimer */}
          <p className="text-[11px] text-slate-500 italic mt-5 leading-relaxed">
            {category === "congress"
              ? "Congressional trades are disclosed under the STOCK Act, with a typical 30-45 day delay between trade and disclosure."
              : "13F filings disclose institutional positions at quarter-end. Public data is ~45 days delayed; positions may have changed since."}
          </p>
        </div>
      </div>
    </div>
  );
}

// Single chat bubble — user (right, dark) or assistant (left, light).
function ChatMessageBubble({ role, content }) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] px-3.5 py-2.5 rounded-2xl text-[14px] leading-relaxed whitespace-pre-wrap break-words ${
          isUser
            ? "bg-slate-900 text-white rounded-br-md"
            : "bg-violet-50 text-slate-800 border border-violet-100 rounded-bl-md"
        }`}
        style={isUser ? {} : { fontFamily: SERIF }}
      >
        {content}
      </div>
    </div>
  );
}

// Full-screen detail modal — opens when a playbook card is tapped.
// Shows the full decision text, reasoning, and action buttons.
function PlaybookDetailModal({ decision, idx, done, dismissed, onClose, onMarkDone, onDismiss, onAddToCalendar, onAskAboutThis, deepReasoning }) {
  if (!decision) return null;
  const parsed = parseDecision(decision);
  const theme = DECISION_THEMES[parsed.type] || DECISION_THEMES.act;
  const Icon = ACTION_ICON_MAP[parsed.type] || CheckSquare;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      style={{ background: "rgba(15,23,42,0.55)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md bg-white sm:rounded-2xl shadow-2xl overflow-hidden"
        style={{
          maxHeight: "90vh",
          overflowY: "auto",
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Colored header band matching the action type */}
        <div style={{ background: theme.bg, padding: "16px 18px 14px", borderBottom: `1px solid ${theme.border}` }}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div
                className="flex items-center justify-center"
                style={{ width: 28, height: 28, borderRadius: 8, background: theme.iconBg }}
              >
                <Icon className="w-4 h-4" style={{ color: "white", strokeWidth: 2.8 }} />
              </div>
              <p className="text-[13px] font-bold tracking-[0.18em] uppercase m-0" style={{ color: theme.labelText }}>
                {parsed.typeLabel} ACTION
              </p>
            </div>
            <button
              onClick={onClose}
              className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition active:scale-90"
              style={{ background: "rgba(255,255,255,0.7)" }}
              aria-label="Close"
            >
              <X className="w-4 h-4 text-slate-700" strokeWidth={2.5} />
            </button>
          </div>

          {parsed.ticker && (
            <p
              className="text-[28px] font-bold m-0 leading-tight"
              style={{ color: "#0f172a", fontFamily: SERIF }}
            >
              {parsed.ticker}
            </p>
          )}
          {parsed.account && (
            <p className="text-[15px] m-0 mt-1" style={{ color: theme.accentText }}>
              {parsed.account}
            </p>
          )}
        </div>

        {/* Body — short decision text + full reasoning */}
        <div className="px-5 py-4">
          {/* Price chart for the decision's ticker — same component as the
              conviction reading page so the user gets consistent context
              regardless of which kind of card they tapped. */}
          {parsed.ticker && <StockChart ticker={parsed.ticker} />}

          <p
            className="text-[16px] leading-relaxed m-0 font-semibold"
            style={{ color: "#1e293b", fontFamily: SERIF }}
          >
            {parsed.body}
          </p>
          {/* Deep reasoning paragraph — 130-180 word plain-English explanation */}
          {deepReasoning && (
            <div className="mt-4 pt-4 border-t border-slate-200">
              <p className="text-[11px] uppercase tracking-[0.18em] font-bold text-slate-700 mb-2">
                Why this · the case · what to consider
              </p>
              <p
                className="text-[15px] leading-relaxed m-0"
                style={{ color: "#1e293b", fontFamily: SERIF }}
              >
                {deepReasoning}
              </p>
            </div>
          )}
          {/* Verify · Learn more — source links so users can dive deeper
              into the stock on their preferred research site. Same pattern
              as Conviction and Radar reading pages. */}
          {parsed.ticker && (
            <div className="mt-5 pt-4 border-t border-slate-200">
              <p className="text-[11px] uppercase tracking-[0.18em] font-bold text-slate-700 mb-2">
                Verify · Learn more about {parsed.ticker}
              </p>
              <div className="space-y-2">
                <a
                  href={`https://www.investing.com/search/?q=${parsed.ticker}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full text-left rounded-xl px-3.5 py-3 border bg-white hover:bg-slate-50 transition active:scale-[0.98]"
                  style={{ borderColor: "#e2e8f0" }}
                >
                  <p className="text-[14px] font-bold text-slate-900 leading-snug">
                    Investing.com — {parsed.ticker}
                  </p>
                  <p className="text-[12px] text-slate-700 leading-snug mt-0.5">
                    Full quote, charts, news, technical analysis, and earnings — clean dashboard.
                  </p>
                </a>
                <a
                  href={`https://seekingalpha.com/symbol/${parsed.ticker}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full text-left rounded-xl px-3.5 py-3 border bg-white hover:bg-slate-50 transition active:scale-[0.98]"
                  style={{ borderColor: "#e2e8f0" }}
                >
                  <p className="text-[14px] font-bold text-slate-900 leading-snug">
                    Seeking Alpha — {parsed.ticker}
                  </p>
                  <p className="text-[12px] text-slate-700 leading-snug mt-0.5">
                    Analyst articles, earnings analysis, bull/bear takes (some content paywalled).
                  </p>
                </a>
                <a
                  href={`https://finance.yahoo.com/quote/${parsed.ticker}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full text-left rounded-xl px-3.5 py-3 border bg-white hover:bg-slate-50 transition active:scale-[0.98]"
                  style={{ borderColor: "#e2e8f0" }}
                >
                  <p className="text-[14px] font-bold text-slate-900 leading-snug">
                    Yahoo Finance — {parsed.ticker}
                  </p>
                  <p className="text-[12px] text-slate-700 leading-snug mt-0.5">
                    Quick price, news headlines, and basic chart. Always works as a fallback.
                  </p>
                </a>
                <a
                  href={`https://fintel.io/so/us/${parsed.ticker.toLowerCase()}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full text-left rounded-xl px-3.5 py-3 border bg-white hover:bg-slate-50 transition active:scale-[0.98]"
                  style={{ borderColor: "#e2e8f0" }}
                >
                  <p className="text-[14px] font-bold text-slate-900 leading-snug">
                    Fintel — {parsed.ticker} institutional ownership
                  </p>
                  <p className="text-[12px] text-slate-700 leading-snug mt-0.5">
                    See which hedge funds and institutions hold this stock. Clean ownership data.
                  </p>
                </a>
              </div>
            </div>
          )}
        </div>

        {/* Status indicators */}
        {(done || dismissed) && (
          <div className="px-5 pb-2">
            {done && (
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200">
                <Check className="w-3.5 h-3.5 text-emerald-700" strokeWidth={3} />
                <span className="text-[12px] font-bold uppercase tracking-wider text-emerald-800">Marked done</span>
              </div>
            )}
            {dismissed && !done && (
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 border border-slate-200">
                <X className="w-3.5 h-3.5 text-slate-700" strokeWidth={2.5} />
                <span className="text-[12px] font-bold uppercase tracking-wider text-slate-700">Dismissed</span>
              </div>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div className="px-5 pb-5 pt-2 flex flex-col gap-2">
          {/* Ask about this — opens conversational chat with full context */}
          {onAskAboutThis && (
            <button
              onClick={() => onAskAboutThis(decision, idx)}
              className="w-full py-3 rounded-xl font-bold text-[15px] tracking-wide transition active:scale-[0.98] flex items-center justify-center gap-2 text-white"
              style={{
                background: "linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)",
                boxShadow: "0 6px 18px -3px rgba(67,56,202,0.55), inset 0 1px 0 rgba(255,255,255,0.25)", border: "2px solid #4338CA",
              }}
            >
              <Sparkles className="w-4 h-4" strokeWidth={2.5} />
              Ask about this
            </button>
          )}
          <button
            onClick={() => { onMarkDone(idx); onClose(); }}
            className="w-full py-3 rounded-xl font-bold text-[16px] tracking-wide transition active:scale-[0.98] flex items-center justify-center gap-2"
            style={{
              background: done ? "white" : "#0f172a",
              color: done ? "#475569" : "white",
              border: done ? "1px solid #e2e8f0" : "none",
            }}
          >
            {done ? (
              <>
                <X className="w-4 h-4" strokeWidth={2.5} />
                Mark not done
              </>
            ) : (
              <>
                <Check className="w-4 h-4" strokeWidth={3} />
                Mark done
              </>
            )}
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => { onDismiss(idx); onClose(); }}
              className="py-2.5 rounded-xl font-semibold text-[15px] transition active:scale-[0.98] flex items-center justify-center gap-1.5"
              style={{
                background: "white",
                color: dismissed ? "#0f172a" : "#475569",
                border: "1px solid #e2e8f0",
              }}
            >
              <X className="w-3.5 h-3.5" strokeWidth={2.5} />
              {dismissed ? "Undismiss" : "Dismiss"}
            </button>
            <button
              onClick={() => { onAddToCalendar(decision, idx); }}
              className="py-2.5 rounded-xl font-semibold text-[15px] transition active:scale-[0.98] flex items-center justify-center gap-1.5"
              style={{
                background: "white",
                color: "#475569",
                border: "1px solid #e2e8f0",
              }}
            >
              <CalendarPlus className="w-3.5 h-3.5" />
              Calendar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Daily Power Plate — high-protein dinner card with grocery list,
// prep steps, protein count. Expandable for the full recipe.
// ────────────────────────────────────────────────────────────────────
function PowerPlateCard({ plate }) {
  const [expanded, setExpanded] = React.useState(false);
  if (!plate) return null;
  const {
    name,
    description,
    protein_g,
    prep_min,
    groceries = [],
    prep_steps = [],
    why_this_meal,
    swap_options = [],
    pairing,
  } = plate;
  return (
    <div className="rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50/70 to-orange-50/40 overflow-hidden">
      {/* Header — always visible */}
      <div className="px-4 pt-4 pb-3">
        <p className="text-[16px] font-bold text-slate-900 leading-snug mb-1.5" style={{ fontFamily: SERIF }}>
          {name}
        </p>
        {description && (
          <p className="text-[15px] text-slate-700 leading-relaxed mb-3">{description}</p>
        )}
        {/* Stats row */}
        <div className="flex items-center gap-2 mb-3">
          {protein_g != null && (
            <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-100 text-emerald-800 border border-emerald-200">
              <Flame className="w-3 h-3" />
              <span className="text-[13px] font-bold">{protein_g}g protein</span>
            </div>
          )}
          {prep_min != null && (
            <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-slate-100 text-slate-700 border border-slate-200">
              <Timer className="w-3 h-3" />
              <span className="text-[13px] font-bold">{prep_min} min</span>
            </div>
          )}
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full text-left px-3 py-2 rounded-lg bg-white border border-amber-200 hover:bg-amber-50 active:bg-amber-100 transition flex items-center justify-between"
        >
          <span className="text-[15px] font-semibold text-slate-800 flex items-center gap-1.5">
            <ShoppingBasket className="w-3.5 h-3.5 text-amber-700" />
            {expanded ? "Hide grocery list & recipe" : "Show grocery list & recipe"}
          </span>
          <span className="text-slate-500 text-base leading-none">{expanded ? "−" : "+"}</span>
        </button>
      </div>

      {/* Expanded section — why_this_meal + grocery list + prep steps + swaps + pairing */}
      {expanded && (
        <div className="px-4 pb-4 pt-1 space-y-4 border-t border-amber-100">
          {/* Why this meal today — context paragraph explaining nutritional rationale.
              Tucked inside the expanded view so the card stays compact when collapsed. */}
          {why_this_meal && (
            <div className="rounded-lg bg-white/70 border border-amber-200/60 px-3 py-2.5 mt-3">
              <p className="text-[10px] uppercase tracking-[0.18em] font-bold text-amber-800 mb-1">
                Why this meal today
              </p>
              <p className="text-[13px] text-slate-800 leading-relaxed m-0">{why_this_meal}</p>
            </div>
          )}
          {groceries.length > 0 && (
            <div>
              <p className="text-[12px] uppercase tracking-[0.2em] text-amber-700 font-semibold mb-2 flex items-center gap-1.5">
                <ShoppingBasket className="w-3 h-3" /> Pick up at the store
              </p>
              <ul className="space-y-1.5">
                {groceries.map((g, i) => (
                  <li key={i} className="text-[16px] text-slate-700 leading-snug flex gap-2">
                    <span className="text-amber-500 font-bold flex-shrink-0">·</span>
                    <span>{g}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {prep_steps.length > 0 && (
            <div>
              <p className="text-[12px] uppercase tracking-[0.2em] text-amber-700 font-semibold mb-2 flex items-center gap-1.5">
                <Utensils className="w-3 h-3" /> Quick prep
              </p>
              <ol className="space-y-2">
                {prep_steps.map((s, i) => (
                  <li key={i} className="text-[16px] text-slate-700 leading-relaxed flex gap-2.5">
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-amber-100 text-amber-800 text-[12px] font-bold flex items-center justify-center mt-0.5">
                      {i + 1}
                    </span>
                    <span className="flex-1">{s}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          {/* Swap options — sub-ingredient flexibility */}
          {Array.isArray(swap_options) && swap_options.length > 0 && (
            <div>
              <p className="text-[12px] uppercase tracking-[0.2em] text-amber-700 font-semibold mb-2 flex items-center gap-1.5">
                <RefreshCw className="w-3 h-3" /> Easy swaps
              </p>
              <ul className="space-y-1.5">
                {swap_options.map((s, i) => (
                  <li key={i} className="text-[15px] text-slate-700 leading-snug flex gap-2">
                    <span className="text-amber-500 flex-shrink-0">↔</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {/* Pairing suggestion — drink/side */}
          {pairing && (
            <div className="rounded-lg bg-amber-100/50 border border-amber-200 px-3 py-2.5">
              <p className="text-[11px] uppercase tracking-[0.18em] font-bold text-amber-800 mb-1">
                Pair with
              </p>
              <p className="text-[14px] text-amber-900 leading-relaxed m-0">{pairing}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}


function SignatureFooter({ verified, hash, compact }) {
  return (
    <footer className={compact ? "pt-6 text-center" : "pt-8 text-center"}>
      {!compact && (
        <p className="text-[15px] text-slate-700 max-w-md mx-auto leading-relaxed px-4">
          Informational and educational use only. Not investment, financial, tax, or medical advice. Consult a licensed financial advisor or healthcare professional before making decisions. Past performance does not guarantee future results. AI-generated content may be inaccurate — verify before acting. Your data stays on your device. <a href="/about" className="underline">About</a> · <a href="/privacy" className="underline">Privacy</a> · <a href="/terms" className="underline">Terms</a> · <a href="/support" className="underline">Support</a>
        </p>
      )}

      {/* Charitable mission — a portion of proceeds supports children and
          adults with disabilities. The medallion at the heart of this
          section is a bronze relief of the founder's father holding his
          sister, who lives with disabilities. The reason the app exists. */}
      {!compact && (
        <div className="mt-6 mx-4 px-5 py-6 rounded-2xl border max-w-md mx-auto"
          style={{
            background: "linear-gradient(135deg, #faf6ee 0%, #f4ede4 60%, #efe4d0 100%)",
            borderColor: "#e8dfca",
            boxShadow: "0 2px 12px -4px rgba(124, 45, 18, 0.08)",
          }}>
          <p className="text-[10px] uppercase tracking-[0.22em] font-bold text-amber-900/80 mb-4">
            Because every life deserves dignity
          </p>
          {/* Medallion — bronze relief, family heart of this app */}
          <div className="flex justify-center mb-4">
            <img
              src="/charity_medallion.webp"
              alt="Bronze medallion of a father holding his daughter — the inspiration behind Morning Edge"
              width="120"
              height="120"
              className="select-none pointer-events-none"
              style={{
                filter: "drop-shadow(0 4px 8px rgba(124, 45, 18, 0.20))",
              }}
              loading="lazy"
            />
          </div>
          <p className="text-[13.5px] text-slate-800 leading-relaxed text-center px-1">
            A portion of proceeds contributes to U.S. charities supporting children and adults with disabilities and the families who care for them.
          </p>
        </div>
      )}

      <div className={`mt-4 inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-[12px] font-bold tracking-wider uppercase ${
        verified ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-rose-50 border-rose-200 text-rose-700"
      }`}>
        {verified ? <ShieldCheck className="w-3 h-3" /> : <ShieldAlert className="w-3 h-3" />}
        {verified ? "Signed · TP·ME·2026" : "MODIFIED"}
      </div>
      <p className="text-[9px] text-slate-700 mt-1.5 font-mono tracking-wider">© 2026 T-SPOT · sha {hash}</p>
    </footer>
  );
}

// ────────────────────────────────────────────────────────────────────
// In-app browser sheet — keeps users inside the PWA when tapping
// external source links instead of kicking them out to Safari.
// Tries to load the URL in an iframe; if the site blocks framing,
// shows a fallback "Open in browser" button as escape hatch.
// ────────────────────────────────────────────────────────────────────
function InAppBrowser({ url, onClose }) {
  // We previously tried iframing the link, then falling back to the user's
  // browser. Real-world result: financial disclosure sites all set
  // X-Frame-Options to block embedding, so the iframe always failed and
  // showed an empty box. We now open the user's native browser at the
  // click site (popup-blocker-safe) and just show a confirmation modal here.
  const hostname = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch (_e) {
      return "external source";
    }
  })();

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      style={{ background: "rgba(15,23,42,0.55)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md bg-white shadow-2xl"
        style={{
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-6 text-center">
          <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-3">
            <ExternalLink className="w-5 h-5 text-amber-700" />
          </div>
          <h3 className="text-[17px] font-semibold text-slate-900 mb-2">Opened in your browser</h3>
          <p className="text-[14px] text-slate-700 leading-relaxed mb-1">
            <span className="font-semibold break-all">{hostname}</span>
          </p>
          <p className="text-[13px] text-slate-600 leading-relaxed mb-5">
            Switch to your browser to view the source. Come back here when done.
          </p>
          <button
            onClick={onClose}
            className="w-full py-3 rounded-xl bg-slate-900 text-white text-[15px] font-semibold hover:bg-slate-800 active:bg-slate-700 transition flex items-center justify-center gap-2"
          >
            <ChevronLeft className="w-4 h-4" /> Back to Morning Edge
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Brokerage Guide Modal ────────────────────────────────────────────
// Tappable list of major US brokerages. Each row is a button — tap to
// open the brokerage's site in the in-app browser (or external Safari
// if they block embedding). Pure navigation help — no credential
// collection, no liability surface.
function BrokerageGuide({ onClose, onOpenLink, isMobile = false }) {
  const handleBrokerClick = (b) => {
    // Always open the broker login in a new tab — works on both mobile and
    // desktop. The header notes that CSV downloads are easier on a computer.
    if (typeof window !== "undefined") {
      window.open(b.url, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex flex-col">
      <div className="flex items-center gap-2 bg-white border-b border-slate-200 px-3 py-3 shadow-sm flex-shrink-0">
        <button
          onClick={onClose}
          className="flex items-center gap-1 px-2 py-1.5 rounded-lg hover:bg-slate-100 active:bg-slate-200 transition text-slate-700"
          aria-label="Close brokerage guide"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0 px-1">
          <p className="text-[12px] uppercase tracking-wider text-slate-700 font-semibold leading-tight">Brokerage Help</p>
          <p className="text-[16px] text-slate-900 font-semibold truncate">Where to find your CSV</p>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-slate-100 active:bg-slate-200 transition text-slate-700"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto bg-slate-50">
        <div className="px-4 py-4">
          <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-3 mb-4 text-[15px] text-amber-900 leading-relaxed">
            <p className="font-semibold mb-1">How this works</p>
            {isMobile ? (
              <p>
                Brokerage CSV exports are designed for desktop. Open Morning Edge on
                your computer, sign in to your broker, follow the path shown to find
                your positions, and save the CSV. Then come back here on this device
                or your computer and upload it.
              </p>
            ) : (
              <p>
                Tap any brokerage to open in a new tab. Log in, follow the path shown
                to find your positions CSV, then save the file to your computer. Come
                back here and upload it in Conviction Watch.
              </p>
            )}
            <p className="mt-2 font-semibold text-amber-900">
              We never see your password. We only read the CSV you upload. Holdings
              stay on your device until a brief is generated, and are never stored
              on our servers.
            </p>
          </div>

          <div className="space-y-2">
            {BROKERAGES.map((b) => (
              <button
                key={b.name}
                onClick={() => handleBrokerClick(b)}
                className="w-full text-left bg-white border border-slate-200 rounded-xl px-3.5 py-3 hover:border-amber-300 hover:bg-amber-50/40 active:bg-amber-50 transition"
              >
                <div className="flex items-start gap-2.5">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <h3 className="text-[16px] font-bold text-slate-900 truncate" style={{ fontFamily: SERIF }}>
                        {b.name}
                      </h3>
                      <ExternalLink className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" />
                    </div>
                    <p className="text-[13px] text-slate-700 leading-snug font-medium">
                      {b.path}
                    </p>
                    {b.notes && (
                      <p className="text-[12px] text-slate-700 leading-snug mt-1 italic">
                        {b.notes}
                      </p>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>

          <p className="text-[12px] text-slate-700 leading-relaxed italic text-center mt-4">
            Don't see your brokerage? Most platforms support CSV export under "Statements,"
            "Documents," or "Account History." Look on desktop if you can't find it on mobile.
          </p>
        </div>
      </div>
    </div>
  );
}
