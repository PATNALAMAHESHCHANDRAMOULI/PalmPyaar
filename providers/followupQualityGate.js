/**
 * PalmPyaar Follow-Up Quality Gate â€” providers/followupQualityGate.js
 *
 * Deterministic, model-free validation of an AI follow-up answer. Runs on the
 * server after generation and before the answer reaches the customer.
 *
 * Purpose: the "answer-first" contract in providers/answerContract.js is a
 * prompt instruction, and prompt instructions are not guarantees. This gate is
 * the enforcement layer. A failing answer is discarded in favour of the
 * deterministic answer from api/ask-question, so a regression in model
 * behaviour degrades quality rather than shipping to a paying customer.
 *
 * This module only READS text. It never calls the model, never touches
 * payment, token, or question-limit logic, and has no side effects.
 */

'use strict';

const { classifyQuestion } = require('../lib/questionIntent');

/**
 * Technical vocabulary that must never lead an answer or dominate it.
 * Kept deliberately narrow so ordinary words ("career", "partner") do not
 * trip the gate.
 */
const JARGON_TERMS = [
  'mahadasha', 'maha dasha', 'antardasha', 'antardasha', 'dasha', 'dashas',
  'nakshatra', 'pada', 'rashi', 'lagna', 'ascendant', 'profection', 'profections',
  'transit', 'transits', 'conjunction', 'opposition', 'trine', 'sextile',
  'square', 'retrograde', 'retrograde', 'nakshatras', 'vargottama',
  'rahu', 'ketu', 'sade sati', 'pada', 'dignity', 'sect'
];

/** Guaranteed-outcome phrasing. */
const GUARANTEE_PATTERNS = [
  /\bguaranteed\b/i,
  /\bwill definitely\b/i,
  /\bwill certainly\b/i,
  /\bdefinitely will\b/i,
  /\bcertainly will\b/i,
  /\b100% (sure|certain|guaranteed)\b/i,
  /\byou will (definitely |certainly )?(meet|marry|find (a |an )?(job|partner|love)|get (a )?(job|promotion|rich)|lose your virginity|have a baby|become pregnant|win the lottery|get married)\b/i,
  /\b(is|are) guaranteed\b/i,
  /\bi promise\b/i
];

/**
 * Disclosure of the underlying model / provider / implementation.
 *
 * Bare model names are deliberately NOT used as triggers: "Gemini" is also a
 * zodiac sign and a legitimate, extremely common chart reference. A live run
 * rejected a perfectly good career answer purely because the customer was
 * born in Gemini. Model names are therefore only flagged when they appear in
 * a model/vendor construction ("Google Gemini", "an LLM", "GPT-4").
 */
const PROVIDER_PATTERNS = [
  /\b(gpt|chatgpt|gpt-?4|gpt-?o\d|openai)\b/i,
  /\b(large language model|llm|language model|ai model|ai assistant|chatbot)\b/i,
  /\b(neural network|machine learning model|transformer model)\b/i,
  // Vendor + model name, or model name described as a model/system.
  /\b(google|anthropic|meta|openai|alibaba|deepmind|microsoft)\s+[a-z]{3,12}\b/i,
  /\b(gemini|claude|llama|mistral|deepseek|qwen|grok)\s+(model|ai|assistant|system)\b/i,
  /\bfine-?tuned\b/i,
  /\b(system prompt|prompt engineering|your prompt|the prompt above|my instructions|i was instructed|as an ai language|as a language model)\b/i,
  /\b(api key|secret key|access token|token secret)\b/i,
  /\b(amazon web services)\b/i
];

/** Credential-shaped strings. */
const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9]{16,}/,
  /\bgsk_[A-Za-z0-9]{10,}/,
  /\brzp_(live|test)_[A-Za-z0-9]{8,}/,
  /\brazorpay_secret\b/i,
  /\bwebhook_secret\b/i,
  /\btoken_secret\b/i,
  /\b[A-Za-z0-9_-]{32,}\b(?=\s*(?:is|=|:)\s*(?:your|the)\s*(?:key|secret|token))/i
];

/** Clearly graphic sexual content â€” never acceptable, in any domain. */
const GRAPHIC_PATTERNS = [
  /\bpenetrat(e|ed|es|ing|ion)\b/i,
  /\bintercourse\b/i,
  /\borgasm\b/i,
  /\bgenital/i,
  /\bfellatio\b/i,
  /\bblowjob\b/i,
  /\bexplicit sex\b/i
];

