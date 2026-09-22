import { supabase } from './supabase';
import { lookupQldRule, evaluateRule } from './rules';

// ────────────────────────────────────────────────────────────────
// Ask Fishlore — the local curated fishing guide (V1.1).
//
// This is NOT a language model. It is a deterministic answer engine:
//   * every regulatory figure (min/max size, bag limits) is read LIVE from
//     the species/fishing_rules tables via the shared resolver in rules.ts —
//     the same resolver Add Catch uses to judge a length, so the guide can
//     never quote a rule that contradicts the leaderboard's legality gate.
//   * contextual answers (seasons, bait, rigs, tackle, tides, how-to) come
//     from the curated KNOWN guides below. No number from that text is
//     regulatory — those always come from the database.
//   * the UI labels this a "guide", never an "AI".
//
// Species resolution mirrors the app's free-text rule: common_name first,
// then alternate_names; the longest phrase match wins ("goldenline whiting"
// beats the generic "whiting" alias).
// ────────────────────────────────────────────────────────────────

export interface RuleCard {
  species: string;
  minLength: number | null;
  maxLength: number | null;
  noTake: boolean;
  possessionLimit: number | null;
  slotLabel: string;
  bagLabel: string;
  sourceName: string;
  sourceUrl: string | null;
}

export interface AssistantAnswer {
  text: string;
  title?: string; // optional heading (topic guides)
  rule?: RuleCard | null;
  followUps: string[];
  sources: { label: string; url?: string }[];
}

// ── Tokenizer ─────────────────────────────────────────────────
const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'be', 'do', 'does', 'did', 'for', 'of', 'to',
  'in', 'on', 'at', 'with', 'what', 'whats', 'how', 'when', 'where', 'which', 'why',
  'i', 'im', 'me', 'my', 'can', 'could', 'should', 'would', 'legal', 'size', 'limit',
  'and', 'or', 'but', 'not', 'get', 'got', 'give', 'tell', 'me', 'about', 'some',
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/^'+|'+$/g, ''))
    .filter((t) => t.length > 0 && !STOPWORDS.has(t));
}

// ── Live species catalog (module-cached for the session) ───────
interface CatalogSpecies {
  id: string;
  name: string;
  phrases: string[][]; // common_name + each alternate_name, word-tokenized
}

let catalogPromise: Promise<CatalogSpecies[]> | null = null;

async function loadCatalogInternal(): Promise<CatalogSpecies[]> {
  const { data, error } = await supabase
    .from('species')
    .select('id, common_name, alternate_names')
    .order('common_name');
  if (error || !data) return [];
  type Row = { id: string; common_name: string; alternate_names: string[] | null };
  return (data as Row[]).map((s) => ({
    id: s.id,
    name: s.common_name,
    phrases: [
      tokenize(s.common_name),
      ...(s.alternate_names || []).map((a) => tokenize(a)),
    ],
  }));
}

function loadCatalog(): Promise<CatalogSpecies[]> {
  if (!catalogPromise) catalogPromise = loadCatalogInternal();
  return catalogPromise;
}

function findPhrase(words: string[], phrase: string[]): boolean {
  if (phrase.length === 0) return false;
  outer: for (let i = 0; i + phrase.length <= words.length; i++) {
    for (let j = 0; j < phrase.length; j++) {
      if (words[i + j] !== phrase[j]) continue outer;
    }
    return true;
  }
  return false;
}

// Longest phrase match wins ("goldenline whiting" beats the generic "whiting").
function matchSpecies(words: string[], catalog: CatalogSpecies[]): CatalogSpecies | null {
  let best: CatalogSpecies | null = null;
  let bestLen = 0;
  for (const s of catalog) {
    for (const phrase of s.phrases) {
      const len = phrase.length;
      if (len > bestLen && findPhrase(words, phrase)) {
        best = s;
        bestLen = len;
      }
    }
  }
  // Common-shorthand fallback: anglers say "flathead" or "bream", not the full
  // "Dusky Flathead". Match on the LAST word of a species phrase and prefer the
  // shortest common name, so generic "whiting" resolves to Sand Whiting.
  if (!best) {
    for (const s of catalog) {
      for (const phrase of s.phrases) {
        if (phrase.length > 1 && words.includes(phrase[phrase.length - 1])) {
          if (!best || s.name.length < best.name.length) best = s;
        }
      }
    }
  }
  return best;
}

