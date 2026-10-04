/*
 * Follow-up intent + answer-quality suite.
 *
 * Covers the PalmPyaar answering contract for unpredictable customer wording:
 *
 *   - Semantic intent classification across every reading domain, including
 *     phrasings that the old keyword classifier could not resolve at all
 *     ("Is this year nice to me?").
 *   - Structure adapts to the question instead of forcing one template.
 *   - The answer opens by answering the actual question.
 *   - Adult / intimacy questions are answered naturally, not refused.
 *   - Out-of-scope questions are redirected; the AI model/provider is never
 *     disclosed.
 *   - No guaranteed predictions, no jargon dump, no fabricated evidence.
 *   - Timing appears only when the customer asked about time AND the timing
 *     engine actually derived a window.
 *   - The deterministic quality gate rejects non-compliant answers.
 *
 * Runs with AI_READING=false so it exercises the deterministic path that also
 * serves as the safe fallback for the AI path. No network, no secrets.
 */
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const askQuestion = require('../api/ask-question');
const questionToken = require('../lib/questionToken');
const questionIntent = require('../lib/questionIntent');
const answerContract = require('../providers/answerContract');
const gate = require('../providers/followupQualityGate');
const timingEngine = require('../lib/timingEngine');

process.env.TOKEN_SECRET = 'intent-quality-test-secret';
process.env.AI_READING = 'false';
process.env.NODE_ENV = 'development';
process.env.DEV_BYPASS = 'true';

const base = {
  name: 'Ananya',
  dob: '1994-05-15',
  birthTime: '10:30',
  birthplace: 'Mumbai',
  tradition: 'western',
  photoHash: 'a'.repeat(64),
  palmEvidence: null,
  orderId: 'order_intent_quality_test'
};

function readingTokenFor(data) {
  const palmEvidenceStr = data.palmEvidence ? JSON.stringify(data.palmEvidence) : '';
  return crypto.createHmac('sha256', process.env.TOKEN_SECRET).update([
    data.name, data.dob, data.birthTime, data.birthplace,
    data.tradition, data.photoHash, palmEvidenceStr, data.orderId
  ].join(':')).digest('hex');
}

function createMockRes() {
  return {
    statusCode: 200, headers: {}, body: null,
    setHeader(n, v) { this.headers[n] = v; },
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; }
  };
}

async function post(question, overrides = {}) {
  const data = { ...base, ...overrides };
  const readingToken = readingTokenFor(data);
  const qToken = questionToken.createInitialToken(readingToken, process.env.TOKEN_SECRET, data);
  const res = createMockRes();
  await askQuestion({ method: 'POST', body: { ...data, question, questionToken: qToken, readingToken } }, res);
  assert.strictEqual(res.statusCode, 200, question + ' -> HTTP ' + res.statusCode);
  return res.body;
}

function strip(html) {
  return gate.stripHtml(html);
}

function labels(answer) {
  return (String(answer).match(/<h4 class="answer-label">([^<]*)<\/h4>/g) || [])
    .map(m => m.replace(/<[^>]+>/g, '').trim());
}

/* ------------------------------------------------------------------ */
/* 1. Intent classification across every domain and phrasing style.      */
/* ------------------------------------------------------------------ */

