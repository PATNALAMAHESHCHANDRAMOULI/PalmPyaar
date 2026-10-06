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

/** Normalize text for signal extraction.
 *
 * Unicode letters AND combining marks (matras like ా, ी, ு are category M,
 * not L) are preserved — the previous normalizer stripped all non-ASCII, which
 * silently zeroed the score of any question written in Telugu, Hindi, Tamil,
 * Kannada or Malayalam and fell through to GENERAL with no timing window.
 * Punctuation still collapses to spaces so ASCII phrase matching behaves
 * exactly as before.
 */
function normalize(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^\p{L}\p{M}\p{N}'\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Split normalized text into word tokens (all scripts incl. combining marks, apostrophes/hyphens kept). */
function tokenize(text) {
  return String(text || '').split(/[^0-9\p{L}\p{M}\p{N}'-]+/u).filter(Boolean);
}

/** Exact-token signal scoring, used by the native-script and romanized lexicons. */
function scoreTokenSignals(tokens, signals) {
  if (!signals) return 0;
  let score = 0;
  for (const term of Object.keys(signals)) {
    if (tokens.indexOf(term) !== -1) score += signals[term];
  }
  return score;
}

/** Contiguous multi-word phrase match over tokens (works across scripts). */
function hasTokenPhrase(tokens, phrase) {
  const parts = tokenize(phrase);
  if (!parts.length || parts.length > tokens.length) return false;
  for (let i = 0; i + parts.length <= tokens.length; i++) {
    let ok = true;
    for (let j = 0; j < parts.length; j++) {
      if (tokens[i + j] !== parts[j]) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}

function scorePhraseSignals(tokens, phrases) {
  if (!phrases) return 0;
  let score = 0;
  for (const phrase of Object.keys(phrases)) {
    if (hasTokenPhrase(tokens, phrase)) score += phrases[phrase];
  }
  return score;
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

/* ---------------------------------------------------------------------------
 * Indic + romanized signal lexicons.
 *
 * The English families above stay untouched: their substring matching on the
 * normalized text behaves exactly as it always has. These tables add the same
 * concept signals for questions asked in Telugu, Hindi, Tamil, Kannada and
 * Malayalam (native script) and in the common romanized spellings customers
 * actually type ("naukri kab hogi", "na job eppudu", "pelli ela untundi").
 *
 * Matching rules:
 *  - native terms match as whole tokens (a Devanagari word never matches
 *    inside a longer word, and no \b is used because \b is ASCII-only);
 *  - romanized terms match as whole tokens after spelling normalization, so
 *    naku/naaku, ela/elaa, eppudu/epudu, untundi/untundhi all resolve;
 *  - English loanwords that Indic speakers use naturally ("job", "career",
 *    "salary") are deliberately NOT listed — they must never reclassify a
 *    genuine English question.
 * ------------------------------------------------------------------------- */
const NATIVE_SIGNALS = {
  CAREER: {
    terms: { 'ఉద్యోగం': 3, 'ఉద్యోగాలు': 3, 'ఉద్యోగ': 3, 'జాబ్': 3, 'కెరీర్': 3, 'ఇంటర్వ్యూ': 3, 'ప్రమోషన్': 3, 'శాలరీ': 2, 'ఆఫీస్': 2, 'పని': 2,
      'नौकरी': 3, 'नौकर': 2, 'जॉब': 3, 'करियर': 3, 'इंटरव्यू': 3, 'प्रमोशन': 3, 'सैलरी': 2, 'दफ्तर': 2, 'ऑफिस': 2, 'नौकरीपेशी': 3,
      'வேலை': 3, 'வேலைவாய்ப்பு': 3, 'தொழில்': 3, 'சம்பளம்': 2, 'பதவி': 2, 'நிறுவனம்': 2,
      'ಕೆಲಸ': 3, 'ಉದ್ಯೋಗ': 3, 'ಜಾಬ್': 3, 'ಕೆರಿಯರ್': 3, 'ಸಂಬಳ': 2, 'ಪ್ರಮೋಷನ್': 3,
      'ജോലി': 3, 'തൊഴിൽ': 3, 'ശമ്പളം': 2, 'പ്രമോഷൻ': 3, 'കരിയർ': 3 }
  },
  MONEY: {
    terms: { 'డబ్బు': 3, 'ఆర్థిక': 2, 'పొదుపు': 3, 'అప్పు': 3, 'సంపద': 2, 'పెట్టుబడి': 2, 'ధనం': 2,
      'पैसा': 3, 'पैसे': 3, 'धन': 2, 'बचत': 3, 'कर्ज': 3, 'ऋण': 3, 'आर्थिक': 2, 'कमाई': 2, 'निवेश': 2,
      'பணம்': 3, 'சேமிப்பு': 3, 'கடன்': 3, 'நிதி': 2, 'வருமானம்': 2, 'சொத்து': 2,
      'ಹಣ': 3, 'ಹಣಕಾಸು': 2, 'ಉಳಿತಾಯ': 3, 'ಸಾಲ': 3, 'ಆದಾಯ': 2,
      'പണം': 3, 'സമ്പാദ്യം': 3, 'കടം': 3, 'വരുമാനം': 2, 'നിക്ഷേപം': 2 }
  },
  LOVE: {
    terms: { 'ప్రేమ': 3, 'ప్రేమికుడు': 3, 'ప్రేమిక': 3, 'సంబంధం': 3, 'డేటింగ్': 3, 'మనసు': 1,
      'प्यार': 3, 'प्रेम': 3, 'रिश्ता': 3, 'रिश्ते': 3, 'डेटिंग': 3, 'प्रेमी': 3, 'प्रेमिका': 3, 'साथी': 2,
      'காதல்': 3, 'காதலி': 3, 'காதலன்': 3, 'உறவு': 2, 'டேட்டிங்': 3,
      'ಪ್ರೀತಿ': 3, 'ಪ್ರೇಮ': 3, 'ಸಂಬಂಧ': 2, 'ಡೇಟಿಂಗ್': 3,
      'പ്രണയം': 3, 'പ്രണയ': 3, 'പ്രീതി': 3, 'ബന്ധം': 2 }
  },
  MARRIAGE: {
    terms: { 'పెళ్ళి': 4, 'వివాహం': 4, 'భార్య': 3, 'భర్త': 3, 'పెళ్ళికి': 3, 'ముహూర్తం': 3, 'పెళ్లిళ్ళు': 3,
      'शादी': 4, 'विवाह': 4, 'पति': 3, 'पत्नी': 3, 'सगाई': 3, 'लग्न': 3, 'दूल्हा': 2, 'दुल्हन': 2,
      'கல்யாணம்': 4, 'திருமணம்': 4, 'கணவர்': 3, 'மனைவி': 3, 'நிச்சயதார்த்தம்': 3,
      'ಮದುವೆ': 4, 'ವಿವಾಹ': 4, 'ಹೆಂಡತಿ': 3, 'ಗಂಡ': 3, 'ನಿಶ್ಚಿತಾರ್ಥ': 3,
      'വിവാഹം': 4, 'കല്യാണം': 4, 'ഭാര്യ': 3, 'ഭർത്താവ്': 3, 'നിശ്ചിതാർത്ഥം': 3 }
  },
  OPPORTUNITIES: {
    terms: { 'అవకాశం': 3, 'అవకాశాలు': 3, 'విజయం': 3, 'గుర్తింపు': 2, 'లక్ష్యాలు': 2,
      'अवसर': 3, 'मौका': 3, 'सफलता': 3, 'पहचान': 2, 'लक्ष्य': 2,
      'வாய்ப்பு': 3, 'வெற்றி': 3, 'அங்கீகாரம்': 2,
      'ಅವಕಾಶ': 3, 'ಯಶಸ್ಸು': 3, 'ಗುರುತಿಸುವಿಕೆ': 2,
      'അവസരം': 3, 'വിജയം': 3, 'അംഗീകാരം': 2 }
  },
  INTIMACY: {
    terms: { 'అంతరంగిక': 3, 'లైంగిక': 3, 'శారీరక': 2, 'కోరిక': 2, 'సెక్స్': 3,
      'కన్యాత్వం': 5, 'కన్యాత్వాన్ని': 5, 'కన్యాత్వానికి': 5,
      'अंतरंगता': 3, 'लैंगिक': 3, 'शारीरिक': 2, 'कामुक': 2, 'सेक्स': 3, 'इच्छा': 2,
      'உடலுறவு': 4, 'பாலியல்': 3, 'காமம்': 3, 'உடல்': 1,
      'ಲೈಂಗಿಕ': 3, 'ದೈಹಿಕ': 3, 'ಕಾಮ': 2,
      'ലൈംഗിക': 3, 'ശാരീരിക': 2, 'കാമുകത്വം': 2 }
  },
  PERSONALITY: {
    terms: { 'వ్యక్తిత్వం': 3, 'స్వభావం': 3, 'బలహీనత': 2, 'ఆత్మవిశ్వాసం': 3, 'లక్షణాలు': 2,
      'व्यक्तित्व': 3, 'स्वभाव': 3, 'कमजोरी': 2, 'आत्मविश्वास': 3, 'खूबियां': 2, 'खामियां': 2,
      'பண்பு': 3, 'இயல்பு': 3, 'தன்னம்பிக்கை': 3, 'குணம்': 2,
      'ವ್ಯಕ್ತಿತ್ವ': 3, 'ಸ್ವಭಾವ': 3, 'ಆತ್ಮವಿಶ್ವಾಸ': 3,
      'വ്യക്തിത്വം': 3, 'സ്വഭാവം': 3, 'ആത്മവിശ്വാസം': 3 }
  },
  EMOTIONAL_PATTERNS: {
    terms: { 'అధిక ఆలోచన': 5, 'ఆలోచన': 2, 'ఆందోళన': 3, 'ఒత్తిడి': 3, 'భయం': 2, 'టెన్షన్': 3,
      'ओवरथिंकिंग': 5, 'चिंता': 3, 'तनाव': 3, 'दबाव': 3, 'घबराहट': 3, 'बेचैनी': 3,
      'அதிக சிந்தனை': 5, 'கவலை': 3, 'அழுத்தம்': 3, 'பயம்': 2,
      'ಅತಿಚಿಂತೆ': 5, 'ಚಿಂತೆ': 3, 'ಒತ್ತಡ': 3, 'ಆತಂಕ': 3,
      'അമിതചിന്ത': 5, 'ആശങ്ക': 3, 'സമ്മർദ്ദം': 3, 'ഉത്കണ്ഠ': 3 }
  },
  YEARLY_OUTLOOK: {
    terms: { 'సంవత్సరం': 2, 'ఏడాది': 2, 'అదృష్టం': 3, 'కాలం': 1,
      'साल': 2, 'संवत्सर': 2, 'भाग्य': 3, 'किस्मत': 3, 'वर्ष': 2,
      'ஆண்டு': 2, 'அதிர்ஷ்டம்': 3, 'காலம்': 1,
      'ವರ್ಷ': 2, 'ಅದೃಷ್ಟ': 3, 'ಕಾಲ': 1,
      'വർഷം': 2, 'ഭാഗ്യം': 3, 'കാലം': 1 },
    phrases: { 'ఈ సంవత్సరం': 5, 'ఈ ఏడాది': 5, 'నా సంవత్సరం': 5,
      'इस साल': 5, 'इस वर्ष': 5, 'मेरा साल': 5, 'अगला साल': 5,
      'இந்த ஆண்டு': 5, 'அடுத்த ஆண்டு': 5,
      'ಈ ವರ್ಷ': 5, 'ಮುಂದಿನ ವರ್ಷ': 5,
      'ഈ വർഷം': 5, 'അടുത്ത വർഷം': 5 }
  },
  EDUCATION: {
    terms: { 'చదువు': 3, 'పరీక్ష': 3, 'డిగ్రీ': 3, 'విద్య': 3, 'కాలేజ్': 2, 'యూనివర్సిటీ': 2, 'సబ్జెక్టు': 2,
      'पढ़ाई': 3, 'परीक्षा': 3, 'डिग्री': 3, 'शिक्षा': 3, 'कॉलेज': 2, 'पढ़ना': 2, 'रिजल्ट': 3,
      'படிப்பு': 3, 'தேர்வு': 3, 'கல்வி': 3, 'பள்ளி': 2, 'டிகிரி': 3,
      'ಓದು': 3, 'ಪರೀಕ್ಷೆ': 3, 'ಶಿಕ್ಷಣ': 3, 'ಕಾಲೇಜ್': 2,
      'പഠനം': 3, 'പരീക്ഷ': 3, 'വിദ്യാഭ്യാസം': 3, 'സ്കൂൾ': 2 }
  },
  CREATIVITY: {
    terms: { 'కళ': 3, 'సంగీతం': 3, 'నృత్యం': 2, 'రచన': 2, 'పెయింటింగ్': 2, 'కవిత్వం': 3, 'సృజన': 3,
      'कला': 3, 'संगीत': 3, 'नृत्य': 2, 'लेखन': 2, 'कविता': 3, 'चित्रकला': 3,
      'கலை': 3, 'இசை': 3, 'நடனம்': 2, 'எழுத்து': 2, 'கவிதை': 3,
      'ಕಲೆ': 3, 'ಸಂಗೀತ': 3, 'ನೃತ್ಯ': 2, 'ಬರವಣಿಗೆ': 2,
      'കല': 3, 'സംഗീതം': 3, 'നൃത്തം': 2, 'എഴുത്ത്': 2 }
  },
  SOCIAL_LIFE: {
    terms: { 'స్నేహితులు': 3, 'స్నేహం': 3, 'మిత్రులు': 3, 'ఒంటరితనం': 4, 'ఒంటరి': 3, 'నెట్‌వర్క్': 2,
      'दोस्त': 3, 'दोस्ती': 3, 'अकेलापन': 4, 'साथी': 2, 'समूह': 2,
      'நண்பர்கள்': 3, 'நட்பு': 3, 'தனிமை': 4,
      'ಸ್ನೇಹಿತರು': 3, 'ಸ್ನೇಹ': 3, 'ಏಕಾಂತತೆ': 4,
      'സുഹൃത്തുക്കൾ': 3, 'സൗഹൃദം': 3, 'ഒറ്റപ്പെടൽ': 4 }
  },
  FAMILY: {
    terms: { 'కుటుంబం': 3, 'తల్లి': 3, 'తండ్రి': 3, 'అమ్మ': 2, 'నాన్న': 2, 'అన్న': 2, 'చెల్లి': 2, 'తోబుట్టువులు': 3,
      'परिवार': 3, 'मां': 3, 'माँ': 3, 'पिता': 3, 'भाई': 3, 'बहन': 3, 'रिश्तेदार': 3, 'घर': 1,
      'குடும்பம்': 3, 'அம்மா': 3, 'அப்பா': 3, 'சகோதரி': 3, 'சகோதரன்': 3, 'வீடு': 1,
      'ಕುಟುಂಬ': 3, 'ಅಮ್ಮ': 3, 'ಅಪ್ಪ': 3, 'ಸಹೋದರ': 3, 'ಮನೆ': 1,
      'കുടുംബം': 3, 'അമ്മ': 3, 'അച്ഛൻ': 3, 'സഹോദരൻ': 3, 'വീട്': 1 }
  },
  CHILDREN: {
    terms: { 'పిల్లలు': 3, 'పిల్లల': 3, 'బిడ్డ': 3, 'గర్భం': 3, 'కుమారుడు': 3, 'కుమార్తె': 3, 'ప్రసవం': 3,
      'बच्चे': 3, 'बच्चा': 3, 'संतान': 4, 'गर्भ': 3, 'बेटा': 3, 'बेटी': 3, 'प्रसव': 3,
      'குழந்தை': 3, 'குழந்தைகள்': 3, 'கர்ப்பம்': 3, 'மகன்': 3, 'மகள்': 3,
      'ಮಕ್ಕಳು': 3, 'ಮಗು': 3, 'ಗರ್ಭ': 3, 'ಮಗ': 3, 'ಮಗಳು': 3,
      'കുട്ടികൾ': 3, 'കുഞ്ഞ്': 3, 'ഗർഭം': 3, 'മകൻ': 3, 'മകൾ': 3 }
  },
  TRAVEL: {
    terms: { 'విదేశాలు': 4, 'ప్రయాణం': 3, 'వలస': 3, 'వీసా': 4, 'జాగా': 1,
      'विदेश': 4, 'यात्रा': 3, 'प्रवास': 3, 'वीज़ा': 4, 'बाहर': 2,
      'வெளிநாடு': 4, 'பயணம்': 3, 'குடியேற்றம்': 3, 'வீசா': 4,
      'ವಿದೇಶ': 4, 'ಪ್ರಯಾಣ': 3, 'ವೀಸಾ': 4,
      'വിദേശം': 4, 'യാത്ര': 3, 'വീസ': 4 }
  },
  LIFE_DIRECTION: {
    terms: { 'దిశ': 3, 'దిశలు': 3, 'ఉద్దేశ్యం': 3, 'లక్ష్యం': 3, 'నిర్ణయం': 3, 'ప్రయాణం': 1,
      'दिशा': 3, 'मकसद': 3, 'उद्देश्य': 3, 'लक्ष्य': 3, 'फैसला': 3, 'निर्णय': 3,
      'திசை': 3, 'நோக்கம்': 3, 'இலக்கு': 3, 'முடிவு': 3,
      'ದಿಕ್ಕು': 3, 'ಗುರಿ': 3, 'ನಿರ್ಧಾರ': 3,
      'ദിശ': 3, 'ലക്ഷ്യം': 3, 'തീരുമാനം': 3 }
  },
  DIFFICULT_PHASE: {
    terms: { 'కష్టం': 3, 'కష్టమైన': 3, 'ఇబ్బంది': 3, 'సంఘర్షణ': 3, 'సమస్య': 2, 'ఒత్తిడి': 2,
      'कठिन': 3, 'मुश्किल': 3, 'संघर्ष': 3, 'परेशानी': 3, 'समस्या': 2, 'तनाव': 2,
      'கஷ்டம்': 3, 'சிரமம்': 3, 'பிரச்சனை': 3, 'சூழ்நிலை': 2,
      'ಕಠಿಣ': 3, 'ಕಷ್ಟ': 3, 'ಸಮಸ್ಯೆ': 3, 'ಪರಿಸ್ಥಿತಿ': 2,
      'ബുദ്ധിമുട്ട്': 3, 'കഠിനം': 3, 'പ്രശ്നം': 3, 'സാഹചര്യം': 2 },
    phrases: { 'కష్టమైన దశ': 6, 'కష్ట సమయం': 6,
      'कठिन समय': 6, 'मुश्किल दौर': 6, 'बुरा वक्त': 6,
      'கஷ்டமான காலம்': 6, 'சிரமமான நேரம்': 6,
      'ಕಠಿಣ ಹಂತ': 6, 'ಕಷ್ಟದ ಸಮಯ': 6,
      'ബുദ്ധിമുട്ടുള്ള കാലം': 6 }
  }
};

/**
 * Romanized spellings, matched as whole tokens. The variant list is
 * deliberate: customers type naku/naaku, ela/elaa, eppudu/epudu,
 * untundi/untundhi/avutundi/avuthundi, pelli/kalyanam interchangeably, and a
 * single canonical spelling would silently drop most real questions.
 */
const ROMANIZED_SIGNALS = {
  CAREER: {
    terms: { 'naukri': 3, 'nokri': 3, 'kaam': 2, 'kam': 1, 'udyogam': 3, 'pani': 2, 'thozhil': 3, 'kelasa': 3, 'joli': 3 }
  },
  MONEY: {
    terms: { 'paise': 3, 'paisa': 3, 'bachat': 3, 'karz': 3, 'karj': 3, 'dhan': 2, 'nikammi': 2, 'dabbu': 3, 'podupu': 3, 'panam': 3, 'hana': 3 }
  },
  LOVE: {
    terms: { 'pyaar': 3, 'prem': 3, 'rishta': 3, 'rishte': 3, 'premi': 3, 'prema': 3, 'kaadhal': 4, 'sneham': 3, 'pranayam': 3 }
  },
  MARRIAGE: {
    terms: { 'shadi': 4, 'shaadi': 4, 'vivah': 4, 'sagai': 3, 'lagan': 3, 'pati': 3, 'patni': 3, 'pelli': 4, 'kalyanam': 4, 'kalyananam': 4, 'thirumana': 4, 'maduve': 4, 'vivaham': 4 }
  },
  OPPORTUNITIES: {
    terms: { 'mauka': 3, 'avakasam': 3, 'kamiyabi': 3, 'kamyabi': 3, 'vijayam': 3 }
  },
  INTIMACY: {
    terms: { 'antargat': 3, 'shareerik': 2, 'kamukta': 3, 'urimai': 1,
      'kanyatvam': 5, 'kanyatvanni': 5, 'kanyatvanu': 5 }
  },
  PERSONALITY: {
    terms: { 'swabhav': 3, 'swabhavam': 3, 'vyaktitva': 3, 'panbu': 3, 'swabhava': 3 }
  },
  EMOTIONAL_PATTERNS: {
    terms: { 'chinta': 3, 'tanaav': 3, 'overthinking': 4, 'gabrahahat': 3, 'aandolana': 3, 'manaseeyam': 2 }
  },
  YEARLY_OUTLOOK: {
    terms: { 'saal': 2, 'kismat': 3, 'bhagya': 3, 'samvatsaram': 2, 'edadi': 2, 'aandu': 2, 'varsham': 2 },
    phrases: { 'is saal': 5, 'ee samvatsaram': 5, 'ee saal': 5, 'ee andu': 5 }
  },
  EDUCATION: {
    terms: { 'padhai': 3, 'pariksha': 3, 'shiksha': 3, 'chaduvu': 3, 'padi': 1, 'padithal': 3, 'oduvu': 3 }
  },
  CREATIVITY: {
    terms: { 'kalaa': 3, 'sangeet': 3, 'sangeetham': 3, 'isai': 3, 'nritta': 2 }
  },
  SOCIAL_LIFE: {
    terms: { 'dost': 3, 'dosti': 3, 'akelapan': 3, 'mitrulu': 3, 'snehithulu': 3, 'nanbargal': 3, 'snehitaru': 3 }
  },
  FAMILY: {
    terms: { 'parivar': 3, 'kutumbam': 3, 'kudumbam': 3, 'kudumba': 3, 'kudukkal': 3 }
  },
  CHILDREN: {
    terms: { 'bachche': 3, 'bacha': 3, 'santan': 4, 'beta': 3, 'beti': 3, 'pillalu': 3, 'bidda': 3, 'kuzhandhai': 3, 'makkal': 3, 'makkale': 3 }
  },
  TRAVEL: {
    terms: { 'videsh': 4, 'yatra': 3, 'visa': 4, 'videshalu': 4, 'videsalu': 4, 'videsealu': 4, 'prayana': 3, 'payanam': 3 }
  },
  LIFE_DIRECTION: {
    terms: { 'dishaa': 3, 'lakshya': 3, 'faisla': 3, 'disa': 3, 'lakshyam': 3, 'nirnay': 3 }
  },
  DIFFICULT_PHASE: {
    terms: { 'mushkil': 3, 'sangharsh': 3, 'pareshani': 3, 'kastam': 3, 'ibbandi': 3, 'kasta': 3, 'budhimutt': 3 },
    phrases: { 'kastamaina': 5, 'mushkil waqt': 6, 'bura waqt': 6 }
  }
};

/**
 * Time words per language, matched as whole tokens. English timing wording
 * stays in TIME_SIGNALS below; this list only adds the Indic and romanized
 * equivalents so "eppudu job vastundi" and "kab naukri milegi" derive exactly
 * the same window as "when will I get the job".
 */
const TIME_TOKENS = new Set([
  // Telugu (native)
  'ఎప్పుడు', 'టైమింగ్', 'సమయం', 'సంవత్సరం', 'వయసులో', 'త్వరలో',
  // Hindi (native)
  'कब', 'कबी', 'कबतक', 'समय', 'टाइमिंग', 'साल', 'वर्ष', 'उम्र', 'जल्दी',
  // Tamil
  'எப்போது', 'எப்போ', 'நேரம்', 'ஆண்டு', 'காலம்', 'வயது', 'விரைவில்',
  // Kannada
  'ಯಾವಾಗ', 'ಯಾವಾಗಲೂ', 'ಸಮಯ', 'ವರ್ಷ', 'ವಯಸ್ಸು', 'ಬೇಗ',
  // Malayalam
  'എപ്പോൾ', 'എപ്പോ', 'സമയം', 'വർഷം', 'പ്രായം', 'വൈകാതെ',
  // Romanized variants
  'kab', 'kabhi', 'kabtak', 'eppudu', 'epudu', 'yeppudu', 'eppatiki', 'eppatiko',
  'eppothu', 'eppothum', 'eppol', 'eppazhuthe', 'yavaga', 'yavagaadru', 'yavake',
  'saal', 'samvatsaram', 'varsham', 'andu', 'aandu', 'varusham', 'samayam',
  'time', 'timing', 'year', 'when', 'soon', 'age'
]);

/** Descriptive ("what kind of...") wording that does not ask WHEN. */
const DESCRIPTIVE_TOKENS = new Set([
  'ఎలాంటి', 'ఏరకమైన',
  'कैसा', 'कैसी', 'कैसे',
  'எப்படிப்பட்ட',
  'ಹೇಗಿರುವ',
  'എങ്ങനെയുള്ള'
]);
const DESCRIPTIVE_PHRASES = [
  'నా గురించి చెప్పు', 'నా లక్షణాలు', 'నా లాంటివి',
  'मेरे बारे में बताओ', 'मेरे बारे में', 'किस तरह', 'कैसे दिखता', 'कैसे दिखती',
  'என்னைப் பற்றி சொல்லு', 'எப்படிப்பட்டவர்',
  'ನನ್ನ ಬಗ್ಗೆ ಹೇಳು', 'ಹೇಗಿರುತ್ತಾನೆ',
  'എന്നെക്കുറിച്ച് പറയൂ', 'എങ്ങനെയുള്ളവൻ'
];

/** Native + romanized out-of-scope signals (model probing, coding, general knowledge). */
const OUT_OF_SCOPE_NATIVE = {
  terms: { 'మోడల్': 3, 'ప్రాంప్ట్': 6, 'చాట్‌జీపీటీ': 6, 'కోడ్': 4, 'ప్రోగ్రామింగ్': 4,
    'వాతావరణం': 4, 'వార్తలు': 3,
    'मॉडल': 3, 'मोडल': 3, 'प्रॉम्प्ट': 6, 'चैटजीपीटी': 6, 'कोड': 4, 'प्रोग्रामिंग': 4, 'एआई': 3,
    'मौसम': 4, 'समाचार': 3, 'खबर': 3,
    'மாடல்': 3, 'ப்ராம்ப்ட்': 6, 'கோட்': 4, 'ப்ரோகிராமிங்': 4,
    'வானிலை': 4, 'செய்தி': 3,
    'ಮಾಡೆಲ್': 3, 'ಪ್ರಾಂಪ್ಟ್': 6, 'ಕೋಡ್': 4, 'ಪ್ರೋಗ್ರಾಮಿಂಗ್': 4,
    'ಹವಾಮಾನ': 4, 'ಸುದ್ದಿ': 3,
    'മോഡൽ': 3, 'പ്രോംപ്റ്റ്': 6, 'കോഡ്': 4, 'പ്രോഗ്രാമിംഗ്': 4,
    'കാലാവസ്ഥ': 4, 'വാർത്ത': 3 },
  phrases: { 'ai model': 7, 'ai models': 7, 'artificial intelligence': 7, 'machine learning': 6,
    'ai मॉडल': 7, 'ai मोडल': 7, 'ai మోడల్': 7, 'ai மாடல்': 7, 'ai ಮಾಡೆಲ್': 7, 'ai മോഡൽ': 7,
    'ki coding': 6, 'code likh': 6,
    'ఈ రోజు వాతావరణం': 8, 'నేటి వాతావరణం': 8, 'నేటి వార్తలు': 8,
    'आज का मौसम': 8, 'आज की खबर': 8,
    'இன்றைய வானிலை': 8, 'இன்றைய செய்தி': 8,
    'ಇಂದಿನ ಹವಾಮಾನ': 8, 'ಇಂದಿನ ಸುದ್ದಿ': 8,
    'ഇന്നത്തെ കാലാവസ്ഥ': 8, 'ഇന്നത്തെ വാർത്ത': 8 }
};

/** Which out-of-scope kind this is: a model/provider probe vs a general-assistant ask. */
const MODEL_PRIVACY_WORDS = /\b(model|prompt|gpt|llm|openai|gemini|claude|chatbot|bot|human|instructions|api|token|algorithm|technology)\b|(मॉडल|मोडल|एआई|प्रॉम्प्ट|మోడల్|ఏఐ|ప్రాంప్ట్|மாடல்|ஏஐ|ಮಾಡೆಲ್|എഐ|മോഡൽ)/i;

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
 *
 * English signals keep their original substring behavior; native-script and
 * romanized signals are added on top and matched as whole tokens so a
 * Telugu word can never match inside another Telugu word.
 */
function scoreFamily(text, family, tokens, nativeFamily, romanFamily) {
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
  if (tokens && nativeFamily) {
    score += scoreTokenSignals(tokens, nativeFamily.terms);
    score += scorePhraseSignals(tokens, nativeFamily.phrases);
  }
  if (tokens && romanFamily) {
    score += scoreTokenSignals(tokens, romanFamily.terms);
    score += scorePhraseSignals(tokens, romanFamily.phrases);
  }
  return score;
}

function scoreOutOfScope(text, tokens) {
  const flat = text.replace(/'/g, '');
  let score = 0;
  for (const term of Object.keys(OUT_OF_SCOPE.signals)) {
    if (text.indexOf(term) !== -1) score += OUT_OF_SCOPE.signals[term];
  }
  for (const phrase of Object.keys(OUT_OF_SCOPE.phrases)) {
    const flatPhrase = phrase.replace(/'/g, '');
    if (text.indexOf(phrase) !== -1 || flat.indexOf(flatPhrase) !== -1) score += OUT_OF_SCOPE.phrases[phrase];
  }
  if (tokens) {
    score += scoreTokenSignals(tokens, OUT_OF_SCOPE_NATIVE.terms);
    score += scorePhraseSignals(tokens, OUT_OF_SCOPE_NATIVE.phrases);
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

// Brand spellings for the product itself (English + native scripts), matched
// anywhere in the question without a word boundary so inflected forms
// ("palmpyaarella", "palmpyaar లో") still match. The space-separated Telugu/
// Kannada variants exist because normalize() strips the ZWNJ joiner that
// connects the two halves of the brand in those scripts.
const PRODUCT_BRAND = /palmpyaar|palmpyar|palm[ -]pyaar|పాల్మ్‌ప్యార్|పాల్మ్ప్యార్|పాల్మ్ ప్యార్|पाल्म्प्यार|பால்ம்பியார்|ಪಾಲ್ಮ್‌ಪ್ಯಾರ್|ಪಾಲ್ಮ್ಪ್ಯಾರ್|ಪಾಲ್ಮ್ ಪ್ಯಾರ್|പാല്മ്പ്യാർ/i;

/**
 * "How does PalmPyaar work?" — a question about the app, not about the
 * customer's chart. Requires the brand name inside a local window plus a
 * work cue, so a brand mention alone never derails an in-scope reading.
 */
function looksLikeProductHowItWorks(raw, text) {
  const src = typeof text === 'string' ? text : '';
  const m = PRODUCT_BRAND.exec(src);
  if (!m) return false;
  const start = Math.max(0, m.index - 50);
  const end = Math.min(src.length, m.index + m[0].length + 50);
  const win = src.slice(start, end);
  const cueA = /\bhow (does|do|to)\b/.test(win);
  const cueB = /\bworks?\b/.test(win) && !/\b(my|naa|నా)\s+work\b/.test(win);
  const cueC = /ఎలా/.test(win) && /పని/.test(win);
  const cueD = /\bela\b/.test(win) && /(chest|use|pani|chey|ches)/.test(win);
  return cueA || cueB || cueC || cueD;
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
  const tokens = tokenize(text);

  const intent = {
    domain: 'GENERAL',
    topic: 'general',
    label: 'your reading',
    timing: TIME_SIGNALS.test(text) || tokens.some((t) => TIME_TOKENS.has(t)),
    descriptive: DESCRIPTIVE_SIGNALS.test(text)
      || tokens.some((t) => DESCRIPTIVE_TOKENS.has(t))
      || DESCRIPTIVE_PHRASES.some((p) => hasTokenPhrase(tokens, p)),
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
  const oos = scoreOutOfScope(text, tokens);
  if (oos >= 6) {
    intent.domain = 'OUT_OF_SCOPE';
    intent.topic = null;
    intent.label = null;
    intent.inScope = false;
    intent.outOfScopeKind = MODEL_PRIVACY_WORDS.test(text) ? 'model_privacy' : 'general_assistant';
    intent.timing = false;
    intent.scores.OUT_OF_SCOPE = oos;
    return intent;
  }

  // 2b. Product "how it works" questions are out of scope too: they are about
  //     the app, not about the customer's chart. The redirect copy lives in
  //     the bundles (productHowItWorks).
  if (looksLikeProductHowItWorks(raw, text)) {
    intent.domain = 'OUT_OF_SCOPE';
    intent.topic = null;
    intent.label = null;
    intent.inScope = false;
    intent.outOfScopeKind = 'product_how_it_works';
    intent.timing = false;
    return intent;
  }

  // 3. Score every concept family.
  const scores = {};
  let best = null;
  let bestScore = 0;
  let runnerUp = 0;
  for (const key of Object.keys(FAMILIES)) {
    const s = scoreFamily(text, FAMILIES[key], tokens, NATIVE_SIGNALS[key], ROMANIZED_SIGNALS[key]);
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

  // 5b. Strong marriage signals win outright: phrasings like "when will I get
  //     married" can also carry evaluation or competing love wording, and the
  //     marriage question must keep the marriage domain.
  if ((scores.MARRIAGE || 0) >= 4) {
    intent.domain = 'MARRIAGE';
    intent.topic = FAMILIES.MARRIAGE.evidenceTopic;
    intent.label = FAMILIES.MARRIAGE.label;
    intent.evaluation = evaluation;
    return intent;
  }

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