/** General-assistant leakage, only relevant for out-of-scope questions. */
const OUT_OF_SCOPE_LEAK = [
  /```/,
  /\bfunction\s+\w+\s*\(/,
  /\b(public|private|static)\s+(void|int|String|class)\b/,
  /\b(import|require)\s+[\w.]+/,
  /\b(def|class)\s+\w+\s*[:(]/,
  /\b(bitcoin|ethereum|stock price|share price|weather today)\b/i,
  /\b(here is|here's) (the )?(code|program|script|function)\b/i
];

/**
 * Named palm lines, mounts, and "your palm shows ..." claims. The follow-up
 * flow never receives palm-line observations — palm evidence is geometry
 * only (palmBounds, fingerRatios, geometricRatios, palmAngle) — and both the
 * prompt and the palm geometry formatter forbid naming lines or mounts. Any
 * answer that claims one is inventing it, in any language.
 */
const PALM_CLAIM_PATTERNS = [
  /\b(heart|head|life|fate) line\b/i,
  /\bmount(s)? of\b/i,
  /\bpalm lines?\b/i,
  /\byour palm (shows|says|reveals|indicates)\b/i,
  /హృదయ రేఖ|జీవన రేఖ|బుద్ధి రేఖ/,
  /हृदय रेखा|आयु रेखा/,
  /இதயக் கோடு|வாழ்க்கைக் கோடு/,
  /ಹೃದಯರೇಖೆ/,
  /ഹൃദയരേഖ/
];

/**
 * Unsupported specificity: day-level dates, fixed countdown timeframes, and
 * exact child counts. Bare years and year ranges ("2026", "2026-2028") are
 * legitimate — that is the format timingEngine.windows use — and are not
 * matched.
 */
const UNSUPPORTED_SPECIFICITY_PATTERNS = [
  /\b\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i,
  /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+\d{1,2}(?:st|nd|rd|th)?(?!\d)\b/i,
  /\b\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}\b/,
  /\bin (?:about )?\d{1,4} (?:days?|weeks?|months?|years?)\b/i,
  /\b\d{1,2}\s+(?:children|kids|babies)\b/i
];

/**
 * Native script of each language we ship localized copy for, plus the brand
 * written in that script. An out-of-scope redirect in the customer's language
 * names PalmPyaar in native script rather than the ASCII phrases used by the
 * English reply, so the redirect check must accept both.
 */
const NATIVE_SCRIPTS = {
  telugu: /[\p{Script=Telugu}]/gu,
  hindi: /[\p{Script=Devanagari}]/gu,
  tamil: /[\p{Script=Tamil}]/gu,
  kannada: /[\p{Script=Kannada}]/gu,
  malayalam: /[\p{Script=Malayalam}]/gu
};

const NATIVE_BRAND_REDIRECT = {
  telugu: /పాల్మ్‌ప్యార్|పాల్మ్ప్యార్/,
  hindi: /पाल्म्प्यार/,
  tamil: /பால்ம்பியார்/,
  kannada: /ಪಾಲ್ಮ್‌ಪ್ಯಾರ್|ಪಾಲ್ಮ್ಪ್ಯಾರ್/,
  // The bundle spells the brand with പാൽ (chillu + virama), the general
  // redirect with പാല്മ്; both spellings must pass the redirect check.
  malayalam: /പാല്മ്പ്യാർ|പാൽമ്പ്യാർ/
};

/**
 * Share of native-script letters in the answer body. Section labels are Latin
 * by design in every language, so they are excluded before measuring. A
 * threshold of 0.25 tolerates natural mixed-language answers (labels, years,
 * loanwords) while rejecting clearly-English ones.
 */
const MIN_NATIVE_SCRIPT_SHARE = 0.25;

function nativeScriptShare(text, language) {
  const pattern = NATIVE_SCRIPTS[String(language || '').toLowerCase()];
  if (!pattern) return null;
  const body = String(text || '');
  const native = (body.match(pattern) || []).length;
  const latin = (body.match(/[A-Za-z]/g) || []).length;
  const total = native + latin;
  if (total === 0) return 0;
  return native / total;
}

/** Convert answer HTML to plain text with no markup and no section markers. */function stripHtml(html) {
  return String(html || '')
    .replace(/<h4[^>]*>[\s\S]*?<\/h4>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/[ ]*\n[ ]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Split answer HTML into its labelled sections. Returns plain-text sections
 * with labels removed, so internal markers never leak into analysed content.
 */
function sectionTexts(html) {
  const marked = String(html || '')
    .replace(/<h4[^>]*>/gi, '\u0001')
    .replace(/<\/h4>/gi, '\u0002');
  return marked
    .split('\u0001')
    .slice(1)
    .map(function (part) {
      const body = part.split('\u0002').slice(1).join(' ');
      return stripHtml(body);
    })
    .filter(function (s) { return s.trim().length > 0; });
}

/** Text of the first labelled section (the direct answer). */
function firstSection(html) {
  const sections = sectionTexts(html);
  return sections.length ? sections[0] : stripHtml(html);
}

/**
 * Count technical terms using word boundaries, so ordinary words that merely
 * contain a jargon substring ("transition" vs "transit") are not counted.
 */
function countJargon(text) {
  const lower = String(text || '').toLowerCase();
  let n = 0;
  for (const term of JARGON_TERMS) {
    const re = new RegExp('\\b' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g');
    const m = lower.match(re);
    if (m) n += m.length;
  }
  return n;
}

function hasPattern(text, patterns) {
  for (const p of patterns) if (p.test(text)) return p;
  return null;
}

/**
 * Validate an AI follow-up answer against the product contract.
 *
 * @param {string} answerHtml
 * @param {object} intent  from lib/questionIntent.classifyQuestion
 * @param {object|null} timingContext
 * @param {string|null} [detectedLanguage] - customer's detected language;
 *   pass null for romanized questions (a Latin-script answer is legitimate)
 *   and for languages where we ship no localized copy.
 * @returns {{ ok: boolean, violations: string[], severity: string, metrics: object }}
 */
function evaluate(answerHtml, intent, timingContext, detectedLanguage) {
  const violations = [];
  const domain = (intent && intent.domain) || 'GENERAL';
  const text = stripHtml(answerHtml);
  const lower = text.toLowerCase();

  const metrics = {
    chars: text.length,
    words: text.split(/\s+/).filter(Boolean).length,
    jargon: countJargon(text),
    firstSectionJargon: countJargon(firstSection(answerHtml)),
    sections: (String(answerHtml || '').match(/<h4[^>]*>/gi) || []).length
  };

  const scriptShare = nativeScriptShare(text, detectedLanguage);
  if (scriptShare !== null) {
    metrics.nativeScriptShare = Math.round(scriptShare * 100) / 100;
  }

  // --- 0. Non-empty ---
  if (!text || metrics.words < 15) {
    return { ok: false, violations: ['EMPTY_OR_TOO_SHORT'], severity: 'hard', metrics: metrics };
  }

  // --- 1. Required direct answer section ---
  if (!/DIRECT ANSWER/i.test(answerHtml)) {
    violations.push('MISSING_DIRECT_ANSWER_SECTION');
  }

  // --- 2. Direct answer must not be a jargon dump ---
  if (metrics.firstSectionJargon >= 2) {
    violations.push('DIRECT_ANSWER_STARTS_WITH_JARGON');
  }

  // --- 3. Overall jargon density ---
  const jargonRatio = metrics.words ? metrics.jargon / metrics.words : 0;
  metrics.jargonRatio = Math.round(jargonRatio * 1000) / 1000;
  if (jargonRatio > 0.05) {
    violations.push('JARGON_DUMP');
  }

  // --- 4. No guaranteed predictions ---
  if (hasPattern(text, GUARANTEE_PATTERNS)) {
    violations.push('GUARANTEED_PREDICTION');
  }

  // --- 5. No model / provider / implementation disclosure ---
  if (hasPattern(text, PROVIDER_PATTERNS)) {
    violations.push('PROVIDER_DISCLOSURE');
  }

  // --- 6. No credentials ---
  if (hasPattern(text, SECRET_PATTERNS)) {
    violations.push('SECRET_DISCLOSURE');
  }

  // --- 7. Never graphic ---
  if (hasPattern(text, GRAPHIC_PATTERNS)) {
    violations.push('GRAPHIC_CONTENT');
  }

  // --- 8. Timing only when relevant and derived ---
  const supported = !!(timingContext && timingContext.supported && timingContext.window && timingContext.window.text);
  const wantsTiming = !!(intent && intent.timing);
  const mentionsWindow = /WINDOW/i.test(answerHtml);
  if (mentionsWindow && !(wantsTiming && supported)) {
    violations.push('UNSOLICITED_TIMING_WINDOW');
  }
  if (mentionsWindow && supported && !wantsTiming) {
    violations.push('UNSOLICITED_TIMING_WINDOW');
  }

  // --- 9. Out-of-scope questions must be redirected, not answered ---
  if (intent && intent.inScope === false) {
    if (hasPattern(text, OUT_OF_SCOPE_LEAK)) {
      violations.push('OUT_OF_SCOPE_ANSWERED');
    }
    if (metrics.words > 110) {
      violations.push('OUT_OF_SCOPE_TOO_LONG');
    }
    const astrologyLeak = /\b(dasha|nakshatra|mahadasha|antardasha|ascendant|rashi|horoscope)\b/i.test(lower);
    if (astrologyLeak && violations.indexOf('OUT_OF_SCOPE_ANSWERED') === -1) {
      violations.push('OUT_OF_SCOPE_ANSWERED');
    }
    const isProductRedirect = intent.outOfScopeKind === 'product_how_it_works';
    const englishRedirect = /palmpy aar|palmpy aar/i.test(lower) ||
      (isProductRedirect && /\bpalmpyaar\b/i.test(lower)) ||
      /focused on your/i.test(lower) || /here to focus/i.test(lower);
    const nativeBrand = NATIVE_BRAND_REDIRECT[String(detectedLanguage || '').toLowerCase()];
    const nativeRedirect = !!(nativeBrand && nativeBrand.test(text));
    if (!astrologyLeak && !englishRedirect && !nativeRedirect) {
      violations.push('OUT_OF_SCOPE_NO_REDIRECT');
    }
  }

  // --- 9b. Never claim named palm lines or mounts (geometry is the only evidence) ---
  if (hasPattern(text, PALM_CLAIM_PATTERNS)) {
    violations.push('UNSUPPORTED_PALM_CLAIM');
  }

  // --- 9c. No day-level dates, fixed countdowns, or exact child counts ---
  if (hasPattern(text, UNSUPPORTED_SPECIFICITY_PATTERNS)) {
    violations.push('UNSUPPORTED_SPECIFICITY');
  }

  // --- 9d. The answer must address the domain that was asked ---
  // Only fires when the question itself scored zero on its own domain (so an
  // ambiguous question that legitimately won its domain is never flagged),
  // the question was in scope, and the answer strongly classifies as a
  // different domain. An answer that generalises (answer domain GENERAL) is
  // always allowed.
  if (intent && intent.inScope !== false &&
      domain !== 'GENERAL' && domain !== 'NAME_MEANING' &&
      ((intent.scores && intent.scores[domain]) || 0) === 0) {
    const answerIntent = classifyQuestion(text);
    const answerScores = answerIntent.scores || {};
    let answerBest = 0;
    for (const key of Object.keys(answerScores)) {
      if (answerScores[key] > answerBest) answerBest = answerScores[key];
    }
    if (answerIntent.domain !== domain && answerIntent.domain !== 'GENERAL' && answerBest >= 4) {
      violations.push('QUESTION_NOT_ADDRESSED');
    }
  }

  // --- 10. Domain must not obviously answer a different domain ---
  if (domain === 'INTIMACY' && /graphic|see above/i.test(lower) === false) {
    // No structural requirement; recorded for metrics only.
    metrics.intimacyHandled = true;
  }

  // --- 11. Answer must actually be in the customer's language ---
  // Labels, years and a few loanwords are expected in any language, so only
  // answers that are clearly dominated by Latin script are rejected. A null
  // detectedLanguage (romanized question or unsupported language) skips this.
  if (scriptShare !== null && scriptShare < MIN_NATIVE_SCRIPT_SHARE) {
    violations.push('WRONG_LANGUAGE');
  }

  const hard = violations.filter(v => [
    'EMPTY_OR_TOO_SHORT', 'MISSING_DIRECT_ANSWER_SECTION', 'GUARANTEED_PREDICTION',
    'PROVIDER_DISCLOSURE', 'SECRET_DISCLOSURE', 'GRAPHIC_CONTENT',
    'OUT_OF_SCOPE_ANSWERED', 'OUT_OF_SCOPE_NO_REDIRECT', 'WRONG_LANGUAGE',
    'QUESTION_NOT_ADDRESSED', 'UNSUPPORTED_PALM_CLAIM', 'UNSUPPORTED_SPECIFICITY'
  ].indexOf(v) !== -1);

  const soft = violations.filter(v => hard.indexOf(v) === -1);

  return {
    ok: violations.length === 0,
    violations: violations,
    severity: hard.length ? 'hard' : (soft.length ? 'soft' : 'none'),
    metrics: metrics
  };
}

module.exports = {
  evaluate,
  stripHtml,
  firstSection,
  countJargon,
  JARGON_TERMS
};