const INTENT_CASES = [
  // -- yearly outlook: the class of question the old classifier could not do
  { q: 'Is this year nice to me?', domain: 'YEARLY_OUTLOOK', topic: 'general' },
  { q: 'Is this year good for me?', domain: 'YEARLY_OUTLOOK' },
  { q: 'Will this year treat me well?', domain: 'YEARLY_OUTLOOK' },
  { q: 'Do I have a good year ahead?', domain: 'YEARLY_OUTLOOK' },
  { q: 'Will 2026 be lucky for me?', domain: 'YEARLY_OUTLOOK' },
  { q: 'Am I entering a better phase?', domain: 'YEARLY_OUTLOOK' },
  { q: 'What period of my life looks strongest?', domain: 'YEARLY_OUTLOOK' },
  // -- career
  { q: 'Will my career improve?', domain: 'CAREER', topic: 'career/job' },
  { q: 'Will I get a better job?', domain: 'CAREER' },
  { q: 'When will I get a job?', domain: 'CAREER' },
  { q: 'Am I likely to change jobs?', domain: 'CAREER' },
  { q: 'Is my career going anywhere?', domain: 'CAREER' },
  // -- money
  { q: 'Is money going to improve?', domain: 'MONEY', topic: 'money' },
  // -- education
  { q: 'Should I focus on education?', domain: 'EDUCATION', topic: 'education' },
  // -- love / relationships
  { q: 'When will my love life become active?', domain: 'LOVE' },
  { q: 'Will I meet someone?', domain: 'LOVE' },
  { q: 'Will I have a serious relationship?', domain: 'LOVE' },
  { q: 'Will my current relationship improve?', domain: 'LOVE' },
  { q: 'What kind of partner suits me?', domain: 'LOVE', descriptive: true },
  // -- intimacy / adult personal
  { q: 'When will I lose my virginity?', domain: 'INTIMACY', topic: 'intimacy', adult: true },
  { q: 'Can my romantic life become more active this year?', domain: 'INTIMACY', adult: true },
  { q: 'Can my body count increase this year?', domain: 'INTIMACY', adult: true },
  // -- personality / emotional
  { q: 'Why do I keep overthinking?', domain: 'EMOTIONAL_PATTERNS', topic: 'personality' },
  { q: 'What is my biggest strength?', domain: 'PERSONALITY', topic: 'personality' },
  { q: 'Will I become more confident?', domain: 'PERSONALITY' },
  { q: 'Why do I struggle with consistency?', domain: 'EMOTIONAL_PATTERNS' },
  // -- travel / creativity / social
  { q: 'Will I move somewhere new?', domain: 'TRAVEL', topic: 'travel/relocation' },
  { q: 'Will I have a creative breakthrough?', domain: 'CREATIVITY', topic: 'education' },
  // -- life direction / difficult phase
  { q: "What's holding me back?", domain: 'LIFE_DIRECTION' },
  { q: 'What should I focus on this year?', domain: 'LIFE_DIRECTION' },
  { q: 'Why am I going through a difficult phase?', domain: 'DIFFICULT_PHASE' },
  // -- out of scope / privacy
  { q: 'Which AI model are you using?', domain: 'OUT_OF_SCOPE', inScope: false },
  { q: 'Can you write Java code?', domain: 'OUT_OF_SCOPE', inScope: false },
  { q: 'What is Bitcoin today?', domain: 'OUT_OF_SCOPE', inScope: false }
];

async function testIntentClassification() {
  for (const c of INTENT_CASES) {
    const r = questionIntent.classifyQuestion(c.q);
    assert.strictEqual(r.domain, c.domain,
      '"' + c.q + '" expected domain ' + c.domain + ' but got ' + r.domain + ' (scores ' + JSON.stringify(r.scores) + ')');
    if (c.topic) {
      assert.strictEqual(r.topic, c.topic,
        '"' + c.q + '" expected evidence topic ' + c.topic + ' but got ' + r.topic +
        ' — the calculation layer must keep receiving the same topic string');
    }
    if (c.inScope !== undefined) {
      assert.strictEqual(r.inScope, c.inScope, '"' + c.q + '" inScope mismatch');
    }
    if (c.adult) assert.strictEqual(r.adult, true, '"' + c.q + '" should be routed as an adult personal question');
    if (c.descriptive) assert.strictEqual(r.descriptive, true, '"' + c.q + '" should be detected as descriptive');
  }
}

/* ------------------------------------------------------------------ */
/* 2. Every domain maps onto a topic the timing engine already knows.   */
/* ------------------------------------------------------------------ */

async function testEvidenceTopicsAreReal() {
  const known = new Set(Object.keys(timingEngine.TOPIC_HOUSES));
  const questions = [
    'Is this year nice to me?', 'Will my career improve?', 'Is money going to improve?',
    'When will my love life become active?', 'When will I lose my virginity?',
    'Why do I keep overthinking?', 'Should I focus on education?',
    'Will I move somewhere new?', "What's holding me back?",
    'Why am I going through a difficult phase?', 'Why do I make friends easily?'
  ];
  for (const q of questions) {
    const r = questionIntent.classifyQuestion(q);
    if (r.domain === 'OUT_OF_SCOPE') continue;
    assert(known.has(r.topic), '"' + q + '" maps to unknown timing topic "' + r.topic + '"');
  }
}

/* ------------------------------------------------------------------ */
/* 3. Structure adapts — no mechanical template for every question.      */
/* ------------------------------------------------------------------ */

