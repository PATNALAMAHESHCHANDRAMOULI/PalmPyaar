/**
 * PalmPyaar Follow-Up Question Intent — lib/questionIntent.js
 *
 * Maps arbitrary, natural customer wording onto a small set of reading
 * DOMAINS, then maps each domain onto one of the evidence topics that
 * lib/timingEngine already understands.
 *
 * Design constraints (deliberate):
 *
 *  - This is NOT a list of example questions. It is a weighted semantic
 *    lexicon: multi-word customer phrasing ("this year", "treat me well",
 *    "body count", "lose my virginity") contributes signal alongside single
 *    words ("job", "move", "overthinking"). Any unseen phrasing is still
 *    classified, because scoring is by intersecting tokens/n-grams against
 *    concept families rather than by matching stored questions.
 *
 *  - The calculation layer is NEVER changed. Every domain resolves to one of
 *    the 14 topic strings that lib/timingEngine already supports, so the
 *    window a customer receives is byte-identical to what today's code would
 *    produce for the same underlying topic.
 *
 *  - Name-meaning keeps its existing dedicated path and is returned early so
 *    the curated lexicon in lib/nameMeaning is never bypassed.
 */

'use strict';

/** Normalize text for signal extraction. */
function normalize(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9'\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Concept families. `terms` are single-word signals, `phrases` are 2-3 word
 * signals. Phrases carry more weight because they disambiguate intent far
 * more reliably than isolated words.
 */
const FAMILIES = {
  CAREER: {
    label: 'career and work',
    evidenceTopic: 'career/job',
    terms: { job: 2, career: 2, work: 1, promotion: 2, interview: 3, profession: 2, employment: 2, employ: 1, hire: 2, hired: 2, boss: 2, colleague: 2, coworker: 2, freelance: 2, startup: 2, business: 2, salary: 1, resume: 3, cv: 2, office: 1, workplace: 2, layoff: 3, fired: 3, quitting: 2, profession: 2, role: 1, position: 1, internship: 3, apprenticeship: 3 },
    phrases: { 'get a job': 5, 'get a better job': 5, 'new job': 4, 'change jobs': 4, 'switch jobs': 4, 'switch career': 4, 'career change': 4, 'find work': 4, 'look for a job': 4, 'good job': 3, 'better job': 3, 'higher salary': 3, 'salary increase': 3, 'work situation': 3, 'professional growth': 3, 'my career': 3, 'love my job': 2, 'hate my job': 2 }
  },
  MONEY: {
    label: 'money and finances',
    evidenceTopic: 'money',
    terms: { money: 2, wealth: 2, income: 2, salary: 1, finance: 2, financial: 2, rich: 2, poverty: 2, debt: 3, loan: 2, savings: 2, invest: 2, investment: 2, property: 1, house: 1, afford: 2, budget: 2, expenses: 2, earn: 2, earnings: 2, profit: 2, luxury: 1 },
    phrases: { 'make money': 4, 'financial situation': 4, 'financial freedom': 4, 'get rich': 4, 'money problems': 4, 'save more': 3, 'pay off debt': 4, 'buy a house': 3, 'afford a house': 3, 'earn more': 3, 'money improve': 3, 'financially stable': 3, 'stable income': 3 }
  },
  LOVE: {
    label: 'love and relationships',
    evidenceTopic: 'relationship/love',
    terms: { love: 2, relationship: 3, partner: 3, dating: 3, romance: 3, romantic: 2, crush: 3, soulmate: 4, boyfriend: 3, girlfriend: 3, ex: 2, breakup: 3, 'break up': 3, divorce: 3, attraction: 2, attract: 2, chemistry: 2, commitment: 1, together: 1, companion: 2, feelings: 1 },
    phrases: { 'meet someone': 5, 'find someone': 4, 'meet a partner': 5, 'fall in love': 5, 'in love': 3, 'love life': 4, 'relationship improve': 4, 'love come': 3, 'come into my life': 2, 'get together': 4, 'stay together': 4, 'serious relationship': 5, 'long term relationship': 4, 'kind of partner': 5, 'type of partner': 5, 'right person': 3, 'current relationship': 4, 'my relationship': 3, 'find love': 4, 'meet a man': 4, 'meet a woman': 4, 'someone new': 2 }
  },
  // Marriage is kept distinct from LOVE because lib/timingEngine has a separate
  // "marriage" evidence topic (houses 7 and 5) and the previous behaviour
  // routed marriage wording there. Merging it into LOVE would silently change
  // the derived window.
  MARRIAGE: {
    label: 'marriage timing and partnership',
    evidenceTopic: 'marriage',
    terms: { marriage: 4, married: 4, marry: 4, wedding: 4, spouse: 4, husband: 4, wife: 4, engagement: 4, engaged: 3, bride: 3, groom: 3, nuptials: 4 },
    phrases: { 'get married': 6, 'when will i marry': 6, 'marry me': 4, 'get engaged': 5, 'my wedding': 5, 'marriage timing': 5, 'meet my spouse': 5, 'find a husband': 5, 'find a wife': 5, 'settle down': 4, 'tied down': 3 }
  },
  // Success / opportunity wording routes to the "opportunities/future" topic,
  // exactly as the previous classifier did, so the derived window is unchanged.
  OPPORTUNITIES: {
    label: 'opportunities and future prospects',
    evidenceTopic: 'opportunities/future',
    terms: { success: 4, successful: 4, succeed: 4, succeeding: 4, achieve: 3, achieving: 3, achievement: 3, achievement: 3, opportunity: 4, opportunities: 4, fame: 3, recognition: 3, win: 3, winning: 3, prospect: 3, prospects: 3, breakout: 3, milestone: 3, goals: 3, success: 4 },
    phrases: { 'become successful': 6, 'be successful': 5, 'great success': 5, 'find opportunity': 5, 'good opportunities': 5, 'reach my goals': 5, 'achieve success': 5, 'get recognition': 5, 'my success': 4, 'go far': 3, 'make it': 3 }
  },
  INTIMACY: {
    label: 'intimacy and romantic activity',
    evidenceTopic: 'intimacy',
    terms: { intimacy: 4, intimate: 4, virginity: 5, virgin: 5, sex: 4, sexual: 4, sexuality: 4, erotic: 3, physical: 1, closeness: 2, hookup: 4, hooking: 4, slept: 2, sleep: 1, attraction: 1, desire: 2, lust: 3, romance: 1, romantic: 1, encounter: 2, involvement: 2, experience: 1, body: 1, count: 1 },
    phrases: { 'lose my virginity': 6, 'lose virginity': 6, 'body count': 6, 'sex life': 6, 'sexual life': 6, 'sexual activity': 5, 'romantic life': 5, 'love life become': 4, 'become sexually active': 6, 'sexually active': 5, 'intimate relationship': 4, 'physical intimacy': 5, 'meet women': 3, 'meet men': 3, 'get together physically': 4, 'sleep with someone': 5, 'first time': 2, 'sexual experience': 5, 'romantic opportunities': 4, 'be with someone': 2, 'relationship activity': 4 }
  },
  PERSONALITY: {
    label: 'your core personality',
    evidenceTopic: 'personality',
    terms: { personality: 4, character: 3, temperament: 4, nature: 2, introvert: 3, extrovert: 3, strength: 3, strengths: 3, weakness: 3, weaknesses: 3, confidence: 3, confident: 3, self: 1, identity: 2, essence: 3, trait: 3, traits: 3, habit: 2, habits: 2 },
    phrases: { 'who am i': 5, 'describe me': 5, 'inner self': 5, 'my personality': 5, 'biggest strength': 5, 'core strength': 4, 'biggest weakness': 5, 'am i confident': 4, 'become more confident': 4, 'my character': 4, 'what am i like': 5, 'personality type': 5, 'weak points': 3, 'blind spot': 3, 'how do i come across': 4 }
  },
  EMOTIONAL_PATTERNS: {
    label: 'emotional patterns',
    evidenceTopic: 'personality',
    terms: { overthinking: 5, anxious: 4, anxiety: 4, stress: 3, stressed: 3, worried: 3, worry: 3, emotional: 3, emotions: 3, mood: 2, moods: 2, overthink: 5, rumination: 5, spiraling: 4, spiral: 3, insecure: 3, selfdoubt: 4, doubt: 2, consistency: 3, procrastinate: 4, lazy: 3, discipline: 3, disciplined: 3, motivated: 3, motivation: 3 },
    phrases: { 'keep overthinking': 6, 'overthink': 4, 'why do i worry': 5, 'why am i anxious': 5, 'chase my thoughts': 4, 'racing thoughts': 4, 'stay consistent': 4, 'struggle with consistency': 5, 'why do i struggle': 4, 'why do i procrastinate': 5, 'my emotional pattern': 5, 'emotional patterns': 5, 'why do i feel': 3, 'mental state': 3, 'inner critic': 4, 'self critical': 4, 'why am i like this': 4, 'always worrying': 4, 'difficulty focusing': 4, 'procrastinate': 3 }
  },
  YEARLY_OUTLOOK: {
    label: 'how this period is treating you overall',
    evidenceTopic: 'general',
    terms: { year: 2, yearly: 3, outlook: 3, forecast: 2, lately: 2, currently: 2, smooth: 3, rough: 3, lucky: 3, unlucky: 3, golden: 3, favourable: 3, favorable: 3, unfavourable: 3, unfavorable: 3, blessings: 2, curse: 2 },
    phrases: {
      'this year': 5, 'this year nice': 6, 'nice to me': 6, 'year nice': 6, 'good year': 6, 'great year': 6, 'bad year': 5, 'lucky year': 5, 'this year good': 6, 'this year bad': 5,
      'year ahead': 5, 'year to come': 5, 'coming year': 5, 'this year treat': 5, 'treat me well': 6, 'treat me': 5, 'going to be good': 4, 'be a good year': 5,
      'year for me': 4, 'year going to be': 5, 'year going to': 4, 'in my favor': 4, 'favourable year': 5, 'successful year': 4, 'difficult year': 4, 'tough year': 4,
      'better phase': 5, 'best year': 5, 'worst year': 4, 'phase of life': 4, 'better time': 4, 'good time': 3, 'bad time': 3, 'hard time': 3, 'this period': 4,
      'coming months': 4, 'this month': 4, 'strongest period': 4, 'most powerful year': 4, 'worth it': 2, 'am i lucky': 4, 'lucky this year': 5
    }
  },
  EDUCATION: {
    label: 'education and study',
    evidenceTopic: 'education',
    terms: { education: 4, study: 3, studies: 3, exam: 4, exams: 4, college: 3, university: 3, degree: 3, school: 2, course: 2, grades: 3, graduation: 3, phd: 4, masters: 3, study: 3, syllabus: 3, teachers: 1 },
    phrases: { 'focus on education': 5, 'go to college': 4, 'higher studies': 5, 'get a degree': 4, 'study abroad': 5, 'good grades': 4, 'pass my exams': 4, 'focus on studies': 5, 'career in': 2, 'learn a skill': 3, 'professional course': 3, 'my studies': 3 }
  },
  CREATIVITY: {
    label: 'creative expression',
    evidenceTopic: 'education',
    terms: { creative: 4, creativity: 4, art: 2, artist: 3, music: 3, musician: 3, write: 2, writing: 2, writer: 3, poetry: 3, paint: 2, painting: 3, design: 3, designer: 3, sing: 2, singing: 3, performance: 2, creative: 4, craft: 2, film: 2, photography: 3, guitar: 3, dance: 2 },
    phrases: { 'creative breakthrough': 6, 'be creative': 4, 'my art': 3, 'start writing': 4, 'become an artist': 4, 'creative work': 4, 'my music': 3, 'express myself': 3, 'pursue art': 4, 'creative energy': 5 }
  },
  SOCIAL_LIFE: {
    label: 'social life and friendships',
    evidenceTopic: 'opportunities/future',
    terms: { friends: 4, friendship: 4, social: 3, circle: 3, network: 3, networking: 4, group: 2, community: 3, party: 3, parties: 3, gatherings: 3, connect: 2, connections: 3, belong: 2, loneliness: 4, lonely: 4, isolated: 3, introvert: 1 },
    phrases: { 'social life': 6, 'meet friends': 5, 'make friends': 5, 'social circle': 5, 'friend group': 4, 'why am i lonely': 6, 'feel lonely': 5, 'meet new people': 4, 'expand my network': 4, 'my friendships': 4, 'community': 2, 'belong somewhere': 3, 'popular': 2 }
  },
  FAMILY: {
    label: 'family',
    evidenceTopic: 'family',
    terms: { family: 3, mother: 3, mom: 3, father: 3, dad: 3, parents: 3, sibling: 3, siblings: 3, brother: 3, sister: 3, grandmother: 3, grandfather: 3, inlaws: 3, home: 1, relatives: 3, native: 2, home: 1 },
    phrases: { 'my family': 4, 'family life': 4, 'my parents': 4, 'relationship with my mother': 5, 'relationship with my father': 5, 'my siblings': 4, 'family problems': 4, 'family harmony': 5, 'in laws': 4, 'home': 1 }
  },
  CHILDREN: {
    label: 'children',
    evidenceTopic: 'children',
    terms: { children: 4, child: 3, kids: 3, baby: 4, babies: 4, son: 3, daughter: 3, pregnancy: 4, pregnant: 4, conceive: 4, conception: 4, fertility: 4, offspring: 4, progeny: 4 },
    phrases: { 'have children': 5, 'when will i have a baby': 6, 'get pregnant': 5, 'conceive': 4, 'my kids': 4, 'start a family': 4, 'have a child': 5, 'fertility': 3 }
  },
  TRAVEL: {
    label: 'travel and relocation',
    evidenceTopic: 'travel/relocation',
    terms: { travel: 3, abroad: 4, foreign: 3, relocate: 4, relocation: 4, migration: 3, migrate: 3, overseas: 4, move: 2, moving: 2, country: 2, city: 1, hometown: 3, settle: 2, visa: 4, 'job abroad': 4, 'settle down': 3 },
    phrases: { 'move abroad': 6, 'move somewhere': 4, 'move to another': 4, 'settle abroad': 6, 'relocate': 4, 'leave my country': 5, 'go abroad': 5, 'immigrate': 5, 'move somewhere new': 6, 'relocation': 4, 'stay abroad': 4, 'back to my hometown': 5, 'settle where': 4 }
  },
  LIFE_DIRECTION: {
    label: 'life direction',
    evidenceTopic: 'life-direction',
    terms: { purpose: 4, path: 2, direction: 3, destiny: 4, calling: 3, mission: 3, meaning: 2, chapter: 2, transition: 3, crossroads: 4, choice: 2, decision: 2, decide: 2, change: 2, pivot: 3, purpose: 4 },
    phrases: { 'life direction': 6, 'what should i do': 9, 'what should i focus on': 9, 'life path': 5, 'my purpose': 5, 'am i on the right path': 6, 'big decision': 5, 'change my life': 5, 'next chapter': 5, 'what is my life about': 6, 'meaning of life': 5, 'where am i headed': 5, 'what am i meant to do': 8, 'career change': 4, 'hold me back': 5, 'holding me back': 5, 'what is holding me back': 6, 'what is blocking me': 5, 'blocking me': 5, 'holding me': 4 }
  },
  DIFFICULT_PHASE: {
    label: 'a difficult stretch',
    evidenceTopic: 'general',
    terms: { difficult: 3, hard: 2, tough: 3, struggle: 3, struggling: 3, obstacle: 3, obstacles: 3, crisis: 3, rough: 2, low: 2, difficult: 3, pain: 2, painful: 3, hard: 2, suffering: 3, down: 1, darkness: 2, confused: 2, stuck: 3 },
    phrases: { 'difficult phase': 6, 'hard phase': 6, 'tough phase': 6, 'bad time': 5, 'rough patch': 6, 'going through': 4, 'struggling': 3, 'difficult time': 5, 'hard time': 5, 'why am i struggling': 6, 'what is holding me back': 6, 'holding me back': 5, 'stuck in life': 5, 'losing': 2, 'everything is hard': 5, 'i am lost': 4 }
  }
};

/** Signals that indicate the customer wants a general read on the current period. */
const EVALUATION_SIGNALS = /(\bthis year\b|\bthe year\b|\bthis year nice\b|\bnice to me\b|\btreat me\b|\bgoing to be\b|\blucky\b|\bsmooth\b|\brough\b|\bgolden\b|\bworth it\b|\bin my favor\b|\bfavour\b|\bfavor\b|\bfortune\b|\bfated\b|\bstrongest\b|\bstrong(er)?\b|\bpowerful\b|\bpromising\b|\bexpansion\b|\bbreakthrough\b|\bwindow\b|\bfor me\b)/i;

/** Period-framing nouns, qualified by a determiner or a question word. */
const PERIOD_FRAMING = /\b(this|the|my|coming|next|current|what|which|which-?ever)\s+(year|years|months?|period|phase|season|chapter|stage)\b/i;

/** Words that evaluate a period without naming one. */
const EVALUATION_ADJECTIVES = /\b(nice|good|bad|great|lucky|unlucky|rough|smooth|successful|difficult|tough|golden|beautiful|favourable|favorable|strongest|stronger|powerful|promising|expansion|best|worst|fortune|productive)\b/i;

/** Signals that the customer is asking for a specific point in time. Includes an explicit year. */
const TIME_SIGNALS = /\b(when|date|year|month|how soon|timing|window|what age|time frame|timeline|soon|period|phase)\b|(?:19|20)\d{2}/i;

/** Out-of-scope: not a question about the customer's own life/reading. */
const OUT_OF_SCOPE = {
  signals: {
    java: 4, python: 4, javascript: 4, code: 4, coding: 4, program: 4, programming: 4, function: 3, algorithm: 4, api: 3, sdk: 4, html: 3, css: 3, regex: 4, bug: 3, deploy: 3, server: 3, database: 3, sql: 4, bitcoin: 6, cryptocurrency: 5, crypto: 4, stock: 5, stocks: 5, share: 1, nifty: 5, sensex: 5, trading: 4, portfolio: 3, gdp: 5, election: 3, politics: 3, president: 3, 'prime minister': 4, weather: 4, score: 3, match: 1, news: 3, wikipedia: 4, trivia: 4, capital: 1,
    gpt: 5, llm: 5, model: 2, openai: 5, grok: 3, gemini: 4, claude: 4, prompt: 5, system: 2, chatbot: 4, chatgpt: 5, training: 1, parameters: 3, temperature: 3, tokens: 2, 'machine learning': 5, neural: 5, promptengineering: 5
  },
  phrases: {
    'write me a program': 8, 'write code': 8, 'write a java': 8, 'write me java': 8, 'code this': 8, 'debug this': 8, 'fix my code': 8, 'help me code': 8, 'write a function': 8, 'create an app': 8, 'build an app': 8, 'build a website': 8, 'write a poem': 6, 'write a song': 6, 'write an essay': 6,
    'which ai model': 8, 'what ai model': 8, 'what model are you': 8, 'which model are you': 8, 'who made you': 8, 'who built you': 8, 'your system prompt': 8, 'show me your prompt': 8, 'your instructions': 8, 'are you a bot': 8, 'are you human': 7, 'your api key': 8, 'how do you work': 6, 'what technology do you': 8, 'what algorithm': 6, 'machine learning model': 8,
    'bitcoin price': 8, 'stock price': 8, 'share price': 8, 'weather today': 8, 'current news': 8, 'who won': 8, 'general knowledge': 7, 'explain quantum': 7, 'what is photosynthesis': 7, 'solve this equation': 8, 'translate to': 6
  }
};

/** Signals that the customer is asking what something is LIKE, not WHEN it happens. */
const DESCRIPTIVE_SIGNALS = /\b(what kind of|what type of|which kind of|which type of|what sort of|describe (my|the|your)|who am i|what am i like|what would i|what should i look for|what suits|who should i|what does my (partner|personality|chart) (look|seem) like|which partner)\b/i;

/**
 * Score one concept family against the normalized text. Matching is also
 * attempted against an apostrophe-free copy so natural contractions
 * ("what's holding me back") still match stored signal phrases.
 */
function scoreFamily(text, family) {
  const flat = text.replace(/'/g, '');
  let score = 0;
  const terms = family.terms || {};
  for (const term of Object.keys(terms)) {
    if (text.indexOf(term) !== -1) score += terms[term];
  }
  const phrases = family.phrases || {};
  for (const phrase of Object.keys(phrases)) {
    const flatPhrase = phrase.replace(/'/g, '');
    if (text.indexOf(phrase) !== -1 || flat.indexOf(flatPhrase) !== -1) score += phrases[phrase];
  }
  return score;
}

function scoreOutOfScope(text) {
  const flat = text.replace(/'/g, '');
  let score = 0;
  for (const term of Object.keys(OUT_OF_SCOPE.signals)) {
    if (text.indexOf(term) !== -1) score += OUT_OF_SCOPE.signals[term];
  }
  for (const phrase of Object.keys(OUT_OF_SCOPE.phrases)) {
    const flatPhrase = phrase.replace(/'/g, '');
    if (text.indexOf(phrase) !== -1 || flat.indexOf(flatPhrase) !== -1) score += OUT_OF_SCOPE.phrases[phrase];
  }
  return score;
}

/** Existing name-meaning extraction, preserved so lib/nameMeaning is still the source of truth. */
function extractNameFromQuestion(text) {
  const patterns = [
    /\bwhat does (?:my |the )?name ([a-z][a-z']{0,29}) mean\b/,
    /\bwhat does (?:my |the )?([a-z][a-z']{0,29}) mean\b/,
    /\bmeaning of (?:the )?(?:name )?([a-z][a-z']{0,29})\b/,
    /\bmy name is ([a-z][a-z']{0,29})\b/
  ];
  for (const re of patterns) {
    const m = String(text).match(re);
    if (m && m[1] && m[1].length >= 2) return m[1];
  }
  return null;
}

/** Is this asking about the current period's quality, rather than a domain? */
function looksLikePeriodEvaluation(raw, text) {
  if (!EVALUATION_SIGNALS.test(raw) && !EVALUATION_ADJECTIVES.test(text)) return false;
  // Explicit period framing ("this year", "what period of my life..."), or an
  // evaluation verb/adjective with no stronger domain competing with it.
  return PERIOD_FRAMING.test(text)
    || /\b(this year|coming year|year ahead|year to come|my life|going to be|nice to me|treat me|in my favor|lucky|favourable|favorable|golden|strongest|stronger|powerful)\b/.test(text);
}

/**
 * Minimum signal for a domain to win outright. Every weight-2 term is a
 * distinctive domain noun ("money", "career", "friends"), so a single one of
 * those is enough on its own — the old threshold of 3 forced unambiguous
 * single-word questions such as "Is money going to improve?" into GENERAL.
 */
const MIN_DOMAIN_SCORE = 2;

/**
 * Classify a follow-up question into a reading domain.
 *
 * @param {string} question
 * @returns {{
 *   domain: string, topic: string, label: string, timing: boolean,
 *   name: (string|null), inScope: boolean, outOfScopeKind: string,
 *   scores: object, adult: boolean, evaluation: boolean
 * }}
 */
function classifyQuestion(question) {
  const raw = String(question || '');
  const text = normalize(raw);

  const intent = {
    domain: 'GENERAL',
    topic: 'general',
    label: 'your reading',
    timing: TIME_SIGNALS.test(text),
    descriptive: DESCRIPTIVE_SIGNALS.test(text),
    name: null,
    inScope: true,
    outOfScopeKind: null,
    scores: {},
    adult: false,
    evaluation: false
  };

  // A "what kind of" question is never a timing question, even if it mentions
  // a period. Describing a partner, a personality or a chart is qualitative.
  if (intent.descriptive) {
    intent.timing = false;
  }

  // 1. Name meaning keeps its dedicated, curated path.
  if (/\bname\b/.test(text) && /\b(mean|meaning|significance|origin)\b/.test(text)) {
    intent.domain = 'NAME_MEANING';
    intent.topic = 'name-meaning';
    intent.label = 'your name meaning';
    intent.name = extractNameFromQuestion(text);
    return intent;
  }

  // 2. Out-of-scope (general assistant / model probing) is resolved first so a
  //    stray keyword like "model" can never pull the answer off-topic.
  const oos = scoreOutOfScope(text);
  if (oos >= 6) {
    intent.domain = 'OUT_OF_SCOPE';
    intent.topic = null;
    intent.label = null;
    intent.inScope = false;
    intent.outOfScopeKind = /\b(model|prompt|gpt|llm|openai|gemini|claude|chatbot|bot|human|instructions|api|token|algorithm|technology)\b/.test(text)
      ? 'model_privacy'
      : 'general_assistant';
    intent.timing = false;
    intent.scores.OUT_OF_SCOPE = oos;
    return intent;
  }

  // 3. Score every concept family.
  const scores = {};
  let best = null;
  let bestScore = 0;
  let runnerUp = 0;
  for (const key of Object.keys(FAMILIES)) {
    const s = scoreFamily(text, FAMILIES[key]);
    scores[key] = s;
    if (s > bestScore) { runnerUp = bestScore; best = key; bestScore = s; }
    else if (s > runnerUp) { runnerUp = s; }
  }
  intent.scores = scores;

  // 4. Adult/personal intimacy phrasing always resolves to INTIMACY, even when
  //    a secondary love signal is present (e.g. "when will my romantic life
  //    become active"). Never blocks or refuses; only routes.
  if (scores.INTIMACY >= 3 && scores.INTIMACY >= (scores.LOVE || 0)) {
    intent.domain = 'INTIMACY';
    intent.topic = 'intimacy';
    intent.label = 'intimacy and romantic activity';
    intent.adult = true;
    return intent;
  }

  // 5. A period-quality question with no dominant domain is a yearly outlook.
  const evaluation = looksLikePeriodEvaluation(raw, text);
  if (evaluation && (best === null || bestScore < MIN_DOMAIN_SCORE)) {
    intent.domain = 'YEARLY_OUTLOOK';
    intent.topic = 'general';
    intent.label = 'how this period is treating you';
    intent.evaluation = true;
    return intent;
  }

  if (best !== null && bestScore >= MIN_DOMAIN_SCORE) {
    // A genuine tie between two domains is ambiguous rather than a domain
    // match, so it falls through to a general reading instead of guessing.
    if (bestScore === runnerUp) {
      intent.domain = 'GENERAL';
      intent.topic = 'general';
      intent.label = 'your reading';
      return intent;
    }
    const family = FAMILIES[best];
    intent.domain = best;
    intent.topic = family.evidenceTopic;
    intent.label = family.label;
    if (best === 'INTIMACY') intent.adult = true;
    // An evaluation-style framing on top of a real domain keeps the domain.
    intent.evaluation = evaluation;
    return intent;
  }

  // 6. Nothing matched confidently: a general reading, or a period question.
  intent.domain = evaluation ? 'YEARLY_OUTLOOK' : 'GENERAL';
  intent.topic = 'general';
  intent.label = evaluation ? 'how this period is treating you' : 'your reading';
  intent.evaluation = evaluation;
  return intent;
}

/** Backwards-compatible alias used by api/ask-question and older callers. */
function classifyQuestionIntent(question) {
  const r = classifyQuestion(question);
  return {
    topic: r.topic || 'general',
    timing: r.timing,
    name: r.name,
    domain: r.domain,
    label: r.label,
    inScope: r.inScope,
    outOfScopeKind: r.outOfScopeKind,
    adult: r.adult,
    evaluation: r.evaluation,
    descriptive: r.descriptive,
    scores: r.scores
  };
}

module.exports = {
  classifyQuestion,
  classifyQuestionIntent,
  normalize,
  FAMILIES,
  OUT_OF_SCOPE
};