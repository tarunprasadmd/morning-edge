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

// ─── Routine Library ─────────────────────────────────────────────────
// 7 daily routines (one per day of week), 4 segments each. Total 10 min.
// Each segment: { title, durationSec, kicker, exercises: [{ name, cue }] }
const ROUTINES = [
  // Sunday — gentle reset
  {
    name: "Reset",
    segments: [
      { kicker: "Mobility", title: "Wake the spine", durationSec: 120, exercises: [
        { name: "Neck rolls", cue: "Slow circles, both directions" },
        { name: "Shoulder shrugs", cue: "Up, hold 3, down. Repeat" },
        { name: "Cat-cow", cue: "Inhale arch, exhale round" },
      ]},
      { kicker: "Breathwork", title: "Box breathing", durationSec: 180, exercises: [
        { name: "4-4-4-4", cue: "Inhale 4 · hold 4 · exhale 4 · hold 4" },
        { name: "Through the nose", cue: "Soft jaw, soft shoulders" },
      ]},
      { kicker: "Strength", title: "Core foundation", durationSec: 180, exercises: [
        { name: "Plank", cue: "Hold 45 sec, rest 15, repeat ×2" },
        { name: "Glute bridges", cue: "10 reps, squeeze at top" },
      ]},
      { kicker: "Stretch", title: "Open and ground", durationSec: 120, exercises: [
        { name: "Forward fold", cue: "Hang heavy, soft knees" },
        { name: "Child's pose", cue: "Knees wide, breathe into back" },
      ]},
    ],
  },
  // Monday — power start
  {
    name: "Power Start",
    segments: [
      { kicker: "Mobility", title: "Hip openers", durationSec: 120, exercises: [
        { name: "World's greatest stretch", cue: "Each side, hold 30 sec" },
        { name: "Leg swings", cue: "Front-back, side-side" },
      ]},
      { kicker: "Breathwork", title: "Wim Hof rounds", durationSec: 180, exercises: [
        { name: "30 deep breaths", cue: "Full inhale, passive exhale" },
        { name: "Hold on empty", cue: "Until urge, then recover" },
      ]},
      { kicker: "Strength", title: "Lower body", durationSec: 180, exercises: [
        { name: "Bodyweight squats", cue: "20 reps, controlled descent" },
        { name: "Reverse lunges", cue: "10 each leg" },
      ]},
      { kicker: "Stretch", title: "Open the hips", durationSec: 120, exercises: [
        { name: "Pigeon pose", cue: "Each side, 30-45 sec" },
        { name: "Standing quad stretch", cue: "Each leg, 30 sec" },
      ]},
    ],
  },
  // Tuesday — sharpen focus
  {
    name: "Sharpen",
    segments: [
      { kicker: "Mobility", title: "Thoracic spine", durationSec: 120, exercises: [
        { name: "Thread the needle", cue: "Each side, slow rotation" },
        { name: "Open book", cue: "On side, top arm sweeps over" },
      ]},
      { kicker: "Breathwork", title: "4-7-8 breathing", durationSec: 180, exercises: [
        { name: "Inhale 4", cue: "Through the nose" },
        { name: "Hold 7", cue: "Soft, no tension" },
        { name: "Exhale 8", cue: "Through the mouth, slow" },
      ]},
      { kicker: "Strength", title: "Push power", durationSec: 180, exercises: [
        { name: "Push-ups", cue: "15 reps, full range" },
        { name: "Pike push-ups", cue: "10 reps, target shoulders" },
      ]},
      { kicker: "Stretch", title: "Upper body release", durationSec: 120, exercises: [
        { name: "Doorway chest stretch", cue: "Each arm, 30 sec" },
        { name: "Cross-body shoulder", cue: "Each side, 30 sec" },
      ]},
    ],
  },
  // Wednesday — even keel
  {
    name: "Even Keel",
    segments: [
      { kicker: "Mobility", title: "Full body flow", durationSec: 120, exercises: [
        { name: "Standing roll-down", cue: "Vertebra by vertebra, slow" },
        { name: "Side bends", cue: "Reach over, breathe wide" },
      ]},
      { kicker: "Breathwork", title: "Coherent breathing", durationSec: 180, exercises: [
        { name: "5 sec in, 5 sec out", cue: "Steady, equal rhythm" },
        { name: "Through the nose", cue: "Settle the nervous system" },
      ]},
      { kicker: "Strength", title: "Posterior chain", durationSec: 180, exercises: [
        { name: "Single-leg deadlift", cue: "10 each leg, no weight" },
        { name: "Superman holds", cue: "10 sec × 5" },
      ]},
      { kicker: "Stretch", title: "Decompress", durationSec: 120, exercises: [
        { name: "Lying spinal twist", cue: "Each side, 30-45 sec" },
        { name: "Happy baby", cue: "Hold knees, gentle rock" },
      ]},
    ],
  },
  // Thursday — push day
  {
    name: "Push Through",
    segments: [
      { kicker: "Mobility", title: "Dynamic warm-up", durationSec: 120, exercises: [
        { name: "Inchworms", cue: "Walk hands out, walk in. ×6" },
        { name: "Arm circles", cue: "Forward 30 sec, back 30" },
      ]},
      { kicker: "Breathwork", title: "Energy breath", durationSec: 180, exercises: [
        { name: "Bellows breath", cue: "30 fast in-out, then rest" },
        { name: "Recover slowly", cue: "Long exhale, soft eyes" },
      ]},
      { kicker: "Strength", title: "Full-body burn", durationSec: 180, exercises: [
        { name: "Burpees", cue: "8 reps at moderate pace" },
        { name: "Mountain climbers", cue: "30 sec, controlled" },
      ]},
      { kicker: "Stretch", title: "Cool down", durationSec: 120, exercises: [
        { name: "Standing forward fold", cue: "Hang, sway gently" },
        { name: "Seated wide stretch", cue: "Lean forward, breathe" },
      ]},
    ],
  },
  // Friday — clarity
  {
    name: "Clarity",
    segments: [
      { kicker: "Mobility", title: "Spinal waves", durationSec: 120, exercises: [
        { name: "Standing cat-cow", cue: "Hands on knees, articulate" },
        { name: "Hip circles", cue: "Each direction, 30 sec" },
      ]},
      { kicker: "Breathwork", title: "Alternate nostril", durationSec: 180, exercises: [
        { name: "Right thumb closes right", cue: "Inhale left, switch, exhale right" },
        { name: "Continue switching", cue: "5-6 full cycles" },
      ]},
      { kicker: "Strength", title: "Core stability", durationSec: 180, exercises: [
        { name: "Dead bug", cue: "10 each side, slow" },
        { name: "Side plank", cue: "30 sec each side" },
      ]},
      { kicker: "Stretch", title: "Long holds", durationSec: 120, exercises: [
        { name: "Hamstring stretch", cue: "Each leg, 45 sec" },
        { name: "Figure-4 stretch", cue: "Each side, 30-45 sec" },
      ]},
    ],
  },
  // Saturday — long flow
  {
    name: "Long Flow",
    segments: [
      { kicker: "Mobility", title: "Sun salutation", durationSec: 120, exercises: [
        { name: "Slow flow", cue: "Mountain → forward fold → plank → up dog → down dog" },
        { name: "Repeat 3 rounds", cue: "Match breath to movement" },
      ]},
      { kicker: "Breathwork", title: "Deep belly breathing", durationSec: 180, exercises: [
        { name: "Hand on belly", cue: "Inhale fills belly first" },
        { name: "Long slow exhale", cue: "Twice as long as inhale" },
      ]},
      { kicker: "Strength", title: "Mixed circuit", durationSec: 180, exercises: [
        { name: "Squat → push-up → plank", cue: "5 reps of each, 2 rounds" },
      ]},
      { kicker: "Stretch", title: "Restorative", durationSec: 120, exercises: [
        { name: "Legs up the wall", cue: "60-90 seconds" },
        { name: "Reclined butterfly", cue: "Open hips, breathe deep" },
      ]},
    ],
  },
];