async function testStructureAdapts() {
  const yearly = await post('Is this year nice to me?');
  const personality = await post('What is my biggest strength?');
  const partner = await post('What kind of partner suits me?');

  const yearlyLabels = labels(yearly.answer);
  const personalityLabels = labels(personality.answer);

  assert(yearlyLabels.includes('WHAT THIS PERIOD FAVORS'),
    'a yearly-outlook question should offer value even when the period is mixed');
  assert(personalityLabels.includes('WHAT THIS SAYS ABOUT YOU'),
    'a personality question should be answered in personality terms');
  assert(!personalityLabels.some(l => /PERIOD FAVORS|ASKS OF YOU/.test(l)),
    'a personality question must not receive a yearly-period template: ' + JSON.stringify(personalityLabels));
  assert(!/WINDOW/.test(personality.answer),
    'a non-timing question must not include a timing window');
  assert(!/WINDOW/.test(partner.answer),
    'a "what kind of partner" question is qualitative and must not get a timing window');

  // The two must not be structurally identical — that is the old bug.
  assert.notStrictEqual(yearlyLabels.join('|'), personalityLabels.join('|'),
    'different intents must not produce an identical section structure');
}

/* ------------------------------------------------------------------ */
/* 4. The answer opens by answering the actual question.                */
/* ------------------------------------------------------------------ */

async function testDirectAnswerFirst() {
  const cases = [
    { q: 'Is this year nice to me?', mustNotStart: /does not show|is not (a|your) year|particularly distinctive/i },
    { q: 'Why do I keep overthinking?', expect: /pattern/i },
    { q: 'What kind of partner suits me?', expect: /partner/i },
    { q: 'When will I lose my virginity?', expect: /romantic|intimac|closeness|open/i }
  ];
  for (const c of cases) {
    const body = await post(c.q);
    const first = gate.firstSection(body.answer);
    assert(first && first.length > 40, c.q + ' should open with a substantive direct answer');
    assert(gate.countJargon(first) < 2, c.q + ' should not open with a jargon dump');
    if (c.expect) assert(c.expect.test(first), c.q + ' direct answer should mention ' + c.expect + ' — got: ' + first);
    if (c.mustNotStart) assert(!c.mustNotStart.test(first),
      c.q + ' must not open by dismissing the question — got: ' + first);
  }
}

/* ------------------------------------------------------------------ */
/* 5. Quality contract on every produced answer.                        */
/* ------------------------------------------------------------------ */

const ALL_PROBE_QUESTIONS = INTENT_CASES.map(c => c.q);

const { calculateChart } = require('../lib/astrologyProvider');

async function testAnswersMeetContract() {
  // Mirror production: the handler derives timing from a real chart, so the
  // expected window state must be computed the same way here.
  const chart = calculateChart(base.dob, base.birthTime, base.birthplace, base.tradition);
  for (const q of ALL_PROBE_QUESTIONS) {
    const body = await post(q);
    const text = strip(body.answer);
    const intent = questionIntent.classifyQuestion(q);
    const timing = intent.domain === 'NAME_MEANING'
      ? { supported: false }
      : timingEngine.deriveTimingWindow({
        astrologyData: chart, tradition: base.tradition, dob: base.dob, intent
      });

    assert(/DIRECT ANSWER/i.test(body.answer), q + ' must include a DIRECT ANSWER section');
    assert(!/\bguaranteed\b/i.test(text), q + ' must not guarantee an outcome');
    assert(!/\byou will (definitely |certainly )?(meet|marry|get married|lose your virginity|get a job|become pregnant)\b/i.test(text),
      q + ' must not make a guaranteed prediction');
    assert(!/\b(gpt|openai|llm|chatgpt|language model|ai model|gemini|claude|groq)\b/i.test(text),
      q + ' must not disclose the model or provider');
    assert(!/\b(system prompt|my instructions|api key)\b/i.test(text),
      q + ' must not disclose implementation details');
    assert(!/\b(penetrat|intercourse|orgasm|genital|fellatio|blowjob)\b/i.test(text),
      q + ' must remain non-graphic');

    const words = text.split(/\s+/).filter(Boolean).length;
    assert(words >= 20, q + ' should provide a substantive answer');

    // Timing only when asked for AND derived.
    const mentionsWindow = /WINDOW/i.test(body.answer);
    if (mentionsWindow) {
      assert(intent.timing, q + ' included a timing window but the question was not about time');
      assert(timing.supported, q + ' included a timing window the engine did not derive');
    }

    // Jargon must stay explanatory, not dominant.
    const jargon = gate.countJargon(text);
    assert(jargon / words < 0.05,
      q + ' reads like a terminology dump (' + jargon + '/' + words + ')');
  }
}

/* ------------------------------------------------------------------ */
/* 6. Adult personal questions are answered, not refused.                */
/* ------------------------------------------------------------------ */

