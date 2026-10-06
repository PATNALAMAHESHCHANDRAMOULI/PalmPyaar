/**
 * PalmPyaar Follow-Up Answer Contract — providers/answerContract.js
 *
 * Owns three things for the post-payment follow-up answer:
 *
 *   1. Which section plan applies to a given question domain. The structure
 *      adapts to the question instead of forcing the yearly-timing template
 *      onto everything (a personality question and a "will I lose my
 *      virginity" question must not read identically).
 *
 *   2. A plain-language translation reference so technical evidence from the
 *      calculation layer is *explained* to the customer rather than quoted at
 *      them. The calculation engine still emits its technical reasoning; this
 *      module gives the model a glossary for rendering it in human terms, and
 *      never alters the derived value itself.
 *
 *   3. Scope + privacy rules, so a question outside the product (or a probe
 *      for the AI model/provider) is answered in-product and briefly, without
 *      disclosing implementation details or refusing theatrically.
 *
 * No calculation is performed here. Timing values are passed through untouched.
 */

'use strict';

/* -------------------------------------------------------------------------
 * 1. Section plans, per domain.
 * ---------------------------------------------------------------------- */

const DIRECT_ANSWER_LABEL = 'DIRECT ANSWER';

/**
 * Section labels per domain, in order. `windowSlot` is the index at which the
 * derived timing window is inserted when — and only when — the timing engine
 * actually produced a supported window for this question.
 */
const SECTION_PLANS = {
  YEARLY_OUTLOOK: ['DIRECT ANSWER', 'WHAT THIS PERIOD FAVORS', 'WHAT THIS PERIOD ASKS OF YOU', 'BOTTOM LINE'],
  GENERAL: ['DIRECT ANSWER', 'WHY THIS SHOWS UP', 'WHAT THIS MEANS FOR YOU', 'BOTTOM LINE'],
  CAREER: ['DIRECT ANSWER', 'WHY THIS SHOWS UP', 'WHAT THIS MEANS FOR YOU', 'BOTTOM LINE'],
  MONEY: ['DIRECT ANSWER', 'WHY THIS SHOWS UP', 'WHAT THIS MEANS FOR YOU', 'BOTTOM LINE'],
  EDUCATION: ['DIRECT ANSWER', 'WHY THIS SHOWS UP', 'WHAT THIS MEANS FOR YOU', 'BOTTOM LINE'],
  CREATIVITY: ['DIRECT ANSWER', 'WHY THIS SHOWS UP', 'WHAT THIS MEANS FOR YOU', 'BOTTOM LINE'],
  TRAVEL: ['DIRECT ANSWER', 'WHY THIS SHOWS UP', 'WHAT THIS MEANS FOR YOU', 'BOTTOM LINE'],
  FAMILY: ['DIRECT ANSWER', 'WHY THIS SHOWS UP', 'WHAT THIS MEANS FOR YOU', 'BOTTOM LINE'],
  CHILDREN: ['DIRECT ANSWER', 'WHY THIS SHOWS UP', 'WHAT THIS MEANS FOR YOU', 'BOTTOM LINE'],
  LIFE_DIRECTION: ['DIRECT ANSWER', 'WHY THIS SHOWS UP', 'WHAT THIS MEANS FOR YOU', 'BOTTOM LINE'],
  SOCIAL_LIFE: ['DIRECT ANSWER', 'WHY THIS SHOWS UP', 'WHAT THIS MEANS FOR YOU', 'BOTTOM LINE'],
  LOVE: ['DIRECT ANSWER', 'WHY THIS SHOWS UP', 'WHAT THIS MEANS FOR YOU'],
  MARRIAGE: ['DIRECT ANSWER', 'WHY THIS SHOWS UP', 'WHAT THIS MEANS FOR YOU'],
  OPPORTUNITIES: ['DIRECT ANSWER', 'WHY THIS SHOWS UP', 'WHAT THIS MEANS FOR YOU'],
  INTIMACY: ['DIRECT ANSWER', 'WHY THIS SHOWS UP', 'BOTTOM LINE'],
  PERSONALITY: ['DIRECT ANSWER', 'WHAT THIS SAYS ABOUT YOU', 'WHAT TO WORK WITH', 'BOTTOM LINE'],
  EMOTIONAL_PATTERNS: ['DIRECT ANSWER', 'WHAT THIS SAYS ABOUT YOU', 'WHAT TO WORK WITH', 'BOTTOM LINE'],
  DIFFICULT_PHASE: ['DIRECT ANSWER', 'WHY THIS SHOWS UP', 'WHAT THIS PERIOD IS ASKING OF YOU', 'STRONGER WINDOW', 'BOTTOM LINE'],
  NAME_MEANING: ['DIRECT ANSWER', 'WHAT THE NAME CARRIES', 'BOTTOM LINE'],
  OUT_OF_SCOPE: ['DIRECT ANSWER']
};