// Pick today's routine deterministically by day of week
const todayRoutine = () => ROUTINES[new Date().getDay() % ROUTINES.length];

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
        text: "Citadel rotating into nuclear: VST, CEG, OKLO",
        ticker: "OKLO",
        source_url: "https://hedgefollow.com/funds/Citadel+Advisors+LLC",
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
    ],
  },
  conviction_watch: (portfolio.slice(0, 5).length ? portfolio.slice(0, 5) : ["SPY", "QQQ", "AAPL"]).map((t, i) => ({
    ticker: t,
    signal: ["hold", "add", "hold", "trim", "hold"][i] || "hold",
    note: ["Hold through earnings.", "Add on weakness.", "Thesis intact.", "Lock in gains.", "Steady core."][i] || "Steady core.",
  })),
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
  const [error, setError] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showPremium, setShowPremium] = useState(false);
  const [tickerInput, setTickerInput] = useState("");
  const [tempName, setTempName] = useState("");
  const [tempPortfolio, setTempPortfolio] = useState([]);
  const [filter, setFilter] = useState("all"); // all | health | wealth | clarity
  const [showCsvImport, setShowCsvImport] = useState(false);
  const [csvImportMessage, setCsvImportMessage] = useState(null);
  const [completedDecisions, setCompletedDecisions] = useState({}); // { "2026-04-29": [0, 2] }
  const [routineDays, setRoutineDays] = useState({}); // { "2026-04-29": true }
  const [routineFlowOpen, setRoutineFlowOpen] = useState(false);
  const [expandedMindset, setExpandedMindset] = useState(null); // 'gratitude' | 'fuel' | 'focus' | null

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
        setRoutineDays(progress.routineDays || {});
      }

      // Load holdings (full position data)
      const h = await Store.get("me-holdings");
      if (h) {
        setHoldings(h.holdings || []);
        setHoldingsRefreshedAt(h.refreshedAt || null);
      }
    })();
  }, []);

  useEffect(() => {
    if (phase === "app") Store.set("me-user", { name, portfolio });
  }, [name, portfolio, phase]);

  useEffect(() => {
    if (phase === "app") Store.set("me-progress", { completedDecisions, routineDays });
  }, [completedDecisions, routineDays, phase]);

  useEffect(() => {
    if (phase === "app" && holdings.length > 0) {
      Store.set("me-holdings", { holdings, refreshedAt: holdingsRefreshedAt });
    }
  }, [holdings, holdingsRefreshedAt, phase]);

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
  };
  const decisionsDoneToday = completedDecisions[todayKey] || [];

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

  const callAPI = async () => {
    const response = await fetch("/api/brief", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name || "the user",
        watchlist: portfolio,
        holdings: holdings, // Full position data (symbol, qty, cost, value, gainPct)
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

  const extractJSON = (data) => {
    if (!data || !data.brief) throw new Error("No brief in response");
    return data.brief;
  };

  const generateBrief = async () => {
    setLoading(true); setError(null);
    try {
      const data = await callAPI();
      const fresh = extractJSON(data);
      setBrief(fresh);
      // Auto-save brief by date for future history feature
      try {
        const history = (await Store.get("me-briefs")) || {};
        history[todayKey] = { brief: fresh, savedAt: Date.now() };
        // Keep only last 30 days
        const keys = Object.keys(history).sort().slice(-30);
        const trimmed = {};
        keys.forEach((k) => { trimmed[k] = history[k]; });
        await Store.set("me-briefs", trimmed);
      } catch {}
    } catch (e) {
      console.warn("Live API failed:", e);
      setBrief(buildDemoBrief(name, portfolio, holdings));
      setError("Live data unavailable — showing sample brief.");
    } finally { setLoading(false); }
  };

  const showDemo = () => { setError(null); setBrief(buildDemoBrief(name, portfolio, holdings)); };

  const shareBrief = async () => {
    if (!brief) return;
    const lines = [
      `☀️ Morning Edge — ${today}`,
      "",
      brief.affirmation ? `"${brief.affirmation}"` : "",
      "",
      brief.market_pulse ? `📊 ${brief.market_pulse.tone.toUpperCase()}: ${brief.market_pulse.summary}` : "",
      "",
      brief.decisions && brief.decisions.length ? "Today's Playbook:" : "",
      ...(brief.decisions || []).map((d, i) => `${i + 1}. ${d}`),
      "",
      "— Generated by Morning Edge",
    ].filter(Boolean);
    const text = lines.join("\n");
    try {
      if (navigator.share) {
        await navigator.share({ title: "Morning Edge — Today's Brief", text });
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
    await Store.del("me-briefs");
    setName(""); setPortfolio([]); setHoldings([]); setHoldingsRefreshedAt(null);
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
  const handleCsvUpload = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setCsvImportMessage(null);
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
        const splitRow = (s) => s.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
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
        const gainCol = findCol(/total.*gain.*%|gain.*loss.*%|^gain.*%|%.*gain|return.*%/);

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

        // Deduplicate holdings: if same symbol uploaded twice, keep the last (newer) entry
        const merged = {};
        // Keep prior holdings that aren't being re-uploaded
        for (const h of holdings) {
          if (!tickers.has(h.symbol)) merged[h.symbol] = h;
        }
        for (const h of newHoldings) merged[h.symbol] = h;
        const finalHoldings = Object.values(merged);

        setHoldings(finalHoldings);
        setHoldingsRefreshedAt(Date.now());
        // Also update tickers-only watchlist for compatibility with rest of app
        setPortfolio(Array.from(new Set([...portfolio, ...tickers])));

        // Build a friendly success message
        const withQty = newHoldings.filter((h) => h.qty != null).length;
        const withCost = newHoldings.filter((h) => h.cost != null).length;
        let msg = `Imported ${newHoldings.length} position${newHoldings.length === 1 ? "" : "s"}.`;
        if (withQty === 0) {
          msg += " Tickers only — couldn't detect share counts.";
        } else if (withCost === 0) {
          msg += ` ${withQty} with shares (no cost basis detected).`;
        } else {
          msg += ` ${withQty} with shares, ${withCost} with cost basis.`;
        }
        setCsvImportMessage({ type: "ok", text: msg });
      } catch (err) {
        setCsvImportMessage({ type: "error", text: "Couldn't parse that file. Make sure it's a CSV." });
      }
    };
    reader.onerror = () => setCsvImportMessage({ type: "error", text: "File read failed." });
    reader.readAsText(file);
    // Reset input so same file can be re-uploaded
    e.target.value = "";
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
    conviction: filter === "all" || filter === "wealth",
    mindset: filter === "all" || filter === "health",
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
    conviction: { gradient: "from-emerald-500 to-teal-600",  tint: "from-emerald-50 to-teal-50",  bar: "from-emerald-500 to-teal-600" },
    mindset:    { gradient: "from-rose-400 to-pink-500",     tint: "from-rose-50 to-pink-50",     bar: "from-rose-400 to-pink-500" },
    play:       { gradient: "from-indigo-500 to-violet-600", tint: "from-indigo-50 to-violet-50", bar: "from-indigo-500 to-violet-600" },
  };

  // ─── Loading splash ──────────────────────────────────────────────
  if (phase === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-sky-100 to-slate-200" style={{ fontFamily: SANS }}>
        <Sparkles className="w-8 h-8 text-slate-500 animate-pulse" />
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
            style={{ background: "linear-gradient(135deg, #1E40AF 0%, #0E7490 50%, #047857 100%)" }}>
            <span className="text-white text-2xl font-bold tracking-tight" style={{ fontFamily: SERIF, fontStyle: "italic" }}>ME</span>
          </div>
          <p className="text-base font-bold text-slate-900 tracking-wide mb-1" style={{ fontFamily: SERIF }}>Morning Edge</p>
          <p className="text-[11px] tracking-[0.25em] uppercase font-semibold text-slate-700 mb-8">by T-SPOT</p>

          <div className="flex gap-2 mb-8">
            <div className={`h-1.5 rounded-full transition-all ${phase === "onboard-1" ? "w-8 bg-slate-900" : "w-2 bg-slate-400"}`} />
            <div className={`h-1.5 rounded-full transition-all ${phase === "onboard-2" ? "w-8 bg-slate-900" : "w-2 bg-slate-400"}`} />
          </div>

          {phase === "onboard-1" && (
            <div className="w-full bg-white rounded-3xl p-6 shadow-xl border border-slate-100">
              <h1 className="text-3xl text-slate-900 mb-2 leading-tight" style={{ fontFamily: SERIF, fontWeight: 500 }}>
                Welcome <span className="italic text-slate-700">aboard.</span>
              </h1>
              <p className="text-sm text-slate-500 mb-5 leading-relaxed">
                30-second setup. Your data stays on your device.
              </p>
              <label className="text-[11px] uppercase tracking-widest text-slate-500 font-semibold mb-2 block">What should we call you?</label>
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
                  tempName.trim() ? "bg-slate-900 text-white hover:bg-slate-800" : "bg-slate-200 text-slate-400"
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
              <p className="text-sm text-slate-500 mb-5">Add tickers you track. Edit anytime.</p>
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
                  className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-slate-900 focus:bg-white"
                />
                <button
                  onClick={() => {
                    const t = tickerInput.trim().toUpperCase();
                    if (t && !tempPortfolio.includes(t)) setTempPortfolio([...tempPortfolio, t]);
                    setTickerInput("");
                  }}
                  className="px-4 py-2.5 bg-slate-900 text-white rounded-xl font-semibold text-sm">Add</button>
              </div>
              <p className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold mb-2">Suggestions</p>
              <div className="flex flex-wrap gap-1.5 mb-4">
                {SUGGESTED.filter((s) => !tempPortfolio.includes(s)).map((s) => (
                  <button key={s} onClick={() => setTempPortfolio([...tempPortfolio, s])}
                    className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200">
                    + {s}
                  </button>
                ))}
              </div>
              {tempPortfolio.length > 0 && (
                <>
                  <p className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold mb-2">Your picks ({tempPortfolio.length})</p>
                  <div className="flex flex-wrap gap-1.5 mb-5">
                    {tempPortfolio.map((t) => (
                      <span key={t} className="inline-flex items-center gap-1 bg-slate-100 border border-slate-200 px-2 py-1 rounded-lg text-xs text-slate-800 font-medium">
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
                className="w-full py-2 mt-2 text-sm text-slate-500 hover:text-slate-900">← Back</button>
            </div>
          )}

          <p className="text-[10px] text-slate-700 mt-6 text-center max-w-xs leading-relaxed">
            Informational only — not investment, medical, or financial advice.
          </p>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════
  //                            MAIN APP
  // ════════════════════════════════════════════════════════════════════
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
              style={{ background: "linear-gradient(135deg, #1E40AF 0%, #0E7490 60%, #047857 100%)" }}>
              <span className="text-white text-base font-bold tracking-tight" style={{ fontFamily: SERIF, fontStyle: "italic" }}>ME</span>
            </div>
            <div>
              <p className="text-base font-bold text-slate-900 tracking-wide leading-tight" style={{ fontFamily: SERIF }}>Morning Edge</p>
              <p className="text-[10px] tracking-[0.25em] uppercase font-semibold text-slate-600">by T-SPOT</p>
            </div>
          </div>
          <div className="flex gap-2">
            {brief && (
              <button onClick={shareBrief}
                className="p-2.5 rounded-full bg-white border border-slate-200 shadow-md"
                aria-label="Share">
                <Share2 className="w-4 h-4 text-slate-700" />
              </button>
            )}
            <button onClick={() => setShowPremium(true)}
              className="p-2.5 rounded-full text-white shadow-md bg-gradient-to-br from-amber-500 to-orange-500"
              aria-label="Premium">
              <Crown className="w-4 h-4" />
            </button>
            <button onClick={() => setShowSettings(!showSettings)}
              className="p-2.5 rounded-full bg-white border border-slate-200 shadow-md"
              aria-label="Settings">
              <Settings className="w-4 h-4 text-slate-700" />
            </button>
          </div>
        </div>

        <h1 className="text-4xl leading-tight text-slate-900" style={{ fontFamily: SERIF, fontWeight: 500 }}>
          {greeting}{name ? `, ${name}` : ""},<br />
          <span className="italic text-slate-700">your morning edge.</span>
        </h1>
        <p className="text-[11px] text-slate-600 mt-3 tracking-[0.2em] uppercase font-medium">{today}</p>
      </header>

      {/* Movers ticker tape — streams biggest gainers/losers + unusual flow */}
      <TickerTape />

      {/* Filter pillars (now actual buttons) */}
      <div className="relative px-4 pb-4">
        <div className="grid grid-cols-4 gap-2">
          <FilterPill
            active={filter === "all"}
            onClick={() => setFilter("all")}
            icon={<LayoutGrid className="w-4 h-4" />}
            label="All"
            accent={{ bg: "bg-slate-900", text: "text-white", ring: "ring-slate-300", dot: "bg-slate-400" }}
          />
          <FilterPill
            active={filter === "health"}
            onClick={() => setFilter("health")}
            icon={<Heart className="w-4 h-4" />}
            label="Health"
            accent={{ bg: "bg-emerald-600", text: "text-white", ring: "ring-emerald-200", dot: "bg-emerald-500" }}
          />
          <FilterPill
            active={filter === "wealth"}
            onClick={() => setFilter("wealth")}
            icon={<TrendingUp className="w-4 h-4" />}
            label="Wealth"
            accent={{ bg: "bg-amber-600", text: "text-white", ring: "ring-amber-200", dot: "bg-amber-500" }}
          />
          <FilterPill
            active={filter === "clarity"}
            onClick={() => setFilter("clarity")}
            icon={<Sparkles className="w-4 h-4" />}
            label="Clarity"
            accent={{ bg: "bg-indigo-600", text: "text-white", ring: "ring-indigo-200", dot: "bg-indigo-500" }}
          />
        </div>
        <p className="text-[10px] text-slate-600 mt-2 italic text-center">Tap a pillar to focus your view.</p>
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

      {/* Settings */}
      {showSettings && (
        <section className="relative mx-4 mb-6 p-5 rounded-2xl bg-white shadow-md border border-slate-100">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-900">Settings</h2>
            <button onClick={() => setShowSettings(false)} className="text-slate-500 hover:text-slate-900">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="mb-4">
            <label className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold mb-1 block">Your name</label>
            <input value={name} onChange={(e) => setName(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-slate-900 focus:bg-white" />
          </div>
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <label className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">Watchlist</label>
              <span className="text-xs text-slate-500">{portfolio.length} tickers</span>
            </div>
            <div className="flex gap-2 mb-3">
              <input value={tickerInput} onChange={(e) => setTickerInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addTicker()}
                placeholder="Add ticker"
                className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-slate-900 focus:bg-white" />
              <button onClick={addTicker} className="px-4 py-2 bg-slate-900 text-white rounded-xl font-semibold text-sm">
                <Plus className="w-4 h-4" />
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {portfolio.map((t) => (
                <span key={t} className="inline-flex items-center gap-1 bg-slate-100 border border-slate-200 px-2 py-1 rounded-lg text-xs text-slate-800 font-medium">
                  {t}
                  <button onClick={() => removeTicker(t)} className="hover:text-rose-600">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          </div>
          <button onClick={resetAll}
            className="w-full py-2 rounded-xl text-xs text-rose-600 hover:bg-rose-50 border border-rose-200 font-semibold">
            Reset all data
          </button>
        </section>
      )}

      {/* Generate */}
      <div className="relative px-6 pb-6 space-y-2">
        <button
          onClick={generateBrief}
          disabled={loading}
          className={`w-full py-4 rounded-xl font-semibold tracking-wide flex items-center justify-center gap-2 transition shadow-lg ${
            loading ? "bg-slate-200 text-slate-500 shadow-none"
              : brief ? "bg-white text-slate-800 border border-slate-200 hover:shadow-xl"
              : "bg-slate-900 text-white hover:bg-slate-800"
          }`}
        >
          {loading ? <><RefreshCw className="w-4 h-4 animate-spin" />Reading the tape…</>
          : brief ? <><RefreshCw className="w-4 h-4" />Refresh My Brief</>
          : <><Sparkles className="w-5 h-5" />Generate Today's Brief</>}
        </button>
        {!brief && !loading && (
          <button onClick={showDemo}
            className="w-full py-3 rounded-xl bg-white text-slate-700 border border-slate-200 text-sm font-semibold flex items-center justify-center gap-2 shadow-md">
            <Eye className="w-4 h-4" />View Sample Brief
          </button>
        )}
        {error && (
          <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-xl flex gap-2 text-sm text-amber-800">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span className="break-words">{error}</span>
          </div>
        )}
      </div>

      {/* Loading skeleton — pretty placeholder cards */}
      {loading && !brief && (
        <main className="relative px-4 pb-16 space-y-4">
          {/* Affirmation skeleton */}
          <div className="rounded-3xl p-8 shadow-md border border-slate-100 bg-gradient-to-br from-amber-50 via-rose-50 to-violet-50">
            <div className="w-12 h-12 rounded-full mx-auto mb-4 bg-white/60 animate-pulse" />
            <div className="h-3 w-24 mx-auto mb-3 rounded bg-slate-200/60 animate-pulse" />
            <div className="h-5 w-3/4 mx-auto mb-2 rounded bg-slate-300/60 animate-pulse" />
            <div className="h-5 w-2/3 mx-auto rounded bg-slate-300/60 animate-pulse" />
          </div>
          {/* Card skeletons */}
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-2xl bg-white shadow-md border border-slate-100 overflow-hidden">
              <div className="h-12 bg-slate-100 animate-pulse" />
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
        <main className="relative px-4 pb-16 space-y-4">
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
                <p className="text-[10px] tracking-[0.35em] uppercase font-semibold mb-4"
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

          {visible.market_pulse && (
            <Card theme={themes.pulse}>
              <CardHeader icon={<Sun className="w-4 h-4" />} label="Market Pulse" theme={themes.pulse} />
              <div className="px-5 py-4">
                <div className="flex items-baseline gap-2 mb-3">
                  <span className={`text-2xl ${toneColor(brief.market_pulse.tone)}`} style={{ fontFamily: SERIF, fontWeight: 600 }}>{brief.market_pulse.tone}</span>
                  <span className="text-[10px] uppercase tracking-widest text-slate-500">tape read</span>
                </div>
                <p className="text-slate-700 leading-relaxed mb-4 text-[16px]" style={{ fontFamily: SERIF }}>{brief.market_pulse.summary}</p>
                <ul className="space-y-2">
                  {brief.market_pulse.key_levels.map((k, i) => (
                    <li key={i} className="flex gap-2 text-sm text-slate-700">
                      <span className="text-sky-500 font-bold">·</span><span>{k}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </Card>
          )}

          {visible.smart_money && (
            <Card theme={themes.money}>
              <CardHeader icon={<Eye className="w-4 h-4" />} label="Whales & Capitol Hill" theme={themes.money} />
              <div className="px-5 py-4">
                <h3 className="text-[10px] uppercase tracking-[0.2em] text-amber-700 font-semibold mb-2">Institutional</h3>
                <ul className="space-y-1.5 mb-5">
                  {brief.smart_money.whale_moves.map((w, i) => (
                    <SmartMoneyRow key={i} item={w} />
                  ))}
                </ul>
                <h3 className="text-[10px] uppercase tracking-[0.2em] text-amber-700 font-semibold mb-2">Congress (~30–45d delay)</h3>
                <ul className="space-y-1.5">
                  {brief.smart_money.congress_moves.map((c, i) => (
                    <SmartMoneyRow key={i} item={c} />
                  ))}
                </ul>
                <p className="mt-4 text-[10px] text-slate-500 leading-relaxed italic">
                  AI-summarized from public filings. Tap any row to verify at the source.
                </p>
              </div>
            </Card>
          )}

          {visible.conviction && (
            <Card theme={themes.conviction}>
              <CardHeader icon={<TrendingUp className="w-4 h-4" />} label="Conviction Watch" theme={themes.conviction} />
              <div className="p-3 space-y-2">
                {brief.conviction_watch.map((c, i) => (
                  <div key={i} className="rounded-xl p-3 bg-slate-50 border border-slate-100 flex items-start gap-3">
                    <span className={`px-2.5 py-1 rounded-lg text-[10px] uppercase tracking-wider border font-semibold flex items-center gap-1 ${signalStyle(c.signal)}`}>
                      {signalIcon(c.signal)}{c.signal}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-base font-semibold text-slate-900" style={{ fontFamily: SERIF }}>{c.ticker}</p>
                      <p className="text-xs text-slate-600 mt-0.5">{c.note}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Portfolio sync — CSV import from any brokerage */}
              <div className="px-3 pb-4 pt-1" data-csv-import-anchor>
                <button
                  onClick={() => setShowCsvImport(!showCsvImport)}
                  className={`w-full text-left text-sm font-semibold flex items-center justify-between py-3 px-4 rounded-lg transition border ${
                    showCsvImport
                      ? "bg-amber-50 border-amber-300 text-amber-900"
                      : "bg-white border-amber-200 text-slate-800 hover:border-amber-300 hover:bg-amber-50/40"
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <Briefcase className="w-4 h-4 text-amber-600" />
                    {showCsvImport ? "Close portfolio sync" : "Sync portfolio from brokerage"}
                  </span>
                  <span className="text-amber-600 text-lg leading-none font-light">{showCsvImport ? "−" : "+"}</span>
                </button>

                {showCsvImport && (
                  <div className="mt-3 px-3 py-3 rounded-lg bg-amber-50 border border-amber-100 text-xs text-slate-700 space-y-3">
                    <div>
                      <p className="font-semibold text-slate-900 mb-1.5">How to export your holdings as CSV</p>
                      <ul className="space-y-1.5 list-disc list-inside text-slate-600 leading-relaxed">
                        <li><b>Fidelity:</b> Portfolio → Positions → "Download" → CSV</li>
                        <li><b>Schwab:</b> Accounts → Positions → "Export" icon</li>
                        <li><b>Robinhood:</b> Account → History → Export account history</li>
                        <li><b>Webull:</b> Menu → Export Statements → Positions</li>
                        <li><b>E*Trade:</b> Portfolio → Download → CSV</li>
                        <li><b>Vanguard:</b> Holdings → "Download" → CSV</li>
                      </ul>
                    </div>

                    <label className="block">
                      <span className="block font-semibold text-slate-900 mb-1.5">Upload your CSV</span>
                      <input
                        type="file"
                        accept=".csv,text/csv"
                        onChange={handleCsvUpload}
                        className="block w-full text-xs text-slate-600
                          file:mr-3 file:py-2 file:px-3 file:rounded-md
                          file:border-0 file:text-xs file:font-semibold
                          file:bg-slate-900 file:text-white
                          hover:file:bg-slate-800 file:cursor-pointer
                          cursor-pointer"
                      />
                    </label>

                    {csvImportMessage && (
                      <div className={`px-3 py-2 rounded-md text-[11px] ${
                        csvImportMessage.type === "ok"
                          ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
                          : "bg-rose-100 text-rose-800 border border-rose-200"
                      }`}>
                        {csvImportMessage.text}
                      </div>
                    )}

                    {/* Holdings status — show what's loaded + freshness */}
                    {holdings.length > 0 && (
                      <div className={`px-3 py-2 rounded-md text-[11px] ${
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
                          <p className="text-[10px] mt-1">
                            ⚠ Data is stale — gain percentages may be off. Re-upload for accurate playbook recommendations.
                          </p>
                        )}
                        {holdingsAgeDays != null && holdingsAgeDays <= 7 && (
                          <p className="text-[10px] mt-1 text-slate-500">
                            Holdings power your personalized playbook. Re-upload weekly for best accuracy.
                          </p>
                        )}
                      </div>
                    )}

                    <p className="text-[10px] text-slate-500 leading-relaxed">
                      Holdings stay on your device. We only send them to generate today's brief — never stored on any server.
                    </p>
                  </div>
                )}
              </div>
            </Card>
          )}

          {visible.mindset && (
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
                  body={brief.mindset.fuel}
                  expanded={expandedMindset === "fuel"}
                  onToggle={() => setExpandedMindset(expandedMindset === "fuel" ? null : "fuel")}
                  detail={{
                    intent: `Today's routine: ${todayRoutine().name}. Four segments, ten minutes total.`,
                    segments: todayRoutine().segments,
                    showStartButton: true,
                    onStart: () => setRoutineFlowOpen(true),
                  }}
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
                      className={`flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold transition flex items-center justify-center gap-2 ${
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
                    <p className="text-[11px] text-emerald-700 text-center mt-2 italic">
                      🔥 {routineStreak}-day streak. Keep showing up.
                    </p>
                  )}
                </div>
              </div>
            </Card>
          )}

          {/* PLAYBOOK — tappable check-offs that persist per day */}
          {visible.decisions && (
            <Card theme={themes.play}>
              <CardHeader icon={<CheckSquare className="w-4 h-4" />} label="Today's Playbook" theme={themes.play} />
              <div className="px-5 py-6">
                {/* Personalization indicator */}
                {holdings.length > 0 ? (
                  <div className="mb-4 flex items-center gap-2 text-[10px] tracking-wider uppercase font-semibold">
                    <span className="px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 border border-violet-200">
                      ✓ Personalized
                    </span>
                    <span className="text-slate-500">
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
                        <p className="text-[10px] tracking-[0.25em] uppercase font-bold mb-1"
                          style={{ color: "#D4A574" }}>
                          Unlock Personalized Playbook
                        </p>
                        <p className="text-[15px] font-semibold leading-snug"
                          style={{ color: "#F8FAFC", fontFamily: SERIF }}>
                          Sync your portfolio for trade recommendations built on your actual positions.
                        </p>
                      </div>
                      <ArrowRight className="w-5 h-5 flex-shrink-0 transition-transform group-hover:translate-x-0.5"
                        style={{ color: "#D4A574" }} />
                    </div>
                    <p className="text-[11px] text-slate-400 mt-3 ml-14 leading-relaxed">
                      Tap to open. Upload a CSV from any brokerage. Holdings stay on your device.
                    </p>
                  </button>
                )}

                {/* Progress bar */}
                <div className="flex items-center justify-between mb-5">
                  <p className="text-[10px] tracking-[0.2em] uppercase font-semibold text-slate-500">
                    {decisionsDoneToday.length} of {brief.decisions.length} done
                  </p>
                  <div className="flex-1 ml-3 h-1 rounded-full bg-slate-100 overflow-hidden">
                    <div className="h-full bg-emerald-500 transition-all duration-300"
                      style={{ width: `${brief.decisions.length ? (decisionsDoneToday.length / brief.decisions.length) * 100 : 0}%` }} />
                  </div>
                </div>

                <ol className="space-y-4">
                  {brief.decisions.map((d, i) => {
                    const done = decisionsDoneToday.includes(i);
                    return (
                      <li key={i}>
                        <div className={`flex items-start gap-2 p-2 -mx-2 rounded-xl transition ${
                          done ? "bg-emerald-50/60" : "hover:bg-slate-50"
                        }`}>
                          {/* Main tappable area: number/check + decision text */}
                          <button
                            onClick={() => toggleDecision(i)}
                            className="flex-1 text-left flex items-start gap-3 group min-w-0"
                          >
                            {/* Custom checkbox / number */}
                            <span className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center transition ${
                              done
                                ? "bg-emerald-500 text-white"
                                : "border-2 border-slate-200 text-slate-300 group-hover:border-slate-300"
                            }`}>
                              {done ? (
                                <CheckSquare className="w-3.5 h-3.5" />
                              ) : (
                                <span className="text-base font-light leading-none" style={{ fontFamily: SERIF }}>{i + 1}</span>
                              )}
                            </span>
                            <span className={`flex-1 text-base leading-snug pt-1 transition ${
                              done ? "text-slate-400 line-through" : "text-slate-800"
                            }`} style={{ fontFamily: SERIF }}>
                              {d}
                            </span>
                          </button>
                          {/* Add to Calendar button — separate, doesn't toggle done */}
                          <button
                            onClick={(e) => { e.stopPropagation(); addDecisionToCalendar(d, i); }}
                            className="flex-shrink-0 p-2 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 active:bg-emerald-100 transition"
                            aria-label="Add to calendar"
                            title="Add to calendar"
                          >
                            <CalendarPlus className="w-4 h-4" />
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ol>

                {/* Helper text */}
                <p className="mt-4 text-[10px] text-slate-400 text-center italic">
                  Tap a row to mark complete · Tap <CalendarPlus className="w-3 h-3 inline -mt-0.5" /> to add to your calendar
                </p>

                {/* Completion celebration */}
                {brief.decisions.length > 0 && decisionsDoneToday.length === brief.decisions.length && (
                  <div className="mt-5 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-center">
                    <p className="text-sm font-semibold text-emerald-800" style={{ fontFamily: SERIF }}>
                      ✓ Day complete. You did the work.
                    </p>
                  </div>
                )}
              </div>
            </Card>
          )}

          <SignatureFooter verified={sigVerified} hash={sigHash} />
        </main>
      )}

      {/* Empty state */}
      {!brief && !loading && (
        <div className="relative px-6 pb-16">
          <div className="rounded-3xl p-8 text-center bg-white shadow-md border border-slate-100" style={{ fontFamily: SERIF }}>
            <div className="w-12 h-12 rounded-2xl mx-auto mb-4 flex items-center justify-center shadow-md"
              style={{ background: "linear-gradient(135deg, #1E40AF 0%, #0E7490 50%, #047857 100%)" }}>
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <p className="text-2xl leading-snug text-slate-800 mb-2">Slow rhythm. <span className="italic">Sharp moves.</span></p>
            <p className="text-sm text-slate-500" style={{ fontFamily: SANS }}>
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
function SmartMoneyRow({ item }) {
  // Graceful fallback if item is still a string (older briefs)
  if (typeof item === "string") {
    return (
      <li className="text-sm flex gap-2 text-slate-700">
        <span className="text-amber-500 font-bold">·</span>
        <span>{item}</span>
      </li>
    );
  }
  const { text, ticker, source_url } = item || {};
  const RowInner = (
    <>
      {ticker && (
        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider bg-amber-100 text-amber-800 border border-amber-200 flex-shrink-0">
          {ticker}
        </span>
      )}
      <span className="flex-1 text-slate-700 leading-snug">{text}</span>
      {source_url && (
        <ArrowUpRight className="w-3.5 h-3.5 flex-shrink-0 text-amber-500 mt-0.5" />
      )}
    </>
  );
  if (source_url) {
    return (
      <li>
        <a
          href={source_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm flex items-start gap-2 px-2 py-1.5 -mx-2 rounded-lg hover:bg-amber-50 active:bg-amber-100 transition cursor-pointer"
        >
          {RowInner}
        </a>
      </li>
    );
  }
  return (
    <li className="text-sm flex items-start gap-2 px-2 py-1.5 -mx-2">{RowInner}</li>
  );
}

function TickerTape() {
  // Demo data — realistic high-flow movers. Replace with live API in Phase 2.
  const movers = [
    { symbol: "NVDA", change: +3.42, flow: "high" },
    { symbol: "TSLA", change: -4.18, flow: "dip" },
    { symbol: "AAPL", change: +1.87, flow: "normal" },
    { symbol: "META", change: +2.94, flow: "high" },
    { symbol: "MSFT", change: -2.11, flow: "dip" },
    { symbol: "GOOGL", change: +2.35, flow: "high" },
    { symbol: "AMZN", change: -3.76, flow: "dip" },
    { symbol: "AMD", change: +5.22, flow: "high" },
    { symbol: "IONQ", change: -7.88, flow: "dip" },
    { symbol: "OKLO", change: +6.14, flow: "high" },
    { symbol: "PLTR", change: +4.05, flow: "high" },
    { symbol: "COIN", change: -3.41, flow: "dip" },
    { symbol: "MU", change: +3.89, flow: "high" },
    { symbol: "VRT", change: -2.67, flow: "dip" },
    { symbol: "SMCI", change: +8.21, flow: "high" },
  ];

  // Duplicate the list so the marquee loops seamlessly
  const stream = [...movers, ...movers];

  return (
    <div className="relative -mt-2 mb-3 mx-3 rounded-xl border border-slate-200 bg-white/85 backdrop-blur-sm overflow-hidden shadow-sm">
      <div className="flex items-center">
        {/* Label badge */}
        <div className="flex-shrink-0 px-3 py-2 bg-slate-900 text-white">
          <p className="text-[9px] font-bold tracking-[0.18em] uppercase">Movers</p>
        </div>
        {/* Scrolling track */}
        <div className="flex-1 overflow-hidden relative">
          <div
            className="flex items-center gap-5 py-2 whitespace-nowrap"
            style={{
              animation: "ticker-slide 50s linear infinite",
              width: "max-content",
            }}
          >
            {stream.map((m, i) => {
              const up = m.change >= 0;
              const isHigh = m.flow === "high";
              const isDip = m.flow === "dip";
              return (
                <div key={i} className="flex items-center gap-1.5 text-xs font-semibold">
                  {/* Flow kicker symbol */}
                  {isHigh && <span className="text-emerald-600 text-[10px]">▲▲</span>}
                  {isDip && <span className="text-rose-600 text-[10px]">▼▼</span>}
                  <span className="text-slate-900 tracking-tight">{m.symbol}</span>
                  <span className={up ? "text-emerald-600" : "text-rose-600"}>
                    {up ? "+" : ""}{m.change.toFixed(2)}%
                  </span>
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
      <span className="text-[10px] font-bold uppercase tracking-[0.12em]">{label}</span>
    </button>
  );
}

function PremiumModal({ onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl relative">
        <button onClick={onClose} className="absolute top-4 right-4 text-slate-500 hover:text-slate-900">
          <X className="w-5 h-5" />
        </button>
        <div className="w-12 h-12 rounded-xl mb-4 flex items-center justify-center shadow-md bg-gradient-to-br from-amber-500 to-orange-500">
          <Crown className="w-6 h-6 text-white" />
        </div>
        <h3 className="text-2xl mb-1 text-slate-900" style={{ fontFamily: SERIF, fontWeight: 600 }}>
          Morning Edge <span className="italic">Premium</span>
        </h3>
        <p className="text-sm text-slate-500 mb-5">Your edge, multiplied.</p>
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
                <p className="text-sm font-semibold text-slate-900">{title}</p>
                <p className="text-xs text-slate-500">{desc}</p>
              </div>
            </li>
          ))}
        </ul>
        <button className="w-full py-3.5 rounded-xl font-semibold text-white shadow-lg flex items-center justify-center gap-2 bg-gradient-to-r from-amber-500 to-orange-500">
          <Lock className="w-4 h-4" /> Join the waitlist
        </button>
        <p className="text-[10px] text-slate-500 text-center mt-3">Coming soon.</p>
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
      <h2 className="text-[11px] uppercase tracking-[0.22em] text-slate-800 font-bold">{label}</h2>
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
        <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500 font-semibold mb-1">{kicker}</p>
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
          <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500 font-semibold mb-1 flex items-center gap-2">
            {kicker}
            <span className="text-slate-300 text-base leading-none">{expanded ? "−" : "+"}</span>
          </p>
          <p className="text-[16px] leading-relaxed text-slate-800" style={{ fontFamily: SERIF }}>{body}</p>
        </div>
      </button>

      {expanded && (
        <div className={`mt-2 ml-12 mr-2 p-4 rounded-xl border ${c.panel}`}>
          {detail.intent && (
            <p className="text-[12px] text-slate-700 leading-relaxed mb-3 italic" style={{ fontFamily: SERIF }}>
              {detail.intent}
            </p>
          )}
          {detail.why && (
            <p className="text-[12px] text-slate-700 leading-relaxed mb-3">
              {detail.why}
            </p>
          )}
          {detail.segments && (
            <div className="space-y-2 mb-3">
              {detail.segments.map((seg, i) => (
                <div key={i} className="flex items-start gap-2 text-[12px]">
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
          {detail.action && (
            <p className="text-[11px] text-slate-600 leading-relaxed">
              → {detail.action}
            </p>
          )}
          {detail.showStartButton && (
            <button
              onClick={detail.onStart}
              className="mt-3 w-full px-4 py-2.5 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 active:bg-slate-700 transition flex items-center justify-center gap-2"
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
            <p className="text-[10px] tracking-[0.2em] uppercase font-semibold text-slate-500">
              {routine.name} · Step {segIdx + 1} of {routine.segments.length}
            </p>
            <p className="text-base font-bold text-slate-900 mt-0.5">{segment.kicker}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-100" aria-label="Close">
            <X className="w-5 h-5 text-slate-500" />
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
          <p className="text-[10px] tracking-[0.25em] uppercase font-semibold mb-1" style={{ color: segColor }}>
            {segment.kicker}
          </p>
          <h2 className="text-3xl text-slate-900 mb-6" style={{ fontFamily: SERIF, fontWeight: 500 }}>
            {segment.title}
          </h2>

          {/* Big timer */}
          <div className="text-center my-6">
            <p className="text-7xl font-light tabular-nums text-slate-900" style={{ fontFamily: SERIF }}>
              {String(minutes).padStart(1, "0")}:{String(seconds).padStart(2, "0")}
            </p>
            <button
              onClick={() => setRunning(!running)}
              className="mt-4 px-5 py-2.5 rounded-full text-sm font-semibold transition shadow-md"
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
                <span className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold text-white"
                  style={{ backgroundColor: segColor }}>
                  {i + 1}
                </span>
                <div className="flex-1">
                  <p className="text-[14px] font-semibold text-slate-900">{ex.name}</p>
                  <p className="text-[12px] text-slate-600 mt-0.5">{ex.cue}</p>
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
            className={`px-4 py-2.5 rounded-xl text-sm font-semibold transition ${
              segIdx === 0 ? "text-slate-300" : "text-slate-700 hover:bg-slate-100 active:bg-slate-200"
            }`}
          >
            Back
          </button>
          <button
            onClick={next}
            className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition shadow-md"
            style={{ backgroundColor: segColor }}
          >
            {isLast ? "Complete routine" : "Next segment →"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SignatureFooter({ verified, hash, compact }) {
  return (
    <footer className={compact ? "pt-6 text-center" : "pt-8 text-center"}>
      {!compact && (
        <p className="text-[11px] text-slate-700 max-w-md mx-auto leading-relaxed px-4">
          Informational only. Not investment, medical, or financial advice. Your data stays on your device.
        </p>
      )}
      <div className={`mt-4 inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-[10px] font-bold tracking-wider uppercase ${
        verified ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-rose-50 border-rose-200 text-rose-700"
      }`}>
        {verified ? <ShieldCheck className="w-3 h-3" /> : <ShieldAlert className="w-3 h-3" />}
        {verified ? "Signed · TP·ME·2026" : "MODIFIED"}
      </div>
      <p className="text-[9px] text-slate-600 mt-1.5 font-mono tracking-wider">© 2026 T-SPOT · sha {hash}</p>
    </footer>
  );
}