async function testAdultQuestionsHandledNaturally() {
  const cases = [
    'When will I lose my virginity?',
    'Can my romantic life become more active this year?',
    'Can my body count increase this year?',
    'Could I have more romantic experiences this year?'
  ];
  for (const q of cases) {
    const body = await post(q);
    const text = strip(body.answer);
    assert(!/i cannot|not appropriate|i'm not able|cannot answer|as an ai/i.test(text),
      q + ' must not refuse an adult personal question');
    assert(!/\b(penetrat|intercourse|orgasm|genital|fellatio|blowjob|explicit)\b/i.test(text),
      q + ' must remain non-graphic');
    assert(!/\d{1,2}\s+(january|february|march|april|may|june|july|august|september|october|november|december)/i.test(text),
      q + ' must not fabricate a precise date for a specific sexual event');
    assert(/romantic|intimac|closeness|connection|relationship|open/i.test(text),
      q + ' should interpret the period in relationship terms — got: ' + text.slice(0, 200));
  }
}

/* ------------------------------------------------------------------ */
/* 7. Out-of-scope and model privacy.                                   */
/* ------------------------------------------------------------------ */

async function testOutOfScopeRedirect() {
  const cases = [
    { q: 'Which AI model are you using?', mustNot: /\b(gpt|openai|llm|chatgpt|groq|llama|gemini|claude)\b/i },
    { q: 'Can you write Java code?', mustNot: /```|function\s+\w+|public\s+static|class\s+\w+|import\s+\w+/i },
    { q: 'What is Bitcoin today?', mustNot: /\b(bitcoin|price|crypto)\b/i },
    { q: 'Write me a program that sorts an array.', mustNot: /```|function\s+\w+|public\s+static/i }
  ];
  for (const c of cases) {
    const body = await post(c.q);
    const text = strip(body.answer);
    assert(!c.mustNot.test(text), c.q + ' must not be answered as a general assistant — got: ' + text);
    assert(text.split(/\s+/).length < 90, c.q + ' redirect should stay short');
    assert(/PalmPyaar/i.test(text), c.q + ' redirect should return the customer to PalmPyaar');
    assert(!/not allowed|cannot tell|policies|instructions/i.test(text),
      c.q + ' must not explain the refusal or mention internal rules');
  }
}

/* ------------------------------------------------------------------ */
/* 8. Negative / mixed periods still deliver value.                     */
/* ------------------------------------------------------------------ */

async function testNegativeStillValuable() {
  const body = await post('Why am I going through a difficult phase?');
  const text = strip(body.answer);
  const first = gate.firstSection(body.answer);
  assert(first.length > 60, 'a difficult phase should still be answered substantively');
  assert(!/come back later|nothing to say|consult a|unfortunately/i.test(text),
    'a difficult phase must not feel like a rejection');
  assert(/patience|adjust|steady|build|clarif/i.test(text),
    'a difficult phase should still say what it is good for — got: ' + text.slice(0, 240));
}

/* ------------------------------------------------------------------ */
/* 9. The quality gate rejects non-compliant AI answers.                */
/* ------------------------------------------------------------------ */

