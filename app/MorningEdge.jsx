'use client';

// app/MorningEdge.jsx
// =====================================================================
// Morning Edge 3 — calm, motivating, mobile-first start to the day.
//
// Major changes vs. v2:
//   1.  Streaming brief (SSE from /api/brief). Cards reveal as they
//       generate. No 30-second spinners.
//   2.  Sync box at top is roughly half its previous footprint and
//       collapses to a one-line summary once at least one account
//       is on file.
//   3.  Scrolling ticker is richer — symbol + a real take if the
//       brief has one for that name, plus account count + last sync.
//   4.  Brokerage section is device-aware: desktop gets working
//       broker login links; mobile shows an honest "open this on
//       your computer to upload your CSV" message.
//   5.  Outbound-link return pill: small, top-right, auto-hides,
//       does not block cookie banners or page content on the
//       broker site.
//   6.  External links audited — only real, working URLs ship.
//   7.  Exercise rewritten in plain step-by-step English for
//       middle-aged users with limited mobility. No stick figures.
//   8.  Each playbook item has Accept (✓) and Dismiss (✕) buttons.
//   9.  Body text is 17px minimum, headers larger. High-contrast
//       slate / parchment palette. Subtle dark mode for early eyes.
//  10.  Pull-to-refresh replaces the visible refresh button. Native
//       iOS feel. No anxiety-inducing reminders that data is stale.
//  11.  Multi-account CSV import. Each upload is labeled by the
//       user (free text). Holdings track the account they belong
//       to. Playbook calls out the account by name so the user
//       knows exactly where to act. Accounts can be edited or
//       deleted later without losing the others.
//
// Plus:
//   • First-run onboarding overlay
//   • Empty states for every card
//   • Honest error states ("we'll try again on your next pull")
//   • Loading shimmer for streaming cards
//   • Charity messaging (future-tense, no overpromise)
//   • Privacy reinforcement on the CSV section
// =====================================================================

import {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
} from 'react';
import {
  Sparkles, Wallet, Heart, Compass, Sun, Moon, ChevronDown,
  ChevronUp, Upload, X, Check, Trash2, Pencil, Lock, ArrowRight,
  Coffee, ExternalLink, Info, Plus, Settings, AlertCircle,
  Wind, RefreshCw,
} from 'lucide-react';

// ---------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------

const STORAGE_KEYS = {
  user: 'me_user',
  watchlist: 'me_watchlist',
  accounts: 'me_accounts',
  holdings: 'me_holdings',
  dismissed: 'me_playbook_dismissed',
  accepted: 'me_playbook_accepted',
  darkMode: 'me_dark_mode',
  onboarded: 'me_onboarded_v3',
  legacyHoldings: 'me_holdings', // for migration check
};

const BROKERS = [
  {
    id: 'fidelity',
    name: 'Fidelity',
    loginUrl: 'https://digital.fidelity.com/prgw/digital/login/full-page',
    exportPath: 'Accounts → Activity & Orders → Positions → "Download" (top-right)',
    fileLabel: 'Portfolio_Positions_*.csv',
  },
  {
    id: 'schwab',
    name: 'Charles Schwab',
    loginUrl: 'https://www.schwab.com/client-home',
    exportPath: 'Accounts → Positions → "Export" link above the table',
    fileLabel: 'Positions-*.csv',
  },
  {
    id: 'robinhood',
    name: 'Robinhood',
    loginUrl: 'https://robinhood.com/login',
    exportPath: 'Account (top-right) → Reports & statements → Account → "Generate report"',
    fileLabel: 'rh_holdings_*.csv',
  },
  {
    id: 'etrade',
    name: 'E*TRADE',
    loginUrl: 'https://us.etrade.com/e/t/user/login',
    exportPath: 'Accounts → Portfolios → "Download" (gear icon, top-right of holdings)',
    fileLabel: 'Portfolio_*.csv',
  },
  {
    id: 'vanguard',
    name: 'Vanguard',
    loginUrl: 'https://logon.vanguard.com/logon',
    exportPath: 'My Accounts → Holdings → "Download" link',
    fileLabel: 'OfxDownload.csv',
  },
  {
    id: 'webull',
    name: 'Webull',
    loginUrl: 'https://www.webull.com/center',
    exportPath: 'Account Center → Statements → Export holdings',
    fileLabel: 'webull_*.csv',
  },
  {
    id: 'other',
    name: 'Other (401k, 529, anything else)',
    loginUrl: null,
    exportPath: 'Most plan websites have an "export" or "download" option on the holdings page.',
    fileLabel: 'any .csv',
  },
];

const RESEARCH_LINKS = [
  {
    name: 'Congressional Trades (Capitol Trades)',
    url: 'https://www.capitoltrades.com/trades',
    blurb: 'Live disclosure feed — 45-day STOCK Act delay applies.',
  },
  {
    name: 'SEC EDGAR Full-Text Search',
    url: 'https://efts.sec.gov/LATEST/search-index?q=&dateRange=custom',
    blurb: '8-K, 10-Q, S-1 filings the moment they post.',
  },
  {
    name: 'FINRA BrokerCheck',
    url: 'https://brokercheck.finra.org/',
    blurb: 'Verify any advisor or broker before you trust them.',
  },
  {
    name: 'Yahoo Finance Earnings Calendar',
    url: 'https://finance.yahoo.com/calendar/earnings',
    blurb: 'Who reports this week, with consensus estimates.',
  },
  {
    name: 'Federal Reserve Calendar',
    url: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',
    blurb: 'FOMC meeting dates and minutes release schedule.',
  },
];