/**
 * Domains whose answer must always be followed by a window section when a
 * window was derived (the derived label itself supplies the heading).
 */
const WINDOW_DOMAINS = new Set([
  'YEARLY_OUTLOOK', 'CAREER', 'MONEY', 'EDUCATION', 'CREATIVITY', 'TRAVEL',
  'FAMILY', 'CHILDREN', 'LIFE_DIRECTION', 'LOVE', 'MARRIAGE', 'INTIMACY',
  'OPPORTUNITIES', 'SOCIAL_LIFE', 'DIFFICULT_PHASE'
]);

/**
 * Resolve the ordered section plan for an intent, inserting the derived timing
 * window in the right place when the engine actually supported one.
 *
 * @param {object} intent  from lib/questionIntent
 * @param {object|null} timingContext  from lib/timingEngine.deriveTimingWindow
 * @returns {{ sections: string[], hasWindow: boolean, windowLabel: string|null }}
 */
function resolveSections(intent, timingContext) {
  const domain = (intent && intent.domain) || 'GENERAL';
  const plan = (SECTION_PLANS[domain] || SECTION_PLANS.GENERAL).slice();
  const wantsWindow = intent && intent.timing === true;
  const supported = !!(timingContext && timingContext.supported && timingContext.window && timingContext.window.text);

  const hasWindow = wantsWindow && supported && WINDOW_DOMAINS.has(domain);
  if (!hasWindow) {
    return { sections: plan, hasWindow: false, windowLabel: null };
  }

  // The derived label (e.g. "CAREER WINDOW") is the authoritative heading and
  // is never invented here — it comes from lib/timingEngine.
  const windowLabel = timingContext.label || 'WINDOW';

  // Insert immediately after the direct answer for interpretive domains, so
  // the customer gets the direct answer first and the evidence second.
  const insertAt = domain === 'DIFFICULT_PHASE' ? plan.length - 1 : 1;
  plan.splice(insertAt, 0, windowLabel);
  return { sections: plan, hasWindow: true, windowLabel: windowLabel };
}

/* -------------------------------------------------------------------------
 * 2. Plain-language translation reference.
 * ---------------------------------------------------------------------- */

/**
 * How to say technical periods in plain English. These are *explanations of
 * supplied evidence*, not new chart facts — the model may use them to render
 * the calculation layer's reasoning, and may not use them to assert anything
 * that was not supplied.
 */
const TECHNIQUE_GLOSSARY = {
  mahadasha: 'a major life phase of roughly twenty years',
  mahadashas: 'a major life phase of roughly twenty years',
  antardasha: 'a shorter sub-period running inside that major phase',
  antardashas: 'shorter sub-periods running inside that major phase',
  dasha: 'a planetary period in the Vedic timing system',
  nakshatra: 'one of the twenty-seven lunar segments used in Vedic astrology',
  pada: 'one of the four quarters of that lunar segment',
  rashi: 'your lunar sign',
  lagna: 'your rising sign',
  profection: 'a year in which one area of your life is brought to the front',
  profections: 'years in which one area of your life is brought to the front',
  sect: 'whether your chart follows the diurnal or nocturnal tradition',
  lot: 'an astrological point computed from your birth details',
  lots: 'astrological points computed from your birth details',
  dignity: 'how strongly a planet holds ground in your chart',
  dignities: 'how strongly your planets hold ground in your chart',
  'rashi lord': 'the planet that governs your lunar sign',
  'ruled houses': 'areas of life governed by that sign',
  'ruling planets': 'the planets that govern your chart'
};