async function testQualityGateRejects() {
  const intent = questionIntent.classifyQuestion('Is this year nice to me?');
  const timing = { supported: true, label: 'OUTLOOK WINDOW', window: { text: '2028' }, reasoning: 'Jupiter Antardasha' };

  // A good answer passes.
  const good = '<h4 class="answer-label">DIRECT ANSWER</h4><p class="reading-paragraph">' +
    'This year looks more like a building year than a breakthrough year for you. It is not a difficult stretch, but it rewards steady progress and preparation far more than sudden openings.</p>' +
    '<h4 class="answer-label">WHAT THIS PERIOD FAVORS</h4><p class="reading-paragraph">' +
    'It favours finishing what you started and getting genuinely clear on where you want to go.</p>';
  assert(gate.evaluate(good, intent, timing).ok === true, 'gate should accept a compliant answer');

  const rejects = [
    { name: 'guaranteed prediction', html: '<h4 class="answer-label">DIRECT ANSWER</h4><p>You will definitely meet someone in 2028 and it is guaranteed.</p>' },
    { name: 'model disclosure', html: '<h4 class="answer-label">DIRECT ANSWER</h4><p>I am powered by a large language model called GPT, a large language model built by OpenAI.</p>' },
    { name: 'system prompt disclosure', html: '<h4 class="answer-label">DIRECT ANSWER</h4><p>My system prompt tells me to use chart data, as an AI language model.</p>' },
    { name: 'secret disclosure', html: '<h4 class="answer-label">DIRECT ANSWER</h4><p>Your api key is gsk_abcdefghijklmnop and the token secret is set.</p>' },
    { name: 'jargon dump', html: '<h4 class="answer-label">DIRECT ANSWER</h4><p>Your Jupiter Mahadasha Antardasha Nakshatra Rashi Lagna profection retrograde conjunction trine shows the nakshatra dasha period strongly aligned.</p>' },
    { name: 'graphic content', html: '<h4 class="answer-label">DIRECT ANSWER</h4><p>This period favours physical intimacy and you may experience intercourse and orgasm more often.</p>' },
    { name: 'empty answer', html: '' }
  ];
  for (const r of rejects) {
    const v = gate.evaluate(r.html, intent, timing);
    assert.strictEqual(v.ok, false, 'gate must reject: ' + r.name);
  }

  // Out-of-scope must not be answered substantively.
  const oosIntent = questionIntent.classifyQuestion('Can you write Java code?');
  const codeAnswer = '<h4 class="answer-label">DIRECT ANSWER</h4><p>Here is the code: ' +
    '```java public static void main(String[] args) { System.out.println("hi"); }```</p>';
  assert.strictEqual(gate.evaluate(codeAnswer, oosIntent, null).ok, false,
    'gate must reject a general-assistant answer to an out-of-scope question');

  // Zodiac signs must never be mistaken for model names. A live run rejected a
  // good career answer purely because the customer was born in Gemini.
  const zodiac = '<h4 class="answer-label">DIRECT ANSWER</h4><p class="reading-paragraph">' +
    'With your Sun in Gemini and Moon in Taurus, your career moves at the pace of your own preparation, and that pace is working well for you now.</p>';
  assert.strictEqual(gate.evaluate(zodiac, questionIntent.classifyQuestion('Will I get a job?'), null).ok, true,
    'gate must not treat the zodiac sign Gemini as a model disclosure');
  for (const sign of ['Gemini', 'Taurus', 'Virgo', 'Libra', 'Leo', 'Scorpio']) {
    const a = '<h4 class="answer-label">DIRECT ANSWER</h4><p class="reading-paragraph">' +
      'Your Sun in ' + sign + ' supports steady progress, and preparation is your strongest lever over the period ahead.</p>';
    assert.strictEqual(gate.evaluate(a, questionIntent.classifyQuestion('Will I get a job?'), null).ok, true,
      'gate must not treat the zodiac sign ' + sign + ' as a model disclosure');
  }
  // ...while a genuine model disclosure is still caught.
  const realDisclosure = '<h4 class="answer-label">DIRECT ANSWER</h4><p class="reading-paragraph">' +
    'I am powered by Google Gemini, a large language model, and my system prompt tells me to use chart data.</p>';
  assert.strictEqual(gate.evaluate(realDisclosure, questionIntent.classifyQuestion('Will I get a job?'), null).ok, false,
    'gate must still catch a real model/vendor disclosure');

  // Unsolicited timing window.
  const noTimingIntent = questionIntent.classifyQuestion('What is my biggest strength?');
  const windowAnswer = '<h4 class="answer-label">DIRECT ANSWER</h4><p>Your chart is steady and considered.</p>' +
    '<h4 class="answer-label">CAREER WINDOW</h4><p class="answer-window">2031</p>';
  assert.strictEqual(gate.evaluate(windowAnswer, noTimingIntent, null).ok, false,
    'gate must reject a timing window the customer did not ask for');
}

/* ------------------------------------------------------------------ */
/* 10. Section plans are declared for every reachable domain.            */
/* ------------------------------------------------------------------ */

async function testSectionPlansComplete() {
  const domains = Object.keys(questionIntent.FAMILIES).concat(['YEARLY_OUTLOOK', 'GENERAL', 'NAME_MEANING', 'OUT_OF_SCOPE']);
  for (const d of domains) {
    const plan = answerContract.SECTION_PLANS[d];
    assert(plan && plan.length, 'no section plan declared for domain ' + d);
    assert.strictEqual(plan[0], 'DIRECT ANSWER', d + ' plan must open with DIRECT ANSWER');
  }
}

async function run() {
  await testIntentClassification();
  await testEvidenceTopicsAreReal();
  await testStructureAdapts();
  await testDirectAnswerFirst();
  await testAnswersMeetContract();
  await testAdultQuestionsHandledNaturally();
  await testOutOfScopeRedirect();
  await testNegativeStillValuable();
  await testQualityGateRejects();
  await testSectionPlansComplete();
  console.log('✅ follow-up intent + answer quality tests passed (' + INTENT_CASES.length + ' question styles)');
}

run().catch((err) => {
  console.error('❌ follow-up intent + answer quality tests failed');
  console.error(err && err.message ? err.message : err);
  console.error(err && err.stack ? err.stack : '');
  process.exit(1);
});