// ── Curated Gold Coast knowledge bank ─────────────────────────
interface Guide {
  id: string;
  title: string;
  body: string;
  keywords: string[];
  speciesNames: string[]; // co-score with a species hit ("bait for flathead")
}

const GUIDES: Guide[] = [
  {
    id: 'rules-overview',
    title: 'Recreational rules at a glance',
    body:
      'On Queensland tidal waters every angler needs a recreational fishing licence, ' +
      'and species have size limits (either a minimum, or a slot with a max) and bag limits. ' +
      'Rules apply whichever way you catch them — keep only what the law allows, return ' +
      'undersized, over-slot and no-take species carefully. Bag limits can be shared across ' +
      'a combined group (e.g. the bream / whiting groups).',
    keywords: ['rules', 'regulation', 'legal', 'law', 'bag', 'possession', 'licence', 'license', 'keep'],
    speciesNames: [],
  },
  {
    id: 'whats-biting',
    title: 'What\'s biting — a Gold Coast season guide',
    body:
      'The Gold Coast is a year-round fishery, just with different moods:\n\n' +
      '•  Summer — tailor along the wash and rock walls, flathead on the estuary drop-offs, ' +
      '   mangrove jack tucked into the canals at first light.\n' +
      '•  Autumn — arguably the pick of the year: whiting and bream get thick on the sand ' +
      '   flats, and mulloway work the seaway into the night.\n' +
      '•  Winter — whiting still rate on worms over the flats, flathead slow up on plastics ' +
      '   on the warmer afternoons, and the tailor run can fire when the water is clean.\n' +
      '•  Spring — everything builds back toward summer; baitfish arrive and the flats ' +
      '   switch on again.\n\n' +
      'The Explore map’s activity bubbles show where anglers have actually been catching ' +
      'over the last 30 days.',
    keywords: ['biting', 'bite', 'bites', 'season', 'now', 'month', 'months', 'winter', 'summer', 'spring', 'autumn', 'calendar', 'year', 'decent'],
    speciesNames: [],
  },
  {
    id: 'bait-guide',
    title: 'Bait and what catches what',
    body:
      'Live or fresh beats frozen: nippers (yabbies) and worms are deadly for whiting and bream ' +
      'on sand flats; fresh prawns and cut bait work almost anywhere; garfish and whitebait ' +
      'match the bigger predators (tailor, mulloway). Soft plastics and hard-bodies are the ' +
      'lure route — choose prawn and yabby patterns for flathead and bream, and metal slugs ' +
      'when tailor are slashing on the surface.',
    keywords: ['bait', 'baiting', 'prawn', 'yabby', 'yabbies', 'nipp', 'worm', 'squid', 'garfish', 'whitebait', 'lure', 'plastic', 'slug', 'mullet', 'chicken'],
    speciesNames: [],
  },
  {
    id: 'rig-guide',
    title: 'Basic rigs',
    body:
      'A running-sinker rig (sinker running free above a swivel, then a 40–60 cm trace to a ' +
      'single hook) is the Gold Coast default for bait on the bottom. A paternoster — sinker on ' +
      'the bottom, one or two droppers above — keeps bait up off weed over sand and rubble. ' +
      'A float rig suspends live or fresh bait right where surface feeders are working. Keep ' +
      'traces light (6–10 kg line and a small hook) unless you are chasing mulloway.',
    keywords: ['rig', 'paternoster', 'sinker', 'float', 'ledger', 'trace', 'dropper', 'setup', 'setup'],
    speciesNames: [],
  },
  {
    id: 'tackle-guide',
    title: 'Rod, reel and line basics',
    body:
      'A 2.7–3.2 m spin outfit around 4–8 kg is the versatile Gold Coast rod: long enough to ' +
      'cast the surf and ocean jetties, light enough for estuary whiting. Braid (10–15 lb) casts ' +
      'further and feels more bites; a fluorocarbon or mono leader hides the main line and shrugs ' +
      'off snags. Match the hook to the bait, not the fish — a prawn on a 2/0 is a very dead prawn.',
    keywords: ['rod', 'reel', 'braid', 'mono', 'line', 'leader', 'hook', 'tackle', 'gear', 'outfit', 'spool', 'cast'],
    speciesNames: [],
  },
  {
    id: 'tide-guide',
    title: 'Tides and the best times',
    body:
      'Gold Coast classic: fish the run of a moving tide — the first hour either side of push and ' +
      'drop — plus dawn and dusk as the low-light windows. Estuaries switch on as water runs in ' +
      'and bait moves off the flats; surf beaches fish best running up onto the tide. Flat, glassy ' +
      'water with a light north-easterly is the Gold Coast surf mood. Check the local tide chart ' +
      'before you leave and plan around the change points.',
    keywords: ['tide', 'tidal', 'high', 'low', 'water', 'swell', 'wind', 'moon', 'dawn', 'dusk', 'sunrise', 'sunset', 'current', 'run-in', 'changes'],
    speciesNames: [],
  },
  {
    id: 'spots-guide',
    title: 'Where to fish on the Gold Coast',
    body:
      'The Gold Coast offers three main styles: protected bays and canals (Broadwater, the ' +
      'seaways — sheltered, great for whiting and bream on the change of light), ocean sand ' +
      'beaches and headlands (surf tailor in the wash, flathead on the gutters), and the rock ' +
      'walls and jetties that attract mulloway, tailor and trevally. The "activity map" tab shows ' +
      'where anglers have been catching lately, broken into broad areas rather than exact spots.',
    keywords: ['spot', 'spots', 'where', 'location', 'beach', 'jetty', 'seaway', 'canal', 'estuary', 'headland', 'point', 'broadwater', 'surf', 'map'],
    speciesNames: [],
  },
  {
    id: 'whiting-guide',
    title: 'Whiting — the Gold Coast classic',
    body:
      'Sand whiting are a genuine all-rounder: winter is prime, but they sit on sand flats and ' +
      'gutters most of the year. Nippers or worms on a fine trace, fished slowly with a touch ' +
      'of movement, is the classic presentation. Cast into the run of water just off the flats ' +
      'rather than right at your feet.',
    keywords: [],
    speciesNames: ['Sand Whiting', 'Goldenline Whiting', 'Northern Whiting', 'Trumpeter Whiting'],
  },
  {
    id: 'tailor-guide',
    title: 'Tailor — the surf and wall strikes',
    body:
      'Tailor move in waves through the ocean wash and along the rock walls, often early and ' +
      'late. Metal slugs or white/jelly lures cast through the action, or a garfish bait under ' +
      'a float, all get smashed when the run is on. Check your line for teeth — a short wire ' +
      'or heavy mono leader stops the bite-offs.',
    keywords: ['chopper', 'run', 'slashing'],
    speciesNames: ['Tailor'],
  },
  {
    id: 'flathead-guide',
    title: 'Flathead on plastics',
    body:
      'Flathead ambush from sandy drop-offs and the edges of weed beds. A soft plastic worked ' +
      'slowly along the bottom — hops and pauses — is the textbook approach, with prawn and ' +
      'yabby patterns the safe bets. They hang in the shallows on a push of tide and love the ' +
      'last hour of light.',
    keywords: ['plastic', 'lure'],
    speciesNames: ['Dusky Flathead'],
  },
  {
    id: 'bream-guide',
    title: 'Bream on the flats',
    body:
      'Bream shelter in the moored boats, jetty pylons and sand-capped flats of the Broadwater. ' +
      'Nippers, chicken gut or small fresh prawn on a light trace, fished tight to structure, ' +
      'is the reliable approach. They are cautious — feel for the bite and strike gently.',
    keywords: [],
    speciesNames: ['Yellowfin Bream', 'Pikey Bream', 'Tarwhine'],
  },
  {
    id: 'mulloway-guide',
    title: 'Mulloway — the seaway prizes',
    body:
      'Mulloway patrol the seaway and deep rocky gutters, most often at night or in low light. ' +
      'Fresh garfish or a whole pillie on a heavy live-bait style rig, fished right on the ' +
      'structure, earns attention. They run hard — set a firm drag and be patient.',
    keywords: [],
    speciesNames: ['Mulloway'],
  },
  {
    id: 'how-leaderboard',
    title: 'How logging a catch works',
    body:
      'Log a catch in the Add Catch tab with length, weight and a photo. The app checks the ' +
      'species against the QLD size rule; only a catch that is legally keepable, verified and ' +
      'tagged for the board can be ranked — an out-of-slot or no-take fish still appears on the ' +
      'feed, celebrated as a catch-and-release, but is never ranked. That is deliberate: the ' +
      'leaderboard is for keepable fish only.',
    keywords: ['leaderboard', 'rank', 'ranking', 'log', 'logging', 'record', 'add', 'catch', 'photo', 'verified', 'verification', 'feed'],
    speciesNames: [],
  },
];