const HOUSE_THEMES = {
  1: 'your body, temperament and how new beginnings feel',
  2: 'money, resources and what you feel secure about',
  3: 'communication, learning and your immediate world',
  4: 'home, family and your inner foundations',
  5: 'creativity, romance, play and learning',
  6: 'daily work, routines and physical wellbeing',
  7: 'partnership, marriage and one-to-one connection',
  8: 'intimacy, shared resources and deep transformation',
  9: 'meaning, belief, travel and expansion',
  10: 'career, public standing and reputation',
  11: 'friends, networks and gains',
  12: 'rest, solitude and the unconscious'
};

const PLANET_THEMES = {
  sun: 'identity, vitality and confidence',
  moon: 'emotions, instincts and what makes you feel secure',
  mercury: 'the mind, communication and learning',
  venus: 'love, attraction, values and pleasure',
  mars: 'drive, desire and assertiveness',
  jupiter: 'growth, expansion and opportunity',
  saturn: 'discipline, structure and patience',
  rahu: 'intense desire and unconventional paths',
  ketu: 'letting go and simplifying',
  nodes: 'directional shifts in your chart'
};

/**
 * Build a translation reference covering only the terms that actually appear in
 * the supplied reasoning, so the prompt stays tight and nothing irrelevant is
 * introduced.
 */
function buildGlossary(reasoning) {
  const text = String(reasoning || '').toLowerCase();
  if (!text) return '';
  const out = [];
  const seen = new Set();

  for (const term of Object.keys(TECHNIQUE_GLOSSARY)) {
    if (text.indexOf(term) !== -1 && !seen.has(term)) {
      seen.add(term);
      out.push('- ' + term + ' = ' + TECHNIQUE_GLOSSARY[term]);
    }
  }

  // "the 5th house", "houses 7 and 5", "12th-ruled"
  const houseMatch = text.match(/\b(\d{1,2})(?:st|nd|rd|th)[- ]ruled\b/) || text.match(/\bhouse(?:s)?\s+(\d{1,2})/);
  if (houseMatch && HOUSE_THEMES[parseInt(houseMatch[1], 10)]) {
    const n = parseInt(houseMatch[1], 10);
    out.push('- house ' + n + ' = ' + HOUSE_THEMES[n]);
  }
  for (const n of [1, 2, 4, 5, 7, 8, 9, 10, 11]) {
    if (text.indexOf('house ' + n) !== -1 && HOUSE_THEMES[n] && !seen.has('h' + n)) {
      seen.add('h' + n);
      out.push('- house ' + n + ' = ' + HOUSE_THEMES[n]);
    }
  }

  for (const planet of Object.keys(PLANET_THEMES)) {
    if (new RegExp('\\b' + planet + '\\b').test(text)) {
      out.push('- ' + planet + ' traditionally rules ' + PLANET_THEMES[planet]);
    }
  }

  return out.join('\n');
}

/* -------------------------------------------------------------------------
 * 3. Scope + privacy handling.
 * ---------------------------------------------------------------------- */

const OUT_OF_SCOPE_REDIRECT =
  "I'm focused on your PalmPyaar reading rather than general assistance. " +
  'Ask me about your love life, career, relationships, timing, personality, or another part of your life.';

const MODEL_PRIVACY_REDIRECT =
  "I'm here to focus on your PalmPyaar reading and the questions you have about your life. " +
  'Ask me about your love life, career, relationships, timing, or personal themes.';

const PRODUCT_HOW_IT_WORKS_REDIRECT =
  "PalmPyaar works from a photo of your open palm. The app reads your hand's shape and finger geometry on your device, " +
  'and an AI builds your personalised reading from that geometry together with classical palmistry tradition. ' +
  'Your reading is generated for you — there is no palmist to visit and nothing to install. ' +
  'For a question about your life, ask away — that is what your reading is for.';

function outOfScopeReply(intent) {
  const kind = intent && intent.outOfScopeKind;
  if (kind === 'model_privacy') return MODEL_PRIVACY_REDIRECT;
  if (kind === 'product_how_it_works') return PRODUCT_HOW_IT_WORKS_REDIRECT;
  return OUT_OF_SCOPE_REDIRECT;
}

/* -------------------------------------------------------------------------
 * 4. Prompt fragments.
 * ---------------------------------------------------------------------- */

