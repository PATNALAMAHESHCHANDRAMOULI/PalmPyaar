/**
 * PalmPyaar — FIX 2 regression suite: semantic question→answer grounding and
 * the post-generation quality gate with one controlled regeneration
 * (scripts/testAnswerGrounding.js).
 *
 * Covers:
 *   A  the required question matrix classifies correctly (romanized Telugu,
 *      English equivalents, Telugu native, 12 semantic-distinct questions:
 *      job x6, children x2, marriage x2, relationship, finance) — FIX 2a
 *   B  product "how it works" questions get the localized redirect, never an
 *      answer, and the redirect copy passes the gate in every language
 *      (contract + provider pre-check + gate section 9) — FIX 2b
 *   C  gate synthetic hard rejections: palm claims, unsupported specificity,
 *      question-not-addressed, out-of-scope answering — FIX 2d
 *   D  legitimate answers are not rejected by the new checks — FIX 2d
 *   E  attempt-2 prompt feedback: PREVIOUS ATTEMPT WAS REJECTED, GROUNDING
 *      section, palm geometry evidence threading — FIX 2c / FIX 1d
 *   F  regeneration wiring in api/ask-question: two attempts, reasons joined,
 *      four-argument gate call — FIX 2c / FIX 2d
 *
 * No network calls: the OpenAI SDK is stubbed via the require cache before
 * providers/groqProvider is loaded, and GROQ_API_KEY is set to a fake
 * in-memory value (no .env file is read or written).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

process.env.GROQ_API_KEY = 'test-key-grounding-suite';

const { classifyQuestion } = require(path.join(ROOT, 'lib', 'questionIntent.js'));
const gate = require(path.join(ROOT, 'providers', 'followupQualityGate.js'));
const contract = require(path.join(ROOT, 'providers', 'answerContract.js'));
const templates = require(path.join(ROOT, 'providers', 'answerTemplates.js'));

let passed = 0;
let failed = 0;
const pendingChecks = [];
let asyncChain = Promise.resolve();

function report(name, ok, detail) {
  if (ok) {
    console.log('PASS: ' + name);
    passed++;
  } else {
    console.log('FAIL: ' + name + (detail ? ' -> ' + detail : ''));
    failed++;
  }
}

function check(name, fn) {
  if (fn.constructor && fn.constructor.name === 'AsyncFunction') {
    asyncChain = asyncChain.then(function () { return fn(); }).then(
      function () { report(name, true); },
      function (err) { report(name, false, err && err.message ? err.message : err); }
    );
    pendingChecks.push(asyncChain);
    return;
  }
  try {
    fn();
    report(name, true);
  } catch (err) {
    report(name, false, err && err.message ? err.message : err);
  }
}

function assertTrue(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error((label || 'value') + ': expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
  }
}

function assertContains(text, substring, message) {
  if (!String(text).includes(substring)) {
    throw new Error((message || '') + ': expected to contain "' + substring + '"');
  }
}

function assertNotContains(text, substring, message) {
  if (String(text).includes(substring)) {
    throw new Error((message || '') + ': expected NOT to contain "' + substring + '"');
  }
}

function readSrc(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

// ---------------------------------------------------------------------------
// A. Required question matrix (FIX 2a)
// ---------------------------------------------------------------------------

const specQuestions = [
  { q: 'palmpyaarella work avvuthundhi', domain: 'OUT_OF_SCOPE', inScope: false, oos: 'product_how_it_works' },
  { q: 'naku entha mandi pillalu pudatharu', domain: 'CHILDREN', inScope: true, min: { CHILDREN: 3 } },
  { q: 'how does palmpyaar work', domain: 'OUT_OF_SCOPE', inScope: false, oos: 'product_how_it_works' },
  { q: 'how many children will i have', domain: 'CHILDREN', inScope: true, min: { CHILDREN: 3 } },
  { q: 'పాల్మ్‌ప్యార్ ఎలా పని చేస్తుంది', domain: 'OUT_OF_SCOPE', inScope: false, oos: 'product_how_it_works' },
  { q: 'నాకు ఎన్ని పిల్లలు పుడతారు', domain: 'CHILDREN', inScope: true, min: { CHILDREN: 3 } },
  { q: 'will i get a job soon', domain: 'CAREER', inScope: true, min: { CAREER: 2 } },
  { q: 'job vachindhala e month lo', domain: 'CAREER', inScope: true, min: { CAREER: 2 } },
  { q: 'will i get a job promotion', domain: 'CAREER', inScope: true, min: { CAREER: 2 } },
  { q: 'when will i get a promotion in my job', domain: 'CAREER', inScope: true, min: { CAREER: 2 } },
  { q: 'career lo naku progress undha', domain: 'CAREER', inScope: true, min: { CAREER: 2 } },
  { q: 'will i get a new job offer', domain: 'CAREER', inScope: true, min: { CAREER: 2 } },
  { q: 'how many kids will i have', domain: 'CHILDREN', inScope: true, min: { CHILDREN: 3 } },
  { q: 'when will i have my first child', domain: 'CHILDREN', inScope: true, min: { CHILDREN: 3 } },
  { q: 'when will i get married', domain: 'MARRIAGE', inScope: true, min: { MARRIAGE: 4 } },
  { q: 'e year lo pelli avuthundha', domain: 'MARRIAGE', inScope: true, min: { MARRIAGE: 4 } },
  { q: 'will my relationship last', domain: 'LOVE', inScope: true, min: { LOVE: 4 } },
  { q: 'will i have financial problems', domain: 'MONEY', inScope: true, min: { MONEY: 2 } }
];

check('A1: all 18 spec questions classify to the expected domain', function () {
  const domainsSeen = {};
  for (const spec of specQuestions) {
    const r = classifyQuestion(spec.q);
    assertEqual(r.domain, spec.domain, 'domain for "' + spec.q + '"');
    assertEqual(r.inScope, spec.inScope, 'inScope for "' + spec.q + '"');
    if (spec.oos) {
      assertEqual(r.outOfScopeKind, spec.oos, 'outOfScopeKind for "' + spec.q + '"');
    }
    if (spec.min) {
      for (const key of Object.keys(spec.min)) {
        const score = (r.scores && r.scores[key]) || 0;
        assertTrue(score >= spec.min[key],
          'score ' + key + '=' + score + ' below ' + spec.min[key] + ' for "' + spec.q + '"');
      }
    }
    domainsSeen[r.domain] = true;
  }
  for (const d of ['CAREER', 'CHILDREN', 'MARRIAGE', 'LOVE', 'MONEY', 'OUT_OF_SCOPE']) {
    assertTrue(domainsSeen[d], 'expected semantic diversity: domain ' + d + ' never seen');
  }
});

check('A2: marriage questions force MARRIAGE priority over other families', function () {
  for (const q of ['when will i get married', 'e year lo pelli avuthundha']) {
    const r = classifyQuestion(q);
    assertEqual(r.domain, 'MARRIAGE', 'forced marriage domain: ' + q);
    assertTrue((r.scores.MARRIAGE || 0) >= 4, 'MARRIAGE score below 4: ' + q);
    assertTrue((r.scores.MARRIAGE || 0) >= (r.scores.LOVE || 0), 'MARRIAGE must not lose to LOVE: ' + q);
  }
});

check('A3: product questions expose product_how_it_works kind for the redirect layer', function () {
  for (const q of ['palmpyaarella work avvuthundhi', 'how does palmpyaar work',
    'పాల్మ్‌ప్యార్ ఎలా పని చేస్తుంది']) {
    const r = classifyQuestion(q);
    assertEqual(r.outOfScopeKind, 'product_how_it_works', 'kind: ' + q);
    assertEqual(r.inScope, false, 'inScope: ' + q);
  }
  const src = readSrc('lib/questionIntent.js');
  assertContains(src, 'looksLikeProductHowItWorks', 'product detector missing');
  assertContains(src, 'PRODUCT_BRAND', 'brand regex missing');
  assertContains(src, 'product_how_it_works', 'product kind missing');
});

// ---------------------------------------------------------------------------
// B. Product redirect copy + gate section 9 (FIX 2b, FIX 2d)
// ---------------------------------------------------------------------------

const oosProductIntent = {
  domain: 'OUT_OF_SCOPE', inScope: false, outOfScopeKind: 'product_how_it_works',
  timing: false, scores: { OUT_OF_SCOPE: 6 }
};

check('B1: English product redirect contract is answer-shaped and brand-safe', function () {
  const reply = contract.outOfScopeReply({ outOfScopeKind: 'product_how_it_works' });
  assertEqual(reply, contract.PRODUCT_HOW_IT_WORKS_REDIRECT, 'outOfScopeReply product branch');
  const words = reply.split(/\s+/).filter(Boolean).length;
  assertTrue(words >= 15 && words <= 110, 'word count outside gate limits: ' + words);
  assertContains(reply, 'PalmPyaar', 'redirect must name the product');
  assertTrue(!/[ఀ-౿]/.test(reply), 'English redirect must stay Latin script');
});

check('B2: every localized productHowItWorks passes gate section 9 clean', function () {
  for (const lang of ['telugu', 'hindi', 'tamil', 'kannada', 'malayalam']) {
    const bundle = templates.getLocalizedBundle(lang);
    assertTrue(bundle && bundle.productHowItWorks, 'missing copy: ' + lang);
    const verdict = gate.evaluate(bundle.productHowItWorks, oosProductIntent, null, lang);
    const banned = ['OUT_OF_SCOPE_NO_REDIRECT', 'OUT_OF_SCOPE_ANSWERED', 'OUT_OF_SCOPE_TOO_LONG',
      'WRONG_LANGUAGE', 'UNSUPPORTED_PALM_CLAIM', 'UNSUPPORTED_SPECIFICITY', 'QUESTION_NOT_ADDRESSED'];
    const bad = verdict.violations.filter(v => banned.indexOf(v) !== -1);
    assertEqual(bad.length, 0, lang + ' product redirect violations: ' + JSON.stringify(verdict.violations));
  }
  const en = gate.evaluate(contract.PRODUCT_HOW_IT_WORKS_REDIRECT, oosProductIntent, null, 'english');
  const badEn = en.violations.filter(v => v.indexOf('OUT_OF_SCOPE') === 0 || v.indexOf('UNSUPPORTED') === 0);
  assertEqual(badEn.length, 0, 'english product redirect: ' + JSON.stringify(en.violations));
});

check('B3: both server paths branch on product_how_it_works', function () {
  const apiSrc = readSrc('api/ask-question.js');
  assertContains(apiSrc, "outOfScopeKind === 'product_how_it_works'", 'ask-question product branch missing');
  assertContains(apiSrc, 'buildRedirectAnswer', 'redirect builder missing');
  const providerSrc = readSrc('providers/groqProvider.js');
  assertContains(providerSrc, "outOfScopeKind === 'product_how_it_works'", 'provider product branch missing');
  assertContains(providerSrc, 'bundle.productHowItWorks', 'provider not using localized product copy');
});

check('B4: scores are threaded from the classifier into the gate intent', function () {
  const apiSrc = readSrc('api/ask-question.js');
  assertContains(apiSrc, 'scores: questionIntentResult.scores', 'scores field missing');
});

// ---------------------------------------------------------------------------
// C. Gate synthetic hard rejections (FIX 2d)
// ---------------------------------------------------------------------------

const filler = 'This answer is long enough to pass the emptiness check with plenty of ordinary words. ';
const baseHtml = '<h4>DIRECT ANSWER</h4><p>' + filler + filler + '</p>';
const careerIntent = { domain: 'CAREER', inScope: true, timing: false, scores: { CAREER: 5 } };

function expectRejection(label, html, intent, language, expectedViolation) {
  const verdict = gate.evaluate(html, intent, null, language);
  assertEqual(verdict.ok, false, label + ' should be rejected');
  assertEqual(verdict.severity, 'hard', label + ' must be hard severity');
  assertTrue(verdict.violations.indexOf(expectedViolation) !== -1,
    label + ' missing ' + expectedViolation + ', got ' + JSON.stringify(verdict.violations));
}

check('C1: invented palm-line claims are rejected in English and Telugu', function () {
  expectRejection('english heart line',
    baseHtml.replace('</p>', ' Your heart line suggests caution in this job change.</p>'),
    careerIntent, 'english', 'UNSUPPORTED_PALM_CLAIM');
  expectRejection('telugu heart line',
    baseHtml.replace('</p>', ' మీ హృదయ రేఖ ప్రకారం ఇది మంచి సమయం.</p>'),
    careerIntent, 'telugu', 'UNSUPPORTED_PALM_CLAIM');
});

check('C2: fixed countdowns, day-level dates and child counts are rejected', function () {
  expectRejection('countdown',
    baseHtml.replace('</p>', ' You will get a job in 3 months.</p>'),
    careerIntent, 'english', 'UNSUPPORTED_SPECIFICITY');
  expectRejection('day date',
    baseHtml.replace('</p>', ' The change arrives on 15 March 2027 for you.</p>'),
    careerIntent, 'english', 'UNSUPPORTED_SPECIFICITY');
  expectRejection('child count',
    baseHtml.replace('</p>', ' You will have 2 children in this marriage.</p>'),
    careerIntent, 'english', 'UNSUPPORTED_SPECIFICITY');
});

check('C3: answers that strongly address a different domain are rejected', function () {
  const yearlyIntent = { domain: 'YEARLY_OUTLOOK', inScope: true, timing: false, scores: {} };
  expectRejection('yearly question, marriage answer',
    '<h4>DIRECT ANSWER</h4><p>When will you get married? The window for marriage opens soon, and partnership is on the cards for you this year with strong support from those around you.</p>',
    yearlyIntent, 'english', 'QUESTION_NOT_ADDRESSED');
});

check('C4: out-of-scope answers that engage astrologically are rejected', function () {
  const oosGeneral = {
    domain: 'OUT_OF_SCOPE', inScope: false, outOfScopeKind: 'general_assistant',
    timing: false, scores: { OUT_OF_SCOPE: 6 }
  };
  expectRejection('astrology engagement',
    baseHtml.replace('</p>', ' Your horoscope and current dasha explain this fully.</p>'),
    oosGeneral, 'english', 'OUT_OF_SCOPE_ANSWERED');
});

check('C5: new violation codes are hard — rejection is never soft', function () {
  const src = readSrc('providers/followupQualityGate.js');
  const m = src.match(/const hard = violations\.filter\(v => \[([\s\S]*?)\]\.indexOf/);
  assertTrue(m, 'hard list not found');
  for (const code of ['QUESTION_NOT_ADDRESSED', 'UNSUPPORTED_PALM_CLAIM', 'UNSUPPORTED_SPECIFICITY']) {
    assertContains(m[1], code, code + ' missing from hard list');
  }
});

// ---------------------------------------------------------------------------
// D. Legitimate answers are not caught by the new checks (FIX 2d)
// ---------------------------------------------------------------------------

check('D1: a normal career answer passes the gate', function () {
  const good = '<h4>DIRECT ANSWER</h4><p>A job change looks supported in the coming stretch; prepare applications now and the effort you put in can pay off. </p>' +
    '<h4>WHY</h4><p>The period favours steady effort and clear conversations with people who matter for your career path.</p>';
  const verdict = gate.evaluate(good, careerIntent, null, null);
  assertTrue(verdict.severity !== 'hard', 'good answer must not be hard-rejected: ' + JSON.stringify(verdict.violations));
  assertEqual(verdict.violations.length, 0, 'good answer should be violation-free');
});

check('D2: asking and answering the same domain never flags question-not-addressed', function () {
  const marriageIntent = { domain: 'MARRIAGE', inScope: true, timing: false, scores: { MARRIAGE: 10 } };
  const answer = '<h4>DIRECT ANSWER</h4><p>' + filler + filler + '</p>';
  const verdict = gate.evaluate(answer, marriageIntent, null, 'english');
  assertTrue(verdict.violations.indexOf('QUESTION_NOT_ADDRESSED') === -1,
    'false QUESTION_NOT_ADDRESSED: ' + JSON.stringify(verdict.violations));
});

check('D3: bare years and year ranges (timingEngine window format) are allowed', function () {
  const answer = '<h4>DIRECT ANSWER</h4><p>The strongest stretch lands around 2026-2028, with 2027 carrying the clearest support for your question about work and effort.</p>';
  const verdict = gate.evaluate(answer, careerIntent, null, 'english');
  assertTrue(verdict.violations.indexOf('UNSUPPORTED_SPECIFICITY') === -1,
    'year range wrongly flagged: ' + JSON.stringify(verdict.violations));
});

// ---------------------------------------------------------------------------
// E. Attempt-2 prompt feedback (FIX 2c) with stubbed OpenAI SDK
// ---------------------------------------------------------------------------

const FAKE_ANSWER = '<h4 class="answer-label">DIRECT ANSWER</h4>\n' +
  '<p class="reading-paragraph">The period favours steady effort, and the support you need is already around you.</p>';

let capturedPrompts = [];

function FakeOpenAI() {
  this.chat = {
    completions: {
      create: async function (request) {
        capturedPrompts.push(request.messages[0].content);
        return {
          choices: [{ message: { content: FAKE_ANSWER }, finish_reason: 'stop' }],
          usage: { completion_tokens: 120 }
        };
      }
    }
  };
}

const Module = require('module');
const openaiPath = require.resolve('openai');
const stubModule = new Module(openaiPath, module);
stubModule.filename = openaiPath;
stubModule.loaded = true;
stubModule.exports = FakeOpenAI;
require.cache[openaiPath] = stubModule;
delete require.cache[require.resolve(path.join(ROOT, 'providers', 'groqProvider.js'))];
const groqProvider = require(path.join(ROOT, 'providers', 'groqProvider.js'));

function validGeometryEvidence() {
  return {
    palmBounds: { width: 0.3, height: 0.4, aspectRatio: 0.75 },
    fingerRatios: { index: 0.9, middle: 0.9, ring: 0.9, pinky: 0.9, thumb: 0.8 },
    geometricRatios: { indexToMiddle: 1.0, fingerSpanToHeight: 2.0, thumbToIndex: 1.5 },
    palmAngle: 12
  };
}

check('E1: attempt 2 passes rejection reasons into the prompt', async function () {
  const result = await groqProvider.generateAnswer({
    question: 'will i get a job soon',
    questionIntent: { domain: 'CAREER', timing: true, adult: false, evaluation: false, inScope: true, scores: { CAREER: 7 } },
    timingContext: null,
    tradition: 'western',
    detectedLanguage: 'english',
    palmEvidence: validGeometryEvidence(),
    previousRejection: 'UNSUPPORTED_SPECIFICITY, JARGON_DUMP'
  });
  assertEqual(capturedPrompts.length, 1, 'completion not issued');
  const prompt = capturedPrompts[0];
  assertContains(prompt, '=== PREVIOUS ATTEMPT WAS REJECTED BECAUSE: UNSUPPORTED_SPECIFICITY, JARGON_DUMP ===');
  assertContains(prompt, 'do not repeat');
  assertEqual(result.answer.trim(), FAKE_ANSWER.trim(), 'answer passthrough');
});

check('E2: attempt 1 carries no rejection feedback', async function () {
  const before = capturedPrompts.length;
  await groqProvider.generateAnswer({
    question: 'will i get a job soon',
    questionIntent: { domain: 'CAREER', timing: false, adult: false, evaluation: false, inScope: true, scores: { CAREER: 7 } },
    timingContext: null,
    tradition: 'western',
    detectedLanguage: 'english'
  });
  assertEqual(capturedPrompts.length, before + 1, 'second completion not issued');
  assertNotContains(capturedPrompts[before], 'PREVIOUS ATTEMPT WAS REJECTED');
});

check('E3: every prompt carries the GROUNDING contract and count cues', async function () {
  const prompt = capturedPrompts[0];
  assertContains(prompt, '=== GROUNDING ===');
  assertContains(prompt, 'how many');
  assertContains(prompt, 'ఎన్ని');
  assertContains(prompt, 'entha mandi');
  assertContains(prompt, 'Never invent chart placements');
  assertContains(prompt, 'Never claim to observe palm lines');
});

check('E4: valid palm evidence is threaded as geometry; invalid evidence is not', async function () {
  const geomPrompt = capturedPrompts[0];
  assertContains(geomPrompt, 'PALM GEOMETRY EVIDENCE');

  await groqProvider.generateAnswer({
    question: 'will i get a job soon',
    questionIntent: { domain: 'CAREER', timing: false, adult: false, evaluation: false, inScope: true, scores: { CAREER: 7 } },
    timingContext: null,
    tradition: 'western',
    detectedLanguage: 'english',
    palmEvidence: { bogus: true }
  });
  const noGeomPrompt = capturedPrompts[capturedPrompts.length - 1];
  assertNotContains(noGeomPrompt, 'PALM GEOMETRY EVIDENCE');
});

check('E5: localized answers receive the language rule block', async function () {
  await groqProvider.generateAnswer({
    question: 'job vachindhala e month lo',
    questionIntent: { domain: 'CAREER', timing: true, adult: false, evaluation: false, inScope: true, scores: { CAREER: 2 } },
    timingContext: null,
    tradition: 'western',
    detectedLanguage: 'telugu'
  });
  const prompt = capturedPrompts[capturedPrompts.length - 1];
  assertContains(prompt, '=== ANSWER LANGUAGE ===');
});

check('E6: provider serves the localized product redirect without any model call', async function () {
  const before = capturedPrompts.length;
  const result = await groqProvider.generateAnswer({
    question: 'పాల్మ్‌ప్యార్ ఎలా పని చేస్తుంది',
    questionIntent: { domain: 'OUT_OF_SCOPE', inScope: false, outOfScopeKind: 'product_how_it_works' },
    detectedLanguage: 'telugu'
  });
  assertEqual(capturedPrompts.length, before, 'model call must not happen for OOS');
  assertContains(result.answer, 'DIRECT ANSWER');
  assertTrue(/[ఀ-౿]/.test(result.answer), 'telugu product redirect not localized');

  const enResult = await groqProvider.generateAnswer({
    question: 'how does palmpyaar work',
    questionIntent: { domain: 'OUT_OF_SCOPE', inScope: false, outOfScopeKind: 'product_how_it_works' },
    detectedLanguage: 'english'
  });
  assertContains(enResult.answer, 'PalmPyaar');
});

// ---------------------------------------------------------------------------
// F. Regeneration wiring in api/ask-question (FIX 2c)
// ---------------------------------------------------------------------------

check('F1: exactly two attempts, reasons joined into attempt-2 feedback', function () {
  const src = readSrc('api/ask-question.js');
  assertContains(src, 'MAX_AI_ATTEMPTS = 2', 'attempt cap missing');
  assertContains(src, 'previousRejection = reasons.join(', 'reasons not joined');
  assertContains(src, 'Object.assign({}, params, { previousRejection: previousRejection })',
    'attempt-2 params not threaded');
});

check('F2: gate is called with four arguments (answer, intent, timing, language)', function () {
  const src = readSrc('api/ask-question.js');
  const re = /followupQualityGate\.evaluate\(\s*aiAnswer,\s*params\.questionIntent,\s*params\.timingContext,\s*gateLanguage\s*\)/;
  assertTrue(re.test(src), 'gate call site restructured');
});

check('F3: template fallback runs after the loop (rejected AI never ships)', function () {
  const src = readSrc('api/ask-question.js');
  assertContains(src, 'attempt <= MAX_AI_ATTEMPTS', 'attempt loop missing');
  assertContains(src, 'Re-validate the fallback', 'no template re-validation after the loop');
});

check('F4: gate exposes the new checks and the localized brand regex', function () {
  const src = readSrc('providers/followupQualityGate.js');
  assertContains(src, "require('../lib/questionIntent')", 'gate must classify the answer text');
  assertContains(src, 'QUESTION_NOT_ADDRESSED', 'question-not-addressed check missing');
  assertContains(src, 'UNSUPPORTED_PALM_CLAIM', 'palm-claim check missing');
  assertContains(src, 'UNSUPPORTED_SPECIFICITY', 'specificity check missing');
  assertContains(src, 'isProductRedirect && /\\bpalmpyaar\\b/i', 'product englishRedirect extension missing');
  assertContains(src, 'പാൽമ്പ്യാർ', 'malayalam brand spelling alternate missing');
});

// ---------------------------------------------------------------------------
// Summary — printed only after every async check has settled.
// ---------------------------------------------------------------------------

Promise.all(pendingChecks).then(function () {
  console.log('\n=== FIX 2: ANSWER GROUNDING TEST SUMMARY ===');
  console.log('Spec questions exercised: ' + specQuestions.length);
  console.log('Passed: ' + passed);
  console.log('Failed: ' + failed);
  console.log('Total: ' + (passed + failed));
  process.exit(failed === 0 ? 0 : 1);
});