function scoreGuides(words: string[], speciesName: string | null): Guide[] {
  const scored: { g: Guide; s: number }[] = GUIDES.map((g) => {
    let s = 0;
    for (const kw of g.keywords) {
      const kwTokens = tokenize(kw);
      if (kwTokens.length > 0 && findPhrase(words, kwTokens)) {
        s += kwTokens.length; // multi-word keyword matters more
      }
    }
    if (speciesName && g.speciesNames.includes(speciesName)) s += 3;
    return { g, s };
  });
  scored.sort((a, b) => b.s - a.s);
  return scored.filter((x) => x.s > 0).map((x) => x.g);
}

const SPOT_WORDS = new Set([
  'spot', 'spots', 'where', 'location', 'beach', 'jetty', 'seaway', 'canal',
  'estuary', 'headland', 'point', 'broadwater', 'surf', 'map', 'places', 'place',
]);

function hasAny(words: string[], set: Set<string>): boolean {
  return words.some((w) => set.has(w));
}

// ── Rule card assembly ────────────────────────────────────────
// slotPhrase is a reusable, grammar-safe form of the size rule for prose.
function slotPhrase(rule: {
  minLength: number | null;
  maxLength: number | null;
  noTake: boolean;
}): string {
  if (rule.noTake) return 'no-take';
  if (rule.minLength != null && rule.maxLength != null) return `${rule.minLength}–${rule.maxLength} cm slot`;
  if (rule.minLength != null) return `${rule.minLength} cm minimum`;
  if (rule.maxLength != null) return `${rule.maxLength} cm maximum`;
  return 'no published size limit';
}