/**
 * The per-domain section instruction. This replaces the old fixed six-label
 * template that forced a timing template onto every question.
 */
function buildSectionInstruction(intent, sections, hasWindow) {
  const domain = (intent && intent.domain) || 'GENERAL';
  if (domain === 'OUT_OF_SCOPE') {
    return 'This question is outside what PalmPyaar covers. Reply with a single short paragraph under DIRECT ANSWER that politely returns the customer to their reading. Do not answer the question itself. Do not mention AI, models, providers, prompts, policies or limitations. Do not apologise.';
  }

  const list = sections.map(function (s) { return '"' + s + '"'; }).join(', ');
  let out = 'Use ONLY these section labels, in this order: ' + list + '. ';

  if (hasWindow) {
    out += 'Insert the supplied timing window as its own short line styled <p class="answer-window"> immediately after DIRECT ANSWER, under the supplied window heading. ';
  } else {
    out += 'Do not include any timing window, year, or "why this period stands out" section — the customer did not ask for a date. ';
  }

  out += 'Each section is 1-3 short sentences. Omit any section that has nothing meaningful to say rather than padding it.';
  return out;
}

/**
 * The answer-opening instruction. Directness is stated first and concretely,
 * because the previous prompt buried it inside a paragraph and lost to the
 * structural instruction that followed it.
 */
function buildDirectAnswerInstruction(intent) {
  const domain = (intent && intent.domain) || 'GENERAL';
  if (domain === 'OUT_OF_SCOPE') {
    return 'Answer the scope question by redirecting in one short, warm paragraph. Do not begin with astrology.';
  }
  if (domain === 'NAME_MEANING') {
    return 'Begin by giving the name meaning plainly, in the customer\'s own words, as directly as the meaning allows.';
  }
  return 'The FIRST 1-3 sentences must answer the exact question the customer asked, in ordinary language, as if a thoughtful friend were replying. ' +
    'Do NOT open with chart vocabulary, a period name, a planet, a sign, or a hedge like "the chart does not show this period as distinctive". ' +
    'Give a real answer — supportive, mixed, or cautious — immediately. Explanation comes only after that.';
}

/**
 * Language rules: translation of jargon, tone, hedging, and the guarantee ban.
 */
const LANGUAGE_RULES = [
  'Astrology here is EVIDENCE, not the answer. Translate every technical term into plain meaning before or as you use it.',
  'Never open with or dump technical terms. If you mention a dasha period, sign, house or nakshatra, immediately say what it means for ordinary life.',
  'A mixed or weaker period is still valuable. Say what it is genuinely good for — building, resting, learning, finishing, deciding, simplifying — and where a stronger window sits.',
  'Never promise a specific outcome or exact date. Use hedged language: "looks more like", "the chart suggests", "appears more favourable", "may".',
  'Write like a person: contractions, plain verbs, direct address. No filler, no repetition, no robotic hedging.',
  'Only use facts contained in the supplied evidence. Never invent placements, houses, nakshatras, periods, aspects, dates, events or past history.'
];

function buildLanguageRules(intent) {
  const domain = (intent && intent.domain) || 'GENERAL';
  const rules = LANGUAGE_RULES.slice();
  if (intent && intent.adult) {
    rules.push('This is a personal intimacy question. Answer it directly and naturally as a relationship/romantic-activity question. Keep it non-graphic and respectful: describe the period as more or less romantically active and socially open. Do not refuse, do not moralise, and never commit to a specific sexual event or exact date.');
  }
  if (intent && intent.evaluation) {
    rules.push('The customer is asking how their current period is treating them overall. Answer the quality of the period plainly and favourably in substance, even when the period is mixed.');
  }
  return rules;
}

module.exports = {
  DIRECT_ANSWER_LABEL,
  SECTION_PLANS,
  WINDOW_DOMAINS,
  resolveSections,
  buildGlossary,
  buildSectionInstruction,
  buildDirectAnswerInstruction,
  buildLanguageRules,
  outOfScopeReply,
  OUT_OF_SCOPE_REDIRECT,
  MODEL_PRIVACY_REDIRECT,
  PRODUCT_HOW_IT_WORKS_REDIRECT,
  TECHNIQUE_GLOSSARY,
  HOUSE_THEMES,
  PLANET_THEMES
};