// 6-day rotating routine. Day 0 = Sunday.
// Each routine targets ~10 minutes total. Plain English. Designed
// for users with limited mobility — chair-friendly options included.
const EXERCISE_ROUTINES = [
  {
    day: 'Sunday — Restorative Mobility',
    summary: 'Loose, easy, no equipment. Ten minutes of feeling-better.',
    moves: [
      {
        name: 'Standing or seated cat-cow',
        time: '90 seconds',
        instructions: [
          'Stand with your hands on your hips, or sit tall in a chair.',
          'Breathe in: arch your lower back gently and look up. Pause.',
          'Breathe out: tuck your tailbone, round your upper back, drop your chin.',
          'Move slowly. Eight to ten cycles total.',
        ],
        why: 'Wakes up the spine without bending all the way to the floor.',
      },
      {
        name: 'Shoulder rolls and arm circles',
        time: '60 seconds',
        instructions: [
          'Roll both shoulders back in slow circles for 20 seconds.',
          'Then forward for 20 seconds.',
          'Open your arms wide and draw small circles in the air for 20 seconds — both directions.',
        ],
        why: 'Loosens the neck and upper back where most desk tension sits.',
      },
      {
        name: 'Heel-to-toe rocks',
        time: '90 seconds',
        instructions: [
          'Stand near a counter or sturdy chair you can touch for balance.',
          'Rock onto your heels and lift your toes — hold for one slow count.',
          'Then rock onto your toes and lift your heels — hold for one slow count.',
          'Repeat for 90 seconds. Steady, not fast.',
        ],
        why: 'Wakes up calf muscles and ankles, which carry every step you take today.',
      },
      {
        name: 'Doorway chest opener',
        time: '90 seconds',
        instructions: [
          'Stand in a doorway. Place your forearms on the frame, elbows at shoulder height.',
          'Take one small step forward with either foot.',
          'Feel a gentle stretch across the front of your chest.',
          'Hold 30 seconds. Step back, switch lead foot, repeat.',
        ],
        why: 'Counters the rounded-shoulder posture from sitting and screens.',
      },
      {
        name: 'Slow seated marches',
        time: '90 seconds',
        instructions: [
          'Sit tall on the edge of a sturdy chair. Hands relaxed.',
          'Lift your right knee a few inches, lower it. Then your left.',
          'Keep going at a slow, steady pace — like marching in place.',
          'Breathe normally. 90 seconds.',
        ],
        why: 'Gentle hip and core engagement. Safe for sore knees.',
      },
      {
        name: 'Three slow breaths to close',
        time: '60 seconds',
        instructions: [
          'Sit or stand still. Soften your shoulders.',
          'Inhale through your nose for four counts.',
          'Hold for four counts.',
          'Exhale through your mouth for six counts.',
          'Three rounds. The rest of the day starts here.',
        ],
        why: 'Settles the nervous system before you open your inbox.',
      },
    ],
  },
  {
    day: 'Monday — Strength, Joint-Friendly',
    summary: 'Slow strength work. No floor work. About ten minutes.',
    moves: [
      {
        name: 'Wall push-ups',
        time: '90 seconds',
        instructions: [
          'Stand an arm\'s length from a wall. Place palms flat on the wall, shoulder-width.',
          'Bend your elbows and lower your chest toward the wall. Keep your body in one straight line.',
          'Push back to start. Slow on the way down, smooth on the way up.',
          'Two sets of 8–12 repetitions. Rest 20 seconds between sets.',
        ],
        why: 'Easier on the wrists than floor push-ups. Same chest and shoulder work.',
      },
      {
        name: 'Sit-to-stand from a chair',
        time: '90 seconds',
        instructions: [
          'Sit on the front half of a sturdy chair with your feet flat on the floor.',
          'Cross your arms over your chest. Lean slightly forward.',
          'Stand up using your legs — no hands on the chair if you can manage it.',
          'Sit back down with control. Two sets of 8–10.',
        ],
        why: 'The single most important strength movement after age 50. Trains the legs you use to get up off everything.',
      },
      {
        name: 'Counter-supported calf raises',
        time: '60 seconds',
        instructions: [
          'Stand at a counter. Touch it with your fingertips for balance.',
          'Rise up onto the balls of your feet. Pause for one second at the top.',
          'Lower with control.',
          'Two sets of 12. Rest briefly between sets.',
        ],
        why: 'Strengthens the calves, which protect the Achilles and stabilize every step.',
      },
      {
        name: 'Seated rows with a towel',
        time: '90 seconds',
        instructions: [
          'Sit tall. Loop a hand towel around the bottom of one foot, holding both ends.',
          'Pull the towel toward your belt while pressing your foot away.',
          'Squeeze the muscles between your shoulder blades for one count.',
          'Release slowly. 10–12 reps each side.',
        ],
        why: 'Strengthens the upper back without weights — counters slouching.',
      },
      {
        name: 'Standing side leg lifts',
        time: '90 seconds',
        instructions: [
          'Hold a counter or chair for balance.',
          'Lift one leg straight out to the side, only as high as is comfortable.',
          'Lower with control. Eight to ten on each side.',
          'Keep your standing leg slightly bent — never locked.',
        ],
        why: 'Hip stabilizers — the muscles that protect the knees.',
      },
    ],
  },
  {
    day: 'Tuesday — Walk + Breath',
    summary: 'Get outside for ten minutes. The simplest day of the week.',
    moves: [
      {
        name: 'Five-minute easy walk',
        time: '5 minutes',
        instructions: [
          'Step outside. Front yard is fine. Around the block is better.',
          'Walk at a pace where you could hold a conversation but feel slightly warmer after a couple minutes.',
          'Look up at the trees, the sky, anything that isn\'t a screen.',
        ],
        why: 'Daylight in your eyes within the first hour resets your body clock for the whole day.',
      },
      {
        name: 'Five-minute brisker walk',
        time: '5 minutes',
        instructions: [
          'Pick up the pace slightly — you should feel breathing get deeper but still steady.',
          'Swing your arms naturally. Land on your full foot, not just the heel.',
          'Aim for a hill or some stairs if your route has them.',
        ],
        why: 'Ten total minutes of varied-pace walking has more research backing than almost any supplement.',
      },
      {
        name: 'Box-breathing cooldown',
        time: '60 seconds',
        instructions: [
          'Stand still on your way back in.',
          'Breathe in for four. Hold for four. Out for four. Hold for four.',
          'Three or four full rounds.',
        ],
        why: 'Lowers heart rate, signals your body that the work is done.',
      },
    ],
  },
  {
    day: 'Wednesday — Mid-Week Mobility',
    summary: 'Reset the joints. Ten quiet minutes.',
    moves: [
      {
        name: 'Neck half-circles',
        time: '60 seconds',
        instructions: [
          'Sit or stand tall. Drop your right ear toward your right shoulder.',
          'Slowly roll your chin down across your chest until your left ear is over your left shoulder.',
          'Reverse. Stay in the front half — never roll your head all the way back.',
          'Six slow passes total.',
        ],
        why: 'Releases the upper traps without straining the cervical spine.',
      },
      {
        name: 'Seated spinal twists',
        time: '90 seconds',
        instructions: [
          'Sit tall in a chair, both feet flat.',
          'Place your right hand on your left knee and your left hand behind you on the chair.',
          'Inhale, sit a little taller. Exhale, gently turn your shoulders to the left.',
          'Hold three breaths. Switch sides. Two rounds each.',
        ],
        why: 'Mobility for the mid-back, which most adults have lost.',
      },
      {
        name: 'Standing quad stretch (chair-supported)',
        time: '90 seconds',
        instructions: [
          'Stand next to a chair, holding the back for balance.',
          'Bend your right knee and grab your right ankle (or pant cuff if you can\'t reach).',
          'Pull your heel toward your seat — keep knees close together.',
          'Hold 30 seconds. Switch sides. Two rounds each.',
        ],
        why: 'Tight quads pull on the lower back. This is the stretch that fixes that.',
      },
      {
        name: 'Hip openers — figure-four (seated)',
        time: '90 seconds',
        instructions: [
          'Sit in a sturdy chair. Cross your right ankle over your left thigh, just above the knee.',
          'Sit tall. Gently press your right knee down with your hand only if comfortable.',
          'Lean forward slightly from the hips for a deeper stretch.',
          'Hold 45 seconds each side.',
        ],
        why: 'Releases the glutes and outer hip. Sciatica\'s biggest enemy.',
      },
      {
        name: 'Standing forward fold (knees soft)',
        time: '60 seconds',
        instructions: [
          'Stand tall, feet hip-width apart, knees slightly bent.',
          'Hinge from your hips and let your upper body hang. Hands rest on your shins or thighs.',
          'Do not force your fingers to the floor.',
          'Sway gently for a count of 30. Slowly roll up, vertebra by vertebra.',
        ],
        why: 'Hamstrings and lower back, gently. Roll up slowly to avoid lightheadedness.',
      },
    ],
  },
  {
    day: 'Thursday — Strength, Round Two',
    summary: 'Same idea as Monday with a few tweaks. Ten minutes.',
    moves: [
      {
        name: 'Counter push-ups',
        time: '90 seconds',
        instructions: [
          'Place palms on the kitchen counter, shoulder-width apart.',
          'Step your feet back so your body is at a gentle slope.',
          'Lower your chest to the counter. Keep your body straight.',
          'Press back up. Two sets of 10.',
        ],
        why: 'A small step harder than wall push-ups. Your shoulders will thank you.',
      },
      {
        name: 'Glute bridges (on a bed or low couch)',
        time: '90 seconds',
        instructions: [
          'Lie on your back on a bed or low couch. Knees bent, feet flat.',
          'Press through your heels and lift your hips a few inches.',
          'Squeeze your seat at the top for one count, then lower with control.',
          'Two sets of 10–12.',
        ],
        why: 'Strengthens the glutes — the body\'s biggest muscle group, often the laziest.',
      },
      {
        name: 'Standing rows with a resistance band (or two soup cans)',
        time: '90 seconds',
        instructions: [
          'Hold one weight in each hand, arms relaxed by your sides.',
          'Hinge slightly forward from the hips, back flat.',
          'Pull both hands up toward your ribs, squeezing your shoulder blades together.',
          'Lower slowly. 10–12 reps. Two sets.',
        ],
        why: 'The single best exercise for posture. Your shoulders will quietly thank you for a week.',
      },
      {
        name: 'Wall sit',
        time: '60–90 seconds',
        instructions: [
          'Stand with your back flat against a wall. Walk your feet out about two of your foot-lengths.',
          'Slide down until your knees are bent — only as far as comfortable. Even a quarter-squat counts.',
          'Hold for 20–30 seconds. Stand up. Repeat twice.',
        ],
        why: 'Builds quad endurance with zero impact on the joints.',
      },
      {
        name: 'Slow standing toe raises',
        time: '60 seconds',
        instructions: [
          'Stand tall, fingertips on a counter for balance.',
          'Lift the toes of both feet off the floor while keeping heels planted.',
          'Hold for two seconds. Lower. 10 reps.',
        ],
        why: 'Trains the muscles in front of the shin — surprisingly important for not tripping.',
      },
    ],
  },
  {
    day: 'Friday — Walk + Breath',
    summary: 'Same as Tuesday. The repetition is the point.',
    moves: [
      {
        name: 'Ten-minute relaxed walk',
        time: '10 minutes',
        instructions: [
          'No phone calls. No earbuds if possible.',
          'Walk at a pace that makes you feel slightly warm but never breathless.',
          'Last minute: slow your pace and breathe deeply.',
        ],
        why: 'Friday is for steady-state movement, not intensity. Save your energy for the weekend.',
      },
    ],
  },
  {
    day: 'Saturday — Whole-Body Easy Day',
    summary: 'Pick three from this list, in any order. Ten total minutes.',
    moves: [
      {
        name: 'Doorway chest stretch (60 sec)',
        time: '60 seconds',
        instructions: [
          'Forearms on the doorframe at shoulder height. One foot forward.',
          'Lean gently. Feel the chest open.',
          'Hold 30 seconds. Switch front foot. Hold 30.',
        ],
        why: 'Nothing else opens the chest this safely.',
      },
      {
        name: 'Standing march in place (90 sec)',
        time: '90 seconds',
        instructions: [
          'Stand tall. Lift your knees, one at a time, to a comfortable height.',
          'Add a gentle arm swing.',
          'Steady tempo, like background music.',
        ],
        why: 'Wakes up the body without strain.',
      },
      {
        name: 'Sit-to-stand x 8 (60 sec)',
        time: '60 seconds',
        instructions: [
          'Same as Monday. Front of a sturdy chair. Up, down, controlled.',
          '8 reps. Rest. 8 more if you have time.',
        ],
        why: 'Always worth doing.',
      },
      {
        name: 'Calf raises x 12 (60 sec)',
        time: '60 seconds',
        instructions: [
          'Counter for balance. Up onto toes, pause, down.',
          '12 reps. Two sets if comfortable.',
        ],
        why: 'Easy strength, joint-friendly.',
      },
      {
        name: 'Slow box breathing (90 sec)',
        time: '90 seconds',
        instructions: [
          'In four, hold four, out four, hold four.',
          'Four to six rounds.',
        ],
        why: 'Saturdays are for nervous-system rest.',
      },
    ],
  },
];

// ---------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------

function safeRead(key, fallback) {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function safeWrite(key, value) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota exceeded — silent fail is acceptable here */
  }
}

function migrateLegacyHoldings() {
  if (typeof window === 'undefined') return;
  // If holdings exist but no accounts array, the data is from the
  // pre-multi-account era. Wrap them under a synthetic "Imported earlier"
  // account so the user keeps their data and can rename later.
  const existing = safeRead(STORAGE_KEYS.holdings, null);
  const accounts = safeRead(STORAGE_KEYS.accounts, null);
  if (Array.isArray(existing) && existing.length > 0 && !accounts) {
    const fallbackAccountId = 'legacy_' + Math.random().toString(36).slice(2, 8);
    const fallbackAccount = {
      id: fallbackAccountId,
      name: 'Imported earlier',
      brokerage: 'unknown',
      uploadedAt: new Date().toISOString(),
      holdingCount: existing.length,
    };
    const upgraded = existing.map(h => ({
      ...h,
      account: h.account || 'Imported earlier',
      accountId: h.accountId || fallbackAccountId,
    }));
    safeWrite(STORAGE_KEYS.accounts, [fallbackAccount]);
    safeWrite(STORAGE_KEYS.holdings, upgraded);
  }
}
// ---------------------------------------------------------------------
// CSV parsing — best-effort across the major brokers
// ---------------------------------------------------------------------