// "QLD tidal whiting group (sand/goldenline/northern)" → "whiting group".
function friendlyGroupName(name: string): string {
  const lower = name.toLowerCase();
  for (const family of ['bream', 'whiting', 'trevally']) {
    if (lower.includes(family)) return `${family} group`;
  }
  return name;
}

function buildRuleCard(rule: NonNullable<Awaited<ReturnType<typeof lookupQldRule>>>): RuleCard {
  const { minLength, maxLength, noTake, speciesName } = rule;
  const slot = slotPhrase(rule);

  let slotLabel = slot;
  if (noTake) slotLabel = 'no-take — catch and release only';
  else if (minLength == null && maxLength == null) slotLabel = 'no size limit on record';

  let bagLabel = 'no bag limit on record';
  if (noTake) bagLabel = 'no-take — must be released';
  else if (rule.possessionLimit != null) {
    bagLabel = rule.combinedLimitName
      ? `Bag ${rule.possessionLimit} (shared ${friendlyGroupName(rule.combinedLimitName)})`
      : `Bag ${rule.possessionLimit}`;
  }

  return {
    species: speciesName,
    minLength,
    maxLength,
    noTake,
    possessionLimit: rule.possessionLimit,
    slotLabel,
    bagLabel,
    sourceName: rule.sourceName,
    sourceUrl: rule.sourceUrl,
  };
}