function parseCsvText(text) {
  // Lightweight parser: handles quoted fields with commas/newlines.
  const rows = [];
  let cur = [''];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        cur[cur.length - 1] += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur[cur.length - 1] += ch;
      }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') cur.push('');
      else if (ch === '\n' || ch === '\r') {
        if (cur.length > 1 || cur[0] !== '') rows.push(cur);
        cur = [''];
        if (ch === '\r' && text[i + 1] === '\n') i++;
      } else cur[cur.length - 1] += ch;
    }
  }
  if (cur.length > 1 || cur[0] !== '') rows.push(cur);
  return rows;
}

function parseHoldingsFromCsv(text) {
  const rows = parseCsvText(text);
  if (rows.length < 2) return [];

  // Find header row — many brokers prepend metadata before the table.
  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const row = rows[i].map(c => c.trim().toLowerCase());
    const hasSymbol = row.some(c => /^(symbol|ticker)$/.test(c));
    const hasQty = row.some(c => /(quantity|shares|qty)/.test(c));
    if (hasSymbol && hasQty) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) return [];

  const header = rows[headerIdx].map(c => c.trim().toLowerCase());
  const findCol = patterns => {
    for (let i = 0; i < header.length; i++) {
      for (const p of patterns) {
        if (p.test(header[i])) return i;
      }
    }
    return -1;
  };
  const symCol = findCol([/^symbol$/, /^ticker$/, /^stock symbol$/]);
  const qtyCol = findCol([/^quantity$/, /^shares$/, /^qty$/, /^current value/]);
  const costCol = findCol([/cost basis( total)?$/, /average cost/, /cost per share/]);
  const valCol = findCol([/^current value$/, /^market value$/, /^total$/]);

  if (symCol === -1 || qtyCol === -1) return [];

  const out = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const sym = (r[symCol] || '').trim().toUpperCase().replace(/[^A-Z.\-]/g, '');
    if (!sym || sym.length < 1 || sym.length > 6) continue;
    if (/(TOTAL|CASH|PENDING)/i.test(sym)) continue;
    const shares = parseFloat((r[qtyCol] || '').replace(/[, $]/g, ''));
    if (!Number.isFinite(shares) || shares <= 0) continue;
    const costBasis = costCol > -1 ? parseFloat((r[costCol] || '').replace(/[, $]/g, '')) : undefined;
    const marketValue = valCol > -1 ? parseFloat((r[valCol] || '').replace(/[, $]/g, '')) : undefined;
    out.push({
      symbol: sym,
      shares,
      costBasis: Number.isFinite(costBasis) ? costBasis : undefined,
      marketValue: Number.isFinite(marketValue) ? marketValue : undefined,
    });
  }
  return out;
}

// ---------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------