const SUGGESTIONS = [
  'What bites best this season?',
  'Where are the good spots around the Gold Coast?',
  'What bait should I use?',
  'What rig should I start with?',
  'How do I log a catch?',
  'What size can I keep a flathead?',
];

// ── The main entry point ──────────────────────────────────────
export async function askAssistant(query: string): Promise<AssistantAnswer> {
  const raw = query.trim();
  const words = tokenize(raw);

  const noAnswer: AssistantAnswer = {
    text:
      "I couldn't find a good match for that — sorry. I'm a curated guide, so I know my lane:\n\n" +
      '•  Species size and bag limits\n' +
      '•  Whether a length is legal (“is 60 cm flathead OK?”)\n' +
      '•  Where to fish around the Gold Coast\n' +
      '•  Bait, rigs, tackle and tides\n' +
      '•  How logging catches and the leaderboard work',
    followUps: SUGGESTIONS,
    sources: [],
  };

  if (words.length === 0) return noAnswer;

  const catalog = await loadCatalog();
  const speciesHit = matchSpecies(words, catalog);

  // A length anywhere in the query flips the question into "is this legal?".
  const sizeMatch = raw.toLowerCase().match(/(\d+(?:\.\d+)?)\s*(?:cm|centimetre|centimeter)/);
  const measured = sizeMatch ? Number(sizeMatch[1]) : null;

  const rule = speciesHit ? await lookupQldRule(speciesHit.name) : null;
  const wantSpots = hasAny(words, SPOT_WORDS);

  // ── Species question (rule or measured legality) ─────────────
  if (speciesHit) {
    if (!rule) {
      return {
        text: `${speciesHit.name} is on record as a species here, but there's no currently-effective ` +
        'size rule to show yet. Species with no verified rule are never ranked on the ' +
        'leaderboard, and releases are always the safe call.',
        followUps: ['What can I keep on the Gold Coast?', SUGGESTIONS[0], SUGGESTIONS[1]],
        sources: [],
      };
    }

    const card = buildRuleCard(rule);
    let text = '';
    let followUps: string[] = [];

    const slot = slotPhrase(rule);
    const hasSizeRule = rule.minLength != null || rule.maxLength != null;

    if (measured != null) {
      const verdict = evaluateRule(rule, measured);
      if (verdict.kind === 'ok') {
        if (!hasSizeRule) {
          text =
            `There's no published size limit for ${rule.speciesName} on the books right now, ` +
            `so a ${measured} cm one is within the rules as far as size goes. ` +
            `${card.bagLabel.startsWith('Bag') ? `Still remember the score: ${card.bagLabel.toLowerCase()}.` : 'Mind the bag and possession rules when taking them.'}`;
        } else {
          text =
            `Yes — ${measured} cm of ${rule.speciesName} fits the ${slot}, so it's legal to keep. ` +
            `${card.bagLabel.startsWith('Bag') ? `Bag limit: ${card.bagLabel.toLowerCase()}.` : ''}`;
        }
      } else if (verdict.kind === 'no_take') {
        text = `${rule.speciesName} is no-take — no size is legal. Every catch must be carefully released, whatever the length.`;
      } else if (verdict.kind === 'undersized') {
        text = `No — ${measured} cm is under the ${slot}. It must be returned to the water; it will never rank on the board.`;
      } else {
        text = `No — ${measured} cm is over the ${slot}. It must be released; out-of-slot fish are never ranked.`;
      }
      followUps = [
        `What's the bag limit for ${rule.speciesName}?`,
        `What bait works for ${rule.speciesName}?`,
        `Where can I catch ${rule.speciesName}?`,
      ];
    } else {
      text =
        `Here's the rule for ${rule.speciesName} on Queensland tidal waters: ` +
        `size ${slot}, and ${card.bagLabel.toLowerCase()}. ` +
        `Only a legally-keepable catch is ever ranked on the leaderboard.`;
      followUps = [
        `Is a 60 cm ${rule.speciesName} legal?`,
        `What bait works for ${rule.speciesName}?`,
        `Where can I catch ${rule.speciesName}?`,
      ];
    }

    // Pair the rule with the best matching topic guide if one scored.
    const guides = scoreGuides(words, rule.speciesName);
    if (guides.length > 0) {
      const g = guides[0];
      text += `\n\n${g.body}`;
    }

    // "Where can I catch X?" — append the live spot map without losing the rule.
    if (wantSpots) {
      try {
        const spotsSummary = await fetchSpotsSummary();
        if (spotsSummary) text += `\n\n${spotsSummary}`;
      } catch (error: any) {
        if (/relation .* does not exist/i.test(error.message)) {
          text += '\n\nThe activity map tables aren\'t live on this project yet — ask me about baits or rigs instead.';
        }
      }
    }

    return { text, rule: card, followUps, sources: [{ label: card.sourceName, url: card.sourceUrl ?? undefined }] };
  }

  // ── Spot / "where do I fish" or "what's biting" (no species named) ──
  if (wantSpots) {
    let text: string;
    try {
      text = await fetchSpotsSummary();
    } catch (error: any) {
      if (/relation .* does not exist/i.test(error.message)) return notLiveSpotsAnswer();
      text = 'Something went wrong loading the spot map — give it another go in a moment.';
    }
    if (!text) {
      text =
        'There aren\'t any spots recorded in the map just yet — try asking me about species rules or the best bait instead.';
    }
    return {
      text,
      followUps: ['What bait should I use?', 'What size can I keep a whiting?', 'How do I log a catch?'],
      sources: [],
    };
  }

  // ── Spot / "where do I fish" or "what's biting" ──────────────
  // Shared by the spots branch AND appended onto species answers when the
  // question is "where can I catch X?".
  async function fetchSpotsSummary(): Promise<string> {
    let spotsText = '';
    let activityLine = '';
    const { data: spots, error: spotsErr } = await supabase
      .from('fishing_spots_public')
      .select('name, region_bubble_name')
      .order('name');
    if (spotsErr) throw spotsErr;

    const { data: activity, error: actErr } = await supabase
      .from('regional_activity_metrics')
      .select('name, activity_tier, catch_count_30d');
    if (actErr) throw actErr;

    if ((spots || []).length > 0) {
      spotsText =
        'Here are the spots logged around the Gold Coast right now:\n\n' +
        (spots as any[])
          .map((s: any) => `•  ${s.name}${s.region_bubble_name ? ` — ${s.region_bubble_name} area` : ''}`)
          .join('\n') +
        '\n\nExact coordinates stay private to each owner — you see the area, not the pin.';
    }
    const active = (activity || []).filter((a: any) => a.activity_tier != null);
    if (active.length > 0) {
      activityLine =
        `Most active right now: ${active
          .slice(0, 3)
          .map((a: any) => `${a.name} (${a.activity_tier} — ${a.catch_count_30d} catches/30 days)`)
          .join(', ')}.`;
    }
    return [spotsText, activityLine].filter(Boolean).join('\n\n');
  }

  function notLiveSpotsAnswer(): AssistantAnswer {
    return {
      text:
        'The spot map data isn\'t live yet on this project — the activity map tables haven\'t ' +
        'been applied to the database. Ask me instead about species rules, baits, rigs or how ' +
        'logging works.',
      followUps: SUGGESTIONS,
      sources: [],
    };
  }

  // ── Topic guide ─────────────────────────────────────────────
  const guides = scoreGuides(words, null);
  if (guides.length > 0) {
    const g = guides[0];
    return {
      title: g.title,
      text: g.body,
      followUps: g.id === 'rules-overview'
        ? ['What size can I keep a whiting?', SUGGESTIONS[0], SUGGESTIONS[4]]
        : [SUGGESTIONS[0], SUGGESTIONS[1], 'What rig should I use?'],
      sources: [{ label: 'Fishlore community guide' }],
    };
  }

  return noAnswer;
}