// Streaming brief reader. Consumes the SSE stream from /api/brief and
// fires `onCard` / `onError` / `onDone` as events arrive.
function useStreamingBrief() {
  const [cards, setCards] = useState({});
  const [errors, setErrors] = useState({});
  const [status, setStatus] = useState('idle'); // idle | streaming | done | failed
  const [meta, setMeta] = useState(null);
  const abortRef = useRef(null);

  const start = useCallback(async (payload, { fresh = false } = {}) => {
    // Cancel anything previous
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStatus('streaming');
    setCards({});
    setErrors({});
    setMeta(null);

    try {
      const url = '/api/brief' + (fresh ? '?fresh=1' : '');
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, forceFresh: fresh }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        throw new Error(`Server returned ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Split on double-newline (SSE event boundary)
        let boundary;
        while ((boundary = buffer.indexOf('\n\n')) !== -1) {
          const chunk = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const evMatch = chunk.match(/^event:\s*(.+)$/m);
          const dataMatch = chunk.match(/^data:\s*([\s\S]+)$/m);
          if (!evMatch || !dataMatch) continue;
          const event = evMatch[1].trim();
          let data;
          try {
            data = JSON.parse(dataMatch[1]);
          } catch {
            continue;
          }

          if (event === 'meta') {
            setMeta(data);
          } else if (event === 'card') {
            setCards(prev => ({ ...prev, [data.id]: data }));
          } else if (event === 'error') {
            setErrors(prev => ({ ...prev, [data.id]: data.message }));
          } else if (event === 'done') {
            setStatus('done');
          }
        }
      }
      setStatus(s => (s === 'streaming' ? 'done' : s));
    } catch (err) {
      if (err.name === 'AbortError') return;
      setStatus('failed');
    }
  }, []);

  const cancel = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    setStatus('idle');
  }, []);

  return { cards, errors, status, meta, start, cancel };
}

// Pull-to-refresh — iOS-feel, no visible button anywhere.
function usePullToRefresh(onTrigger, { threshold = 80, enabled = true } = {}) {
  const [pull, setPull] = useState(0); // 0..1+ — 1 = threshold reached
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef(null);
  const active = useRef(false);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    const onTouchStart = e => {
      if (window.scrollY > 0) return;
      startY.current = e.touches[0].clientY;
      active.current = true;
    };
    const onTouchMove = e => {
      if (!active.current || startY.current == null) return;
      const dy = e.touches[0].clientY - startY.current;
      if (dy <= 0) {
        setPull(0);
        return;
      }
      // Apply rubber-band resistance
      const ratio = Math.min(dy / (threshold * 1.5), 1.4);
      setPull(ratio);
    };
    const onTouchEnd = async () => {
      if (!active.current) return;
      active.current = false;
      const wasOver = pull >= 1;
      setPull(0);
      if (wasOver && !refreshing) {
        setRefreshing(true);
        try {
          await onTrigger();
        } finally {
          setRefreshing(false);
        }
      }
    };

    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
    };
  }, [enabled, onTrigger, threshold, pull, refreshing]);

  return { pull, refreshing };
}

// Dark mode preference — auto / on / off, respects system + persists.
function useDarkMode() {
  const [pref, setPref] = useState('auto');
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const saved = safeRead(STORAGE_KEYS.darkMode, 'auto');
    setPref(saved);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const compute = () => {
      if (pref === 'on') setIsDark(true);
      else if (pref === 'off') setIsDark(false);
      else setIsDark(mql.matches);
    };
    compute();
    mql.addEventListener('change', compute);
    return () => mql.removeEventListener('change', compute);
  }, [pref]);

  const cyclePref = useCallback(() => {
    const next = pref === 'auto' ? 'on' : pref === 'on' ? 'off' : 'auto';
    setPref(next);
    safeWrite(STORAGE_KEYS.darkMode, next);
  }, [pref]);

  const setDarkPref = useCallback((next) => {
    if (next !== 'auto' && next !== 'on' && next !== 'off') return;
    setPref(next);
    safeWrite(STORAGE_KEYS.darkMode, next);
  }, []);

  return { pref, isDark, cyclePref, setDarkPref };
}

// Quick + dirty mobile detection. We use this for the brokerage UX
// branch — desktop sees clickable login URLs, mobile sees an honest
// "open this on your computer" message.
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const compute = () => {
      const narrow = window.innerWidth < 768;
      const coarse = window.matchMedia('(pointer: coarse)').matches;
      setIsMobile(narrow || coarse);
    };
    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, []);
  return isMobile;
}

// Outbound link return pill. When the user clicks an external link,
// we surface a small dismissible pill at top-right for ~5 seconds
// reminding them they can come back. It does NOT live at the bottom
// (where cookie banners spawn) and it does NOT block any content.
function useOutboundReturnPill() {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef(null);

  const trigger = useCallback(() => {
    setVisible(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setVisible(false), 5500);
  }, []);

  // Hide pill immediately when the user comes back to our tab.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVis = () => {
      if (document.visibilityState === 'visible') setVisible(false);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  return { visible, trigger, dismiss: () => setVisible(false) };
}

// ---------------------------------------------------------------------
// Date helpers — used for per-day playbook decisions
// ---------------------------------------------------------------------

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dayOfWeek() {
  return new Date().getDay();
}
// =====================================================================
// SUB-COMPONENTS
// =====================================================================

// ───── Outbound link return pill (top-right, auto-hides) ─────
function ReturnPill({ visible, onDismiss }) {
  if (!visible) return null;
  return (
    <div
      className="fixed top-3 right-3 z-50 animate-fade-in flex items-center gap-2 rounded-full bg-slate-900/90 dark:bg-amber-100/95 text-cream-50 dark:text-slate-900 backdrop-blur-md px-4 py-2.5 shadow-lg text-[15px] font-medium"
      role="status"
      aria-live="polite"
    >
      <ArrowRight className="h-4 w-4 rotate-180" />
      <span>Switch tabs to return</span>
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        className="ml-1 rounded-full p-1 hover:bg-white/10 dark:hover:bg-black/10"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ───── Pull-to-refresh indicator ─────
function PullIndicator({ pull, refreshing }) {
  if (pull <= 0 && !refreshing) return null;
  const opacity = Math.min(pull, 1);
  const ready = pull >= 1;
  return (
    <div
      className="fixed top-0 left-1/2 -translate-x-1/2 z-40 flex flex-col items-center pointer-events-none"
      style={{
        transform: `translate(-50%, ${refreshing ? 12 : Math.min(pull * 50, 60)}px)`,
        opacity: refreshing ? 1 : opacity,
        transition: refreshing ? 'transform 0.2s ease' : 'none',
      }}
    >
      <div
        className={`h-9 w-9 rounded-full bg-amber-50 dark:bg-slate-800 shadow-md flex items-center justify-center ${refreshing ? 'animate-spin' : ''}`}
      >
        <RefreshCw
          className={`h-5 w-5 ${ready || refreshing ? 'text-amber-700 dark:text-amber-400' : 'text-slate-400 dark:text-slate-500'}`}
          style={{
            transform: !refreshing ? `rotate(${pull * 270}deg)` : undefined,
            transition: 'transform 0.05s linear',
          }}
        />
      </div>
      <div className="mt-1 text-[12px] font-medium text-slate-600 dark:text-slate-400">
        {refreshing ? 'Refreshing…' : ready ? 'Release to refresh' : 'Pull to refresh'}
      </div>
    </div>
  );
}

// ───── Scrolling ticker — richer than just symbols ─────
function Ticker({ watchlist, accounts, holdings, convictionItems, lastSynced }) {
  // Build entries: every watchlist + holding symbol, with any conviction
  // take overlaid as a sub-line.
  const entries = useMemo(() => {
    const items = [];
    const seen = new Set();
    const convMap = new Map();
    (convictionItems || []).forEach(c => convMap.set(c.ticker?.toUpperCase(), c));

    // Lead with a status entry showing real account info
    if (accounts && accounts.length > 0) {
      const totalHoldings = holdings.length;
      items.push({
        kind: 'status',
        label: `${accounts.length} ${accounts.length === 1 ? 'account' : 'accounts'} synced`,
        sub: `${totalHoldings} positions${lastSynced ? ' · ' + lastSynced : ''}`,
      });
    }

    [...(watchlist || []), ...holdings.map(h => h.symbol)].forEach(sym => {
      const s = (sym || '').toUpperCase();
      if (!s || seen.has(s)) return;
      seen.add(s);
      const conv = convMap.get(s);
      items.push({
        kind: 'symbol',
        label: s,
        sub: conv
          ? `${conv.headline} · ${conv.conviction} conviction`
          : null,
      });
    });

    if (items.length === 0) {
      items.push({ kind: 'status', label: 'Add a watchlist to begin', sub: null });
    }
    return items;
  }, [watchlist, accounts, holdings, convictionItems, lastSynced]);

  // Duplicate for seamless loop
  const looped = [...entries, ...entries];

  return (
    <div className="overflow-hidden border-y border-amber-100 dark:border-slate-800 bg-amber-50/40 dark:bg-slate-900/40 py-2.5">
      <div className="flex gap-7 animate-marquee whitespace-nowrap">
        {looped.map((e, i) => (
          <div key={i} className="flex items-baseline gap-2 px-1">
            <span
              className={`text-[15px] font-semibold tracking-wide ${
                e.kind === 'status'
                  ? 'text-amber-700 dark:text-amber-400'
                  : 'text-slate-800 dark:text-slate-100'
              }`}
            >
              {e.label}
            </span>
            {e.sub && (
              <span className="text-[13px] text-slate-500 dark:text-slate-400 font-normal">
                {e.sub}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ───── Sync portfolio box (compact) ─────
function SyncBox({
  accounts,
  holdings,
  onOpenManager,
  isMobile,
  onOutboundClick,
}) {
  const hasData = accounts.length > 0;
  const totalShares = holdings.reduce((sum, h) => sum + (h.shares || 0), 0);

  return (
    <div className="rounded-2xl border border-amber-200/70 dark:border-amber-700/50 bg-gradient-to-br from-amber-50 to-cream-50 dark:from-slate-800 dark:to-slate-900 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="rounded-xl bg-amber-100 dark:bg-amber-900/40 p-2 flex-shrink-0">
            <Wallet className="h-5 w-5 text-amber-700 dark:text-amber-400" />
          </div>
          <div className="min-w-0">
            <div className="text-[16px] font-semibold text-slate-900 dark:text-cream-50">
              {hasData ? 'Portfolio synced' : 'Sync your portfolio'}
            </div>
            <div className="text-[14px] text-slate-600 dark:text-slate-400 truncate">
              {hasData
                ? `${accounts.length} ${accounts.length === 1 ? 'account' : 'accounts'} · ${holdings.length} positions${totalShares ? ' · ' + Math.round(totalShares).toLocaleString() + ' shares' : ''}`
                : isMobile
                ? 'Use your computer to upload CSV'
                : 'Personalize the brief with your real positions'}
            </div>
          </div>
        </div>
        <button
          onClick={onOpenManager}
          className="flex-shrink-0 rounded-full bg-slate-900 dark:bg-amber-200 text-cream-50 dark:text-slate-900 px-4 py-2 text-[14px] font-semibold shadow-sm hover:bg-slate-800 dark:hover:bg-amber-100 transition-colors"
        >
          {hasData ? 'Manage' : 'Add'}
        </button>
      </div>

      {hasData && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {accounts.slice(0, 4).map(a => (
            <span
              key={a.id}
              className="inline-flex items-center gap-1 rounded-full bg-white/70 dark:bg-slate-900/60 border border-amber-200/50 dark:border-slate-700 px-2.5 py-1 text-[12.5px] text-slate-700 dark:text-slate-300"
            >
              {a.name}
            </span>
          ))}
          {accounts.length > 4 && (
            <span className="inline-flex items-center rounded-full bg-white/70 dark:bg-slate-900/60 border border-amber-200/50 dark:border-slate-700 px-2.5 py-1 text-[12.5px] text-slate-500 dark:text-slate-400">
              +{accounts.length - 4} more
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ───── Account manager modal (multi-account aware) ─────
function AccountManagerModal({
  open,
  onClose,
  accounts,
  holdings,
  setAccounts,
  setHoldings,
  isMobile,
  onOutboundClick,
}) {
  const [view, setView] = useState('list'); // list | upload | broker_picker | edit
  const [stagedRows, setStagedRows] = useState(null);
  const [stagedBrokerage, setStagedBrokerage] = useState('');
  const [labelInput, setLabelInput] = useState('');
  const [editTarget, setEditTarget] = useState(null);
  const [editName, setEditName] = useState('');
  const [parseError, setParseError] = useState('');
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (open) setView('list');
  }, [open]);

  if (!open) return null;

  const handleFile = async file => {
    setParseError('');
    try {
      const text = await file.text();
      const rows = parseHoldingsFromCsv(text);
      if (rows.length === 0) {
        setParseError(
          "Couldn't find any holdings in that file. Make sure it's the positions/holdings export, not a transaction history."
        );
        return;
      }
      setStagedRows(rows);
      setLabelInput('');
      setView('label');
    } catch (err) {
      setParseError("Couldn't read that file. Try downloading it again from the broker.");
    }
  };

  const confirmUpload = () => {
    if (!stagedRows || !labelInput.trim()) return;
    const accountId = 'acct_' + Math.random().toString(36).slice(2, 10);
    const accountName = labelInput.trim();
    const newAccount = {
      id: accountId,
      name: accountName,
      brokerage: stagedBrokerage || 'unknown',
      uploadedAt: new Date().toISOString(),
      holdingCount: stagedRows.length,
    };
    const newHoldings = stagedRows.map(r => ({
      ...r,
      account: accountName,
      accountId,
    }));
    setAccounts([...accounts, newAccount]);
    setHoldings([...holdings, ...newHoldings]);
    setStagedRows(null);
    setLabelInput('');
    setStagedBrokerage('');
    setView('list');
  };

  const deleteAccount = id => {
    const acct = accounts.find(a => a.id === id);
    if (!acct) return;
    if (!window.confirm(`Remove "${acct.name}" and its ${acct.holdingCount || 0} positions? Other accounts stay intact.`)) {
      return;
    }
    setAccounts(accounts.filter(a => a.id !== id));
    setHoldings(holdings.filter(h => h.accountId !== id));
  };

  const startEdit = a => {
    setEditTarget(a);
    setEditName(a.name);
    setView('edit');
  };

  const saveEdit = () => {
    const trimmed = editName.trim();
    if (!trimmed || !editTarget) return;
    setAccounts(
      accounts.map(a => (a.id === editTarget.id ? { ...a, name: trimmed } : a))
    );
    setHoldings(
      holdings.map(h =>
        h.accountId === editTarget.id ? { ...h, account: trimmed } : h
      )
    );
    setEditTarget(null);
    setView('list');
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full sm:max-w-lg bg-cream-50 dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl border border-slate-200 dark:border-slate-700 shadow-2xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-cream-50/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 px-5 py-4 flex items-center justify-between rounded-t-3xl">
          <h2 className="text-[19px] font-semibold text-slate-900 dark:text-cream-50">
            {view === 'list' && 'Your synced accounts'}
            {view === 'upload' && 'Upload a CSV'}
            {view === 'broker_picker' && 'Where is the CSV from?'}
            {view === 'label' && 'Label this account'}
            {view === 'edit' && 'Rename account'}
          </h2>
          <button
            onClick={onClose}
            className="rounded-full p-2 hover:bg-slate-200 dark:hover:bg-slate-800"
            aria-label="Close"
          >
            <X className="h-5 w-5 text-slate-700 dark:text-slate-300" />
          </button>
        </div>

        {view === 'list' && (
          <div className="px-5 py-5 space-y-5">
            {/* Privacy banner */}
            <div className="rounded-2xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700/40 p-4">
              <div className="flex items-start gap-3">
                <Lock className="h-5 w-5 text-emerald-700 dark:text-emerald-400 flex-shrink-0 mt-0.5" />
                <div>
                  <div className="text-[15px] font-semibold text-emerald-900 dark:text-emerald-200">
                    We sync a document, not your account.
                  </div>
                  <p className="mt-1 text-[14px] leading-relaxed text-emerald-800 dark:text-emerald-300">
                    Your holdings live on this device only. They're sent to the brief
                    generator just when you refresh — never stored on our servers, never
                    shared with anyone. Nothing connects to your real brokerage.
                  </p>
                </div>
              </div>
            </div>

            {accounts.length === 0 ? (
              <div className="text-center py-6">
                <div className="text-[15px] text-slate-600 dark:text-slate-400">
                  No accounts yet. Upload a CSV to get started.
                </div>
              </div>
            ) : (
              <ul className="space-y-2.5">
                {accounts.map(a => {
                  const acctHoldings = holdings.filter(h => h.accountId === a.id);
                  return (
                    <li
                      key={a.id}
                      className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/40 p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-[16px] font-semibold text-slate-900 dark:text-cream-50">
                            {a.name}
                          </div>
                          <div className="mt-0.5 text-[13px] text-slate-500 dark:text-slate-400">
                            {acctHoldings.length} positions ·{' '}
                            {a.brokerage !== 'unknown' ? a.brokerage + ' · ' : ''}
                            uploaded {new Date(a.uploadedAt).toLocaleDateString()}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1">
                            {acctHoldings.slice(0, 6).map(h => (
                              <span
                                key={h.symbol}
                                className="rounded bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 text-[12px] text-slate-700 dark:text-slate-200 font-mono"
                              >
                                {h.symbol}
                              </span>
                            ))}
                            {acctHoldings.length > 6 && (
                              <span className="text-[12px] text-slate-500 dark:text-slate-400 self-center">
                                +{acctHoldings.length - 6}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-col gap-1.5 flex-shrink-0">
                          <button
                            onClick={() => startEdit(a)}
                            className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"
                            aria-label="Rename"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => deleteAccount(a.id)}
                            className="p-2 rounded-lg text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/30"
                            aria-label="Delete"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            <button
              onClick={() => setView('broker_picker')}
              className="w-full rounded-2xl bg-amber-500 hover:bg-amber-600 text-white font-semibold text-[16px] py-3.5 shadow-sm flex items-center justify-center gap-2 transition-colors"
            >
              <Plus className="h-5 w-5" />
              Add another account
            </button>
          </div>
        )}

        {view === 'broker_picker' && (
          <div className="px-5 py-5 space-y-3">
            {isMobile ? (
              <div className="rounded-2xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40 p-4">
                <div className="flex items-start gap-3">
                  <Info className="h-5 w-5 text-amber-700 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <div className="text-[15px] font-semibold text-slate-900 dark:text-cream-50">
                      Easier on a computer
                    </div>
                    <p className="mt-1 text-[14px] leading-relaxed text-slate-700 dark:text-slate-300">
                      Brokerage CSV exports are tucked behind login flows that
                      don't work well on mobile. Open Morning Edge on your laptop
                      or desktop to grab the file, then come back here.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-[14px] text-slate-600 dark:text-slate-400">
                Pick where the file came from. We'll show you exactly where the
                export lives in their site, and the link below opens their login.
              </p>
            )}

            <div className="space-y-2">
              {BROKERS.map(b => (
                <BrokerRow
                  key={b.id}
                  broker={b}
                  isMobile={isMobile}
                  onSelect={() => {
                    setStagedBrokerage(b.name);
                    setView('upload');
                  }}
                  onLoginClick={() => onOutboundClick && onOutboundClick()}
                />
              ))}
            </div>

            <button
              onClick={() => setView('list')}
              className="w-full mt-2 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 py-2.5 text-[15px] font-medium hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              Back
            </button>
          </div>
        )}

        {view === 'upload' && (
          <div className="px-5 py-5 space-y-4">
            <div className="rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-700 bg-white/60 dark:bg-slate-800/40 p-6 text-center">
              <Upload className="h-8 w-8 text-slate-400 mx-auto mb-2" />
              <div className="text-[15px] text-slate-700 dark:text-slate-300">
                Choose your <span className="font-semibold">{stagedBrokerage}</span> CSV file
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="mt-3 rounded-full bg-slate-900 dark:bg-amber-200 text-cream-50 dark:text-slate-900 px-5 py-2.5 text-[15px] font-semibold"
              >
                Choose file
              </button>
            </div>

            {parseError && (
              <div className="rounded-xl bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-700/40 p-3 text-[14px] text-rose-800 dark:text-rose-300 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                <span>{parseError}</span>
              </div>
            )}

            <button
              onClick={() => setView('broker_picker')}
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 py-2.5 text-[15px] font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Back
            </button>
          </div>
        )}

        {view === 'label' && stagedRows && (
          <div className="px-5 py-5 space-y-4">
            <div className="rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700/40 p-3 text-[14px] text-emerald-800 dark:text-emerald-300">
              Found <strong>{stagedRows.length}</strong> positions. Now give this
              account a name so the brief can refer to it precisely.
            </div>
            <div>
              <label className="block text-[14px] font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Account name
              </label>
              <input
                type="text"
                value={labelInput}
                onChange={e => setLabelInput(e.target.value)}
                placeholder="e.g. Fidelity TOD, Schwab Roth, Old Robinhood"
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-[16px] text-slate-900 dark:text-cream-50 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-amber-400"
                autoFocus
              />
              <p className="mt-1.5 text-[13px] text-slate-500 dark:text-slate-400">
                Free text — use whatever helps you tell accounts apart at a glance.
              </p>
            </div>

            <div className="max-h-40 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 p-3 text-[13px] font-mono text-slate-700 dark:text-slate-300">
              {stagedRows.slice(0, 12).map((r, i) => (
                <div key={i}>
                  {r.symbol} — {r.shares} sh
                </div>
              ))}
              {stagedRows.length > 12 && <div className="text-slate-500 mt-1">…and {stagedRows.length - 12} more</div>}
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => {
                  setStagedRows(null);
                  setView('upload');
                }}
                className="flex-1 rounded-xl border border-slate-300 dark:border-slate-700 py-3 text-[15px] font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                onClick={confirmUpload}
                disabled={!labelInput.trim()}
                className="flex-1 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:bg-slate-300 disabled:dark:bg-slate-700 disabled:cursor-not-allowed text-white py-3 text-[15px] font-semibold"
              >
                Save account
              </button>
            </div>
          </div>
        )}

        {view === 'edit' && editTarget && (
          <div className="px-5 py-5 space-y-4">
            <input
              type="text"
              value={editName}
              onChange={e => setEditName(e.target.value)}
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-[16px] text-slate-900 dark:text-cream-50 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-amber-400"
              autoFocus
            />
            <div className="flex gap-2">
              <button
                onClick={() => setView('list')}
                className="flex-1 rounded-xl border border-slate-300 dark:border-slate-700 py-3 text-[15px] font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                onClick={saveEdit}
                disabled={!editName.trim()}
                className="flex-1 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:bg-slate-300 text-white py-3 text-[15px] font-semibold"
              >
                Save
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ───── Single broker row in the picker ─────
function BrokerRow({ broker, isMobile, onSelect, onLoginClick }) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/40 p-3.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[16px] font-semibold text-slate-900 dark:text-cream-50">
            {broker.name}
          </div>
          <div className="text-[13.5px] text-slate-600 dark:text-slate-400 mt-0.5">
            {broker.exportPath}
          </div>
        </div>
        <button
          onClick={onSelect}
          className="flex-shrink-0 rounded-full bg-slate-900 dark:bg-amber-200 text-cream-50 dark:text-slate-900 px-4 py-1.5 text-[14px] font-semibold"
        >
          Use
        </button>
      </div>
      {broker.loginUrl && !isMobile && (
        <a
          href={broker.loginUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={onLoginClick}
          className="inline-flex items-center gap-1.5 mt-2 text-[13.5px] text-amber-700 dark:text-amber-400 hover:underline font-medium"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Open {broker.name} login
        </a>
      )}
    </div>
  );
}
// ───── Card shell with consistent styling ─────
function CardShell({ title, subtitle, accent = 'slate', children, footer }) {
  const accentClass = {
    slate: 'border-slate-200 dark:border-slate-700',
    amber: 'border-amber-200 dark:border-amber-700/50',
    emerald: 'border-emerald-200 dark:border-emerald-700/40',
    sage: 'border-emerald-100 dark:border-emerald-900/40',
  }[accent];
  return (
    <section
      className={`rounded-3xl border ${accentClass} bg-white/80 dark:bg-slate-800/60 backdrop-blur-sm shadow-sm overflow-hidden`}
    >
      {(title || subtitle) && (
        <header className="px-5 pt-5 pb-3">
          {title && (
            <h2 className="text-[20px] font-semibold tracking-tight text-slate-900 dark:text-cream-50">
              {title}
            </h2>
          )}
          {subtitle && (
            <p className="mt-1 text-[14px] text-slate-500 dark:text-slate-400">
              {subtitle}
            </p>
          )}
        </header>
      )}
      <div className="px-5 pb-5">{children}</div>
      {footer && (
        <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 text-[13px] text-slate-500 dark:text-slate-400">
          {footer}
        </div>
      )}
    </section>
  );
}

// ───── Loading shimmer for streaming cards ─────
function CardSkeleton({ title, lines = 3 }) {
  return (
    <CardShell title={title}>
      <div className="space-y-2.5">
        {Array.from({ length: lines }).map((_, i) => (
          <div
            key={i}
            className="h-3.5 rounded bg-slate-200 dark:bg-slate-700 animate-pulse"
            style={{ width: `${85 - i * 12}%` }}
          />
        ))}
      </div>
      <p className="mt-4 text-[13px] text-slate-400 dark:text-slate-500 italic">
        Generating…
      </p>
    </CardShell>
  );
}

// ───── Today's Edge — single banner ─────
function TodayEdgeCard({ data }) {
  if (!data) return <CardSkeleton title="Today's Edge" lines={2} />;
  return (
    <section className="rounded-3xl border border-amber-300 dark:border-amber-700/60 bg-gradient-to-br from-amber-100 via-amber-50 to-cream-50 dark:from-amber-900/30 dark:via-slate-800 dark:to-slate-900 px-5 py-5 shadow-sm">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-amber-700 dark:text-amber-400" />
        <span className="text-[12.5px] font-bold uppercase tracking-widest text-amber-800 dark:text-amber-400">
          Today's Edge
        </span>
      </div>
      <h2 className="mt-2 text-[22px] font-bold tracking-tight text-slate-900 dark:text-cream-50 leading-snug">
        {data.headline}
      </h2>
      <p className="mt-2 text-[16px] leading-relaxed text-slate-700 dark:text-slate-200">
        {data.subhead}
      </p>
    </section>
  );
}

// ───── Market Pulse ─────
function MarketPulseCard({ data }) {
  if (!data) return <CardSkeleton title="Market Pulse" />;
  const idx = data.indices || {};
  return (
    <CardShell title="Market Pulse" subtitle="What's actually moving today">
      <ul className="space-y-2.5">
        {(data.bullets || []).map((b, i) => (
          <li
            key={i}
            className="flex gap-3 text-[16px] leading-relaxed text-slate-800 dark:text-slate-200"
          >
            <span className="mt-2 h-1.5 w-1.5 rounded-full bg-amber-500 flex-shrink-0" />
            <span>{b}</span>
          </li>
        ))}
      </ul>
      {(idx.spx || idx.ndx || idx.vix || idx.ten_year) && (
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            ['S&P', idx.spx],
            ['Nasdaq', idx.ndx],
            ['VIX', idx.vix],
            ['10-yr', idx.ten_year],
          ].map(([k, v]) => (
            <div
              key={k}
              className="rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 px-3 py-2"
            >
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                {k}
              </div>
              <div className="text-[15px] font-semibold text-slate-900 dark:text-cream-50">
                {v || '—'}
              </div>
            </div>
          ))}
        </div>
      )}
    </CardShell>
  );
}

// ───── Conviction Watch ─────
function ConvictionWatchCard({ data }) {
  if (!data) return <CardSkeleton title="Conviction Watch" />;
  const items = data.items || [];
  if (items.length === 0) {
    return (
      <CardShell title="Conviction Watch">
        <p className="text-[15px] text-slate-500 dark:text-slate-400">
          No high-signal names today. That's a calm market signal in itself.
        </p>
      </CardShell>
    );
  }
  return (
    <CardShell title="Conviction Watch" subtitle="A clear take — not a menu">
      <ul className="space-y-3.5">
        {items.map((it, i) => (
          <li
            key={i}
            className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/60 p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-[18px] font-bold tracking-tight text-slate-900 dark:text-cream-50 font-mono">
                    {it.ticker}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11.5px] font-semibold uppercase tracking-wider ${
                      it.conviction === 'high'
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
                        : it.conviction === 'medium'
                          ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                          : 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {it.conviction || 'medium'}
                  </span>
                  {it.horizon && (
                    <span className="text-[12.5px] text-slate-500 dark:text-slate-400">
                      {it.horizon}
                    </span>
                  )}
                </div>
                <div className="mt-1 text-[16px] font-semibold text-slate-800 dark:text-slate-100">
                  {it.headline}
                </div>
                <p className="mt-1.5 text-[15px] leading-relaxed text-slate-700 dark:text-slate-300">
                  {it.take}
                </p>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </CardShell>
  );
}

// ───── Today's Playbook — Accept / Dismiss ─────
function PlaybookCard({ data, accepted, dismissed, onAccept, onDismiss }) {
  if (!data) return <CardSkeleton title="Today's Playbook" lines={4} />;
  const items = data.items || [];
  if (items.length === 0) {
    return (
      <CardShell title="Today's Playbook">
        <p className="text-[15px] text-slate-500 dark:text-slate-400">
          No specific actions today. A "do nothing" day is a real edge.
        </p>
      </CardShell>
    );
  }
  return (
    <CardShell
      title="Today's Playbook"
      subtitle="Suggestions — your decision"
    >
      <ul className="space-y-3">
        {items.map(it => {
          const isAccepted = accepted[it.id];
          const isDismissed = dismissed[it.id];
          const isDecided = isAccepted || isDismissed;
          return (
            <li
              key={it.id}
              className={`rounded-2xl border p-4 transition-all ${
                isDismissed
                  ? 'border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-900/30 opacity-50'
                  : isAccepted
                    ? 'border-emerald-300 dark:border-emerald-700/60 bg-emerald-50/60 dark:bg-emerald-900/20'
                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {it.tag && (
                      <span className="rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider">
                        {it.tag}
                      </span>
                    )}
                    {isAccepted && (
                      <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-emerald-700 dark:text-emerald-400">
                        <Check className="h-3.5 w-3.5" /> Accepted
                      </span>
                    )}
                    {isDismissed && (
                      <span className="text-[12px] font-semibold text-slate-500 dark:text-slate-400">
                        Dismissed
                      </span>
                    )}
                  </div>
                  <div
                    className={`mt-1.5 text-[16.5px] font-semibold leading-snug ${
                      isDismissed
                        ? 'text-slate-500 dark:text-slate-500 line-through'
                        : 'text-slate-900 dark:text-cream-50'
                    }`}
                  >
                    {it.title}
                  </div>
                  {it.detail && !isDismissed && (
                    <p className="mt-1.5 text-[15px] leading-relaxed text-slate-700 dark:text-slate-300">
                      {it.detail}
                    </p>
                  )}
                </div>
              </div>
              {!isDecided && (
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => onAccept(it.id)}
                    className="flex-1 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[14.5px] font-semibold py-2.5 inline-flex items-center justify-center gap-1.5"
                  >
                    <Check className="h-4 w-4" /> Accept
                  </button>
                  <button
                    onClick={() => onDismiss(it.id)}
                    className="flex-1 rounded-xl border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 text-[14.5px] font-semibold py-2.5 hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center justify-center gap-1.5"
                  >
                    <X className="h-4 w-4" /> Dismiss
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </CardShell>
  );
}

// ───── Today's Meal ─────
function MealCard({ data }) {
  if (!data) return <CardSkeleton title="Today's Meal" />;
  return (
    <CardShell
      title="Today's Meal"
      subtitle={data.why}
      accent="emerald"
    >
      <div className="text-[18px] font-semibold text-slate-900 dark:text-cream-50">
        {data.name}
      </div>
      <div className="mt-3 grid sm:grid-cols-2 gap-4">
        <div>
          <div className="text-[12.5px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1.5">
            Ingredients
          </div>
          <ul className="space-y-1">
            {(data.ingredients || []).map((ing, i) => (
              <li
                key={i}
                className="text-[15.5px] leading-relaxed text-slate-700 dark:text-slate-200"
              >
                · {ing}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="text-[12.5px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1.5">
            Steps
          </div>
          <ol className="space-y-2">
            {(data.steps || []).map((s, i) => (
              <li
                key={i}
                className="text-[15.5px] leading-relaxed text-slate-700 dark:text-slate-200"
              >
                <span className="font-semibold text-slate-900 dark:text-cream-50">
                  {i + 1}.
                </span>{' '}
                {s}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </CardShell>
  );
}

// ───── Today's Wisdom ─────
function WisdomCard({ data }) {
  if (!data) return <CardSkeleton title="Today's Wisdom" lines={2} />;
  return (
    <section className="rounded-3xl bg-gradient-to-br from-emerald-50 via-cream-50 to-amber-50 dark:from-emerald-900/20 dark:via-slate-800 dark:to-amber-900/20 border border-emerald-100 dark:border-emerald-900/40 px-6 py-7 shadow-sm">
      <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-300">
        <Compass className="h-4 w-4" />
        <span className="text-[12px] font-bold uppercase tracking-widest">
          Today's Wisdom
        </span>
      </div>
      <p
        className="mt-3 text-[24px] sm:text-[26px] font-serif italic leading-snug text-slate-900 dark:text-cream-50"
        style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}
      >
        “{data.affirmation}”
      </p>
      <p className="mt-4 text-[16px] leading-relaxed text-slate-700 dark:text-slate-200">
        {data.reflection}
      </p>
    </section>
  );
}

// ───── Health section — exercise routines, plain English ─────
function HealthSection() {
  const dow = dayOfWeek();
  const [openIdx, setOpenIdx] = useState(0);
  const routine = EXERCISE_ROUTINES[dow] || EXERCISE_ROUTINES[0];

  return (
    <CardShell
      title={routine.day}
      subtitle={routine.summary}
      accent="emerald"
    >
      <div className="space-y-3">
        {routine.moves.map((move, i) => {
          const open = openIdx === i;
          return (
            <div
              key={i}
              className="rounded-2xl border border-emerald-100 dark:border-emerald-900/40 bg-white dark:bg-slate-800/60 overflow-hidden"
            >
              <button
                onClick={() => setOpenIdx(open ? -1 : i)}
                className="w-full text-left px-4 py-3.5 flex items-center justify-between gap-3 hover:bg-emerald-50/50 dark:hover:bg-slate-700/40"
              >
                <div className="min-w-0">
                  <div className="text-[16.5px] font-semibold text-slate-900 dark:text-cream-50 leading-snug">
                    {i + 1}. {move.name}
                  </div>
                  <div className="text-[13.5px] text-emerald-700 dark:text-emerald-400 font-medium">
                    {move.time}
                  </div>
                </div>
                {open ? (
                  <ChevronUp className="h-5 w-5 text-slate-400 flex-shrink-0" />
                ) : (
                  <ChevronDown className="h-5 w-5 text-slate-400 flex-shrink-0" />
                )}
              </button>
              {open && (
                <div className="px-4 pb-4 border-t border-emerald-100 dark:border-emerald-900/40">
                  <ol className="mt-3 space-y-2">
                    {move.instructions.map((step, j) => (
                      <li
                        key={j}
                        className="flex gap-3 text-[16px] leading-relaxed text-slate-800 dark:text-slate-200"
                      >
                        <span className="flex-shrink-0 mt-0.5 h-6 w-6 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300 text-[13px] font-bold flex items-center justify-center">
                          {j + 1}
                        </span>
                        <span>{step}</span>
                      </li>
                    ))}
                  </ol>
                  {move.why && (
                    <div className="mt-4 rounded-xl bg-amber-50/70 dark:bg-amber-900/20 border border-amber-200/60 dark:border-amber-700/30 px-3.5 py-2.5">
                      <div className="text-[12px] font-bold uppercase tracking-wider text-amber-800 dark:text-amber-400 mb-0.5">
                        Why
                      </div>
                      <p className="text-[14.5px] leading-relaxed text-amber-900 dark:text-amber-200">
                        {move.why}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-4 text-[13.5px] text-slate-500 dark:text-slate-400 leading-relaxed">
        Move slowly. Stop if anything sharpens or pinches. This is general guidance,
        not medical advice — if anything has been bothering you for a while, see
        someone in person.
      </p>
    </CardShell>
  );
}

// ───── Research links — small section, all working URLs ─────
function ResearchLinks({ onOutboundClick }) {
  return (
    <CardShell title="Research links" subtitle="Verified and current">
      <ul className="space-y-2.5">
        {RESEARCH_LINKS.map(link => (
          <li
            key={link.url}
            className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/40 p-3.5"
          >
            <a
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onOutboundClick}
              className="flex items-start justify-between gap-3 group"
            >
              <div className="min-w-0">
                <div className="text-[15.5px] font-semibold text-slate-900 dark:text-cream-50 group-hover:text-amber-700 dark:group-hover:text-amber-400">
                  {link.name}
                </div>
                <div className="text-[14px] text-slate-600 dark:text-slate-400 mt-0.5 leading-relaxed">
                  {link.blurb}
                </div>
              </div>
              <ExternalLink className="h-4 w-4 text-slate-400 dark:text-slate-500 flex-shrink-0 mt-1 group-hover:text-amber-700 dark:group-hover:text-amber-400" />
            </a>
          </li>
        ))}
      </ul>
    </CardShell>
  );
}

// ───── Charity blurb ─────
function CharityBlurb() {
  return (
    <div className="rounded-2xl bg-emerald-50/60 dark:bg-emerald-900/15 border border-emerald-200/60 dark:border-emerald-800/40 px-5 py-4">
      <div className="flex items-start gap-3">
        <Heart className="h-5 w-5 text-emerald-700 dark:text-emerald-400 flex-shrink-0 mt-0.5" />
        <div>
          <div className="text-[14.5px] font-semibold text-emerald-900 dark:text-emerald-200">
            What we hope to grow into
          </div>
          <p className="mt-1 text-[14px] leading-relaxed text-emerald-900/80 dark:text-emerald-200/90">
            As Morning Edge grows, a portion of subscription revenue will support
            programs for children and adults living with disabilities. We're not
            big enough to make those gifts yet — but it's the reason we're
            building this carefully.
          </p>
        </div>
      </div>
    </div>
  );
}

// ───── First-run onboarding overlay ─────
function OnboardingOverlay({ onComplete, name, setName }) {
  const [step, setStep] = useState(0);
  const [localName, setLocalName] = useState(name || '');

  const steps = [
    {
      icon: <Sun className="h-7 w-7 text-amber-500" />,
      title: 'A calm start to the day',
      body: 'Morning Edge gives you one short brief each morning — markets, body, and a thought to carry you forward. Pull down to refresh anytime.',
    },
    {
      icon: <Wallet className="h-7 w-7 text-amber-600" />,
      title: 'Bring your real portfolio',
      body: "Upload a CSV from any brokerage — Fidelity, Schwab, your 401k, anywhere. We sync the document, not your account. Your holdings stay on this device.",
    },
    {
      icon: <Compass className="h-7 w-7 text-emerald-600" />,
      title: "We won't trade for you",
      body: "Every suggestion has Accept and Dismiss. You decide. The brief is research-backed input, not a directive.",
    },
  ];

  const current = steps[step];
  const last = step === steps.length - 1;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full sm:max-w-md bg-cream-50 dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl shadow-2xl">
        <div className="p-6 sm:p-7">
          <div className="flex justify-center mb-4">
            <div className="rounded-2xl bg-amber-100 dark:bg-amber-900/30 p-3.5">{current.icon}</div>
          </div>
          <h2 className="text-[22px] font-bold text-center tracking-tight text-slate-900 dark:text-cream-50 leading-snug">
            {current.title}
          </h2>
          <p className="mt-3 text-center text-[16px] leading-relaxed text-slate-700 dark:text-slate-300">
            {current.body}
          </p>

          {last && (
            <div className="mt-5">
              <label className="block text-[13.5px] font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                What should we call you?
              </label>
              <input
                type="text"
                value={localName}
                onChange={e => setLocalName(e.target.value)}
                placeholder="Your first name"
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-[16px] text-slate-900 dark:text-cream-50 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>
          )}

          <div className="mt-6 flex items-center justify-between gap-3">
            <div className="flex gap-1.5">
              {steps.map((_, i) => (
                <div
                  key={i}
                  className={`h-1.5 rounded-full transition-all ${
                    i === step ? 'w-6 bg-amber-500' : 'w-1.5 bg-slate-300 dark:bg-slate-700'
                  }`}
                />
              ))}
            </div>
            <button
              onClick={() => {
                if (last) {
                  setName(localName.trim() || 'friend');
                  onComplete();
                } else {
                  setStep(step + 1);
                }
              }}
              className="rounded-full bg-slate-900 dark:bg-amber-200 text-cream-50 dark:text-slate-900 px-5 py-2.5 text-[15px] font-semibold inline-flex items-center gap-1.5"
            >
              {last ? 'Begin' : 'Next'}
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ───── Watchlist editor ─────
function WatchlistEditor({ watchlist, setWatchlist }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const sym = draft.trim().toUpperCase().replace(/[^A-Z.\-]/g, '');
    if (!sym || watchlist.includes(sym)) {
      setDraft('');
      return;
    }
    setWatchlist([...watchlist, sym]);
    setDraft('');
  };
  return (
    <CardShell title="Watchlist" subtitle="The names you want kept in view">
      <div className="flex flex-wrap gap-1.5 mb-3">
        {watchlist.map(s => (
          <span
            key={s}
            className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 px-3 py-1 text-[14px] font-mono font-semibold"
          >
            {s}
            <button
              onClick={() => setWatchlist(watchlist.filter(x => x !== s))}
              className="text-slate-400 hover:text-rose-600 dark:hover:text-rose-400"
              aria-label={`Remove ${s}`}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </span>
        ))}
        {watchlist.length === 0 && (
          <span className="text-[14px] text-slate-500 dark:text-slate-400">
            Empty — add a few tickers below.
          </span>
        )}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && add()}
          placeholder="Add ticker (e.g. NVDA)"
          className="flex-1 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-[16px] text-slate-900 dark:text-cream-50 px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-amber-400"
        />
        <button
          onClick={add}
          className="rounded-xl bg-slate-900 dark:bg-amber-200 text-cream-50 dark:text-slate-900 px-4 text-[15px] font-semibold"
        >
          Add
        </button>
      </div>
    </CardShell>
  );
}
// =====================================================================
// MAIN COMPONENT
// =====================================================================

export default function MorningEdge() {
  // ----- Persistent state -----
  const [user, setUser] = useState({ name: '' });
  const [watchlist, setWatchlist] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [holdings, setHoldings] = useState([]);
  const [accepted, setAccepted] = useState({});
  const [dismissed, setDismissed] = useState({});
  const [onboarded, setOnboarded] = useState(true); // assume true until first effect proves otherwise
  const [hydrated, setHydrated] = useState(false);

  // ----- UI state -----
  const [tab, setTab] = useState('wealth'); // wealth | health | clarity
  const [showSettings, setShowSettings] = useState(false);
  const [showAccountManager, setShowAccountManager] = useState(false);

  // ----- Hooks -----
  const isMobile = useIsMobile();
  const { isDark, pref: darkPref, cyclePref, setDarkPref } = useDarkMode();
  const { cards, errors, status, meta, start } = useStreamingBrief();
  const returnPill = useOutboundReturnPill();

  // ----- Hydrate from localStorage -----
  useEffect(() => {
    migrateLegacyHoldings();
    const u = safeRead(STORAGE_KEYS.user, { name: '' });
    setUser(u);
    setWatchlist(safeRead(STORAGE_KEYS.watchlist, []));
    setAccounts(safeRead(STORAGE_KEYS.accounts, []));
    setHoldings(safeRead(STORAGE_KEYS.holdings, []));
    setOnboarded(!!safeRead(STORAGE_KEYS.onboarded, false));
    const today = todayKey();
    const allAccepted = safeRead(STORAGE_KEYS.accepted, {});
    const allDismissed = safeRead(STORAGE_KEYS.dismissed, {});
    setAccepted(allAccepted[today] || {});
    setDismissed(allDismissed[today] || {});
    setHydrated(true);
  }, []);

  // ----- Persist changes -----
  useEffect(() => {
    if (hydrated) safeWrite(STORAGE_KEYS.user, user);
  }, [user, hydrated]);
  useEffect(() => {
    if (hydrated) safeWrite(STORAGE_KEYS.watchlist, watchlist);
  }, [watchlist, hydrated]);
  useEffect(() => {
    if (hydrated) safeWrite(STORAGE_KEYS.accounts, accounts);
  }, [accounts, hydrated]);
  useEffect(() => {
    if (hydrated) safeWrite(STORAGE_KEYS.holdings, holdings);
  }, [holdings, hydrated]);
  useEffect(() => {
    if (!hydrated) return;
    const all = safeRead(STORAGE_KEYS.accepted, {});
    all[todayKey()] = accepted;
    safeWrite(STORAGE_KEYS.accepted, all);
  }, [accepted, hydrated]);
  useEffect(() => {
    if (!hydrated) return;
    const all = safeRead(STORAGE_KEYS.dismissed, {});
    all[todayKey()] = dismissed;
    safeWrite(STORAGE_KEYS.dismissed, all);
  }, [dismissed, hydrated]);

  // ----- Apply dark mode class -----
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.classList.toggle('dark', isDark);
  }, [isDark]);

  // ----- Build brief request payload -----
  const briefPayload = useMemo(
    () => ({
      name: user.name || '',
      watchlist,
      accounts,
      holdings,
    }),
    [user.name, watchlist, accounts, holdings]
  );

  // ----- Auto-fetch on first hydrated render -----
  useEffect(() => {
    if (!hydrated || !onboarded) return;
    // Check ?fresh=1 in URL
    const fresh =
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('fresh') === '1';
    start(briefPayload, { fresh });
    // Only on first hydrate; pull-to-refresh handles re-fetches
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, onboarded]);

  // ----- Pull-to-refresh -----
  const handlePullRefresh = useCallback(async () => {
    await start(briefPayload, { fresh: true });
  }, [start, briefPayload]);
  const { pull, refreshing } = usePullToRefresh(handlePullRefresh, {
    enabled: hydrated && onboarded,
  });

  // ----- Handlers -----
  const setName = name => setUser(u => ({ ...u, name }));
  const completeOnboarding = () => {
    setOnboarded(true);
    safeWrite(STORAGE_KEYS.onboarded, true);
  };
  const acceptItem = id => setAccepted(a => ({ ...a, [id]: true }));
  const dismissItem = id => setDismissed(d => ({ ...d, [id]: true }));

  // ----- Derived -----
  const lastSyncedLabel = useMemo(() => {
    if (accounts.length === 0) return null;
    const latest = accounts.reduce((max, a) => {
      const t = new Date(a.uploadedAt).getTime();
      return t > max ? t : max;
    }, 0);
    if (!latest) return null;
    const days = Math.floor((Date.now() - latest) / (24 * 60 * 60 * 1000));
    if (days === 0) return 'synced today';
    if (days === 1) return 'synced 1 day ago';
    return `synced ${days} days ago`;
  }, [accounts]);

  const greeting = (() => {
    const h = new Date().getHours();
    const part = h < 5 ? 'Good early morning' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
    return user.name ? `${part}, ${user.name}` : part;
  })();

  // ----- Render: pre-onboarding -----
  if (hydrated && !onboarded) {
    return (
      <ThemeWrapper isDark={isDark}>
        <OnboardingOverlay onComplete={completeOnboarding} name={user.name} setName={setName} />
      </ThemeWrapper>
    );
  }

  // ----- Render: main app -----
  return (
    <ThemeWrapper isDark={isDark}>
      <PullIndicator pull={pull} refreshing={refreshing} />
      <ReturnPill visible={returnPill.visible} onDismiss={returnPill.dismiss} />

      {/* Top bar */}
      <header className="sticky top-0 z-30 bg-cream-50/85 dark:bg-slate-900/85 backdrop-blur-md border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div>
            <div className="text-[13px] text-slate-500 dark:text-slate-400 font-medium">
              {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            </div>
            <div className="text-[18px] font-bold text-slate-900 dark:text-cream-50 leading-tight">
              {greeting}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={cyclePref}
              className="rounded-full p-2 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
              aria-label={`Theme: ${darkPref}`}
              title={`Theme: ${darkPref}`}
            >
              {isDark ? (
                <Moon className="h-5 w-5 text-amber-300" />
              ) : (
                <Sun className="h-5 w-5 text-amber-600" />
              )}
            </button>
            <button
              onClick={() => setShowSettings(true)}
              className="rounded-full p-2 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
              aria-label="Settings"
            >
              <Settings className="h-5 w-5 text-slate-700 dark:text-slate-300" />
            </button>
          </div>
        </div>

        <Ticker
          watchlist={watchlist}
          accounts={accounts}
          holdings={holdings}
          convictionItems={cards.conviction_watch?.content?.items}
          lastSynced={lastSyncedLabel}
        />
      </header>

      {/* Main scrollable content */}
      <main className="max-w-2xl mx-auto px-4 pt-4 pb-32 space-y-4">
        {/* Compact sync box (always visible) */}
        <SyncBox
          accounts={accounts}
          holdings={holdings}
          onOpenManager={() => setShowAccountManager(true)}
          isMobile={isMobile}
        />

        {/* Status banner — only when something interesting */}
        {status === 'failed' && (
          <div className="rounded-2xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40 p-4 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-amber-700 dark:text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-[15px] font-semibold text-slate-900 dark:text-cream-50">
                Today's brief didn't generate
              </div>
              <p className="mt-1 text-[14px] leading-relaxed text-slate-700 dark:text-slate-300">
                The market data service didn't answer. Pull down at the top of the
                screen to try again. Your data is safe.
              </p>
            </div>
          </div>
        )}

        {tab === 'wealth' && (
          <>
            <TodayEdgeCard data={cards.today_edge?.content} />
            <MarketPulseCard data={cards.market_pulse?.content} />
            <ConvictionWatchCard data={cards.conviction_watch?.content} />
            <PlaybookCard
              data={cards.today_playbook?.content}
              accepted={accepted}
              dismissed={dismissed}
              onAccept={acceptItem}
              onDismiss={dismissItem}
            />
            {watchlist.length > 0 || accounts.length > 0 ? null : (
              <div className="rounded-2xl bg-slate-100 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 p-5">
                <div className="text-[15.5px] font-semibold text-slate-900 dark:text-cream-50">
                  Personalize the brief
                </div>
                <p className="mt-1 text-[14.5px] leading-relaxed text-slate-700 dark:text-slate-300">
                  Add a watchlist below or sync a portfolio above and tomorrow's
                  brief will speak about the names you actually own.
                </p>
              </div>
            )}
            <WatchlistEditor watchlist={watchlist} setWatchlist={setWatchlist} />
            <ResearchLinks onOutboundClick={returnPill.trigger} />
          </>
        )}

        {tab === 'health' && (
          <>
            <HealthSection />
          </>
        )}

        {tab === 'clarity' && (
          <>
            <MealCard data={cards.today_meal?.content} />
            <WisdomCard data={cards.today_wisdom?.content} />
            <CharityBlurb />
          </>
        )}
      </main>

      {/* Bottom nav — Wealth · Health · Clarity */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 bg-cream-50/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 safe-bottom">
        <div className="max-w-2xl mx-auto px-2 grid grid-cols-3">
          <NavButton
            label="Wealth"
            icon={<Wallet className="h-5 w-5" />}
            active={tab === 'wealth'}
            onClick={() => setTab('wealth')}
          />
          <NavButton
            label="Health"
            icon={<Heart className="h-5 w-5" />}
            active={tab === 'health'}
            onClick={() => setTab('health')}
          />
          <NavButton
            label="Clarity"
            icon={<Compass className="h-5 w-5" />}
            active={tab === 'clarity'}
            onClick={() => setTab('clarity')}
          />
        </div>
      </nav>

      {/* Modals */}
      <AccountManagerModal
        open={showAccountManager}
        onClose={() => setShowAccountManager(false)}
        accounts={accounts}
        holdings={holdings}
        setAccounts={setAccounts}
        setHoldings={setHoldings}
        isMobile={isMobile}
        onOutboundClick={returnPill.trigger}
      />
      <SettingsModal
        open={showSettings}
        onClose={() => setShowSettings(false)}
        user={user}
        setUser={setUser}
        darkPref={darkPref}
        setDarkPref={setDarkPref}
      />
    </ThemeWrapper>
  );
}

// ───── Bottom nav button ─────
function NavButton({ label, icon, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center justify-center py-2.5 transition-colors ${
        active
          ? 'text-amber-700 dark:text-amber-400'
          : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
      }`}
      aria-current={active ? 'page' : undefined}
    >
      <div className={active ? 'transform scale-105' : ''}>{icon}</div>
      <div className="mt-1 text-[12.5px] font-semibold tracking-wide">{label}</div>
    </button>
  );
}

// ───── Settings modal ─────
function SettingsModal({ open, onClose, user, setUser, darkPref, setDarkPref }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full sm:max-w-md bg-cream-50 dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-cream-50/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 px-5 py-4 flex items-center justify-between rounded-t-3xl">
          <h2 className="text-[19px] font-semibold text-slate-900 dark:text-cream-50">Settings</h2>
          <button
            onClick={onClose}
            className="rounded-full p-2 hover:bg-slate-200 dark:hover:bg-slate-800"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="px-5 py-5 space-y-5">
          <div>
            <label className="block text-[14px] font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              Your name
            </label>
            <input
              type="text"
              value={user.name || ''}
              onChange={e => setUser({ ...user, name: e.target.value })}
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-[16px] text-slate-900 dark:text-cream-50 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
          </div>

          <div>
            <div className="text-[14px] font-semibold text-slate-700 dark:text-slate-300 mb-2">
              Theme
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/40 overflow-hidden">
              {[
                ['auto', 'Auto', 'Follow your device'],
                ['off', 'Light', 'Cream and amber'],
                ['on', 'Dark', 'Easy on early eyes'],
              ].map(([key, label, sub]) => (
                <button
                  key={key}
                  onClick={() => setDarkPref(key)}
                  className={`w-full text-left px-4 py-3 flex items-center justify-between border-b border-slate-100 dark:border-slate-800 last:border-b-0 ${
                    darkPref === key ? 'bg-amber-50 dark:bg-amber-900/20' : ''
                  }`}
                >
                  <div>
                    <div className="text-[15px] font-semibold text-slate-900 dark:text-cream-50">
                      {label}
                    </div>
                    <div className="text-[13px] text-slate-500 dark:text-slate-400">
                      {sub}
                    </div>
                  </div>
                  {darkPref === key && (
                    <Check className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                  )}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[12.5px] text-slate-500 dark:text-slate-400 leading-relaxed">
              Tip: tap the sun/moon in the header to cycle themes quickly.
            </p>
          </div>

          <div className="rounded-xl bg-slate-100 dark:bg-slate-800/40 p-4 text-[13px] leading-relaxed text-slate-600 dark:text-slate-400">
            Morning Edge keeps everything on this device. Pull down on the brief
            to refresh. There is no auto-trading and no broker connection — only
            the CSV files you choose to upload.
          </div>
        </div>
      </div>
    </div>
  );
}

// ───── Theme wrapper — applies palette + global styles ─────
function ThemeWrapper({ isDark, children }) {
  return (
    <div
      className={`min-h-screen ${isDark ? 'dark' : ''}`}
      style={{
        backgroundColor: isDark ? '#0f172a' : '#fdfcf7',
        color: isDark ? '#f5f5f0' : '#0f172a',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
        fontSize: '17px',
        lineHeight: 1.5,
        WebkitFontSmoothing: 'antialiased',
        MozOsxFontSmoothing: 'grayscale',
      }}
    >
      <style>{globalStyles}</style>
      {children}
    </div>
  );
}

// ───── Global styles (minimal, additive — Tailwind handles the rest) ─────
const globalStyles = `
  :root { --cream-50: #fdfcf7; }
  .bg-cream-50 { background-color: #fdfcf7; }
  .text-cream-50 { color: #fdfcf7; }
  .border-cream-50 { border-color: #fdfcf7; }
  body { font-size: 17px; -webkit-text-size-adjust: 100%; }
  .safe-bottom { padding-bottom: env(safe-area-inset-bottom, 0px); }

  @keyframes marquee {
    0%   { transform: translateX(0); }
    100% { transform: translateX(-50%); }
  }
  .animate-marquee {
    animation: marquee 60s linear infinite;
  }
  @keyframes fade-in {
    from { opacity: 0; transform: translateY(-4px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .animate-fade-in {
    animation: fade-in 0.25s ease-out;
  }

  /* Pull-to-refresh: disable default browser overscroll on iOS so our
     custom indicator is the only one the user sees. */
  html, body { overscroll-behavior-y: contain; }

  /* Larger tap targets — every interactive element 44px min. */
  button, a, input { min-height: 36px; }
`;
