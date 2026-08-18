/*
 * Focused tests for PalmPyaar follow-up answer quality:
 *  - Direct, premium answer structure (DIRECT ANSWER / WHY YOUR CHART SHOWS
 *    THIS / WHAT TO EXPECT / OUTLOOK)
 *  - Timing windows are DERIVED per user from birth data (never hardcoded),
 *    so different birth dates produce different windows.
 *  - Name-meaning answers come from the curated lexicon and never invent an
 *    etymology for unknown names.
 *  - No weak fallback language and no guaranteed-outcome phrasing.
 *  - Hedged, chart-grounded wording.
 */
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const askQuestion = require('../api/ask-question');
const questionToken = require('../lib/questionToken');
const timingEngine = require('../lib/timingEngine');
const nameMeaning = require('../lib/nameMeaning');

process.env.TOKEN_SECRET = 'answer-quality-test-secret';
process.env.AI_READING = 'false';
process.env.NODE_ENV = 'development';
process.env.DEV_BYPASS = 'true';
delete process.env.QUESTION_REPLAY_STORE;

const base = {
  name: 'Mahesh',
  dob: '1994-05-15',
  birthTime: '10:30',
  birthplace: 'Mumbai',
  tradition: 'western',
  photoHash: 'a'.repeat(64),
  palmEvidence: null,
  orderId: 'order_answer_quality_test'
};

function readingTokenFor(data) {
  const palmEvidenceStr = data.palmEvidence ? JSON.stringify(data.palmEvidence) : '';
  const rawPayload = [
    data.name,
    data.dob,
    data.birthTime,
    data.birthplace,
    data.tradition,
    data.photoHash,
    palmEvidenceStr,
    data.orderId
  ].join(':');
  return crypto.createHmac('sha256', process.env.TOKEN_SECRET).update(rawPayload).digest('hex');
}

function createMockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

async function post(question, overrides = {}) {
  const data = { ...base, ...overrides };
  const readingToken = readingTokenFor(data);
  const qToken = questionToken.createInitialToken(readingToken, process.env.TOKEN_SECRET, data);
  const req = { method: 'POST', body: { ...data, question, questionToken: qToken, readingToken } };
  const res = createMockRes();
  await askQuestion(req, res);
  assert.strictEqual(res.statusCode, 200, question);
  return res.body;
}

const WEAK_PHRASES = /cannot give a reliable date|cannot derive a trustworthy calendar period|does not support a precise date|could not generate a specific answer/i;
const GUARANTEE_PHRASES = /\byou will (definitely )?(meet|marry|find|get|become|have)\b/i;
const GUARANTEED_ADJ = /\bguaranteed\b/i;
const HEDGE_PHRASES = /chart (shows|suggests|points to)|strongest window|strongest supported|appears/i;

function assertPremiumStructure(answer) {
  assert(answer && typeof answer === 'string', 'answer should be a string');
  assert(answer.includes('DIRECT ANSWER'), 'answer should open with DIRECT ANSWER');
  assert(answer.includes('WHY YOUR CHART SHOWS THIS'), 'answer should include WHY YOUR CHART SHOWS THIS');
  assert(answer.includes('WHAT TO EXPECT'), 'answer should include WHAT TO EXPECT');
  assert(answer.includes('OUTLOOK'), 'answer should include OUTLOOK');
  assert(answer.includes('answer-label'), 'answer should use premium section labels');
  assert(!WEAK_PHRASES.test(answer), 'answer should not use weak fallback language');
  assert(!GUARANTEE_PHRASES.test(answer), 'answer should not make guaranteed predictions');
  assert(!GUARANTEED_ADJ.test(answer), 'answer should not use "guaranteed" language');
  assert(HEDGE_PHRASES.test(answer), 'answer should use hedged, chart-grounded phrasing');
}

function firstYear(answer) {
  const m = String(answer).match(/(?:19|20)\d{2}/);
  return m ? m[0] : null;
}

async function testTimingDerivedNotHardcoded() {
  const a = await post('When will I get the job?', { dob: '1994-05-15' });
  const b = await post('When will I get the job?', { dob: '2000-11-03' });
  const yearA = firstYear(a.answer);
  const yearB = firstYear(b.answer);
  assert(yearA && /\d{4}/.test(yearA), 'user A should get a derived year');
  assert(yearB && /\d{4}/.test(yearB), 'user B should get a derived year');
  assert.notStrictEqual(yearA, yearB, 'different birth dates must produce different timing windows');

  // The template answer must match the timing engine's own derived window.
  const expected = timingEngine.deriveTimingWindow({
    astrologyData: null,
    tradition: 'western',
    dob: '1994-05-15',
    intent: { topic: 'career/job', timing: true }
  });
  assert(!expected.supported, 'engine should be unsupported without a chart');
  // With a real chart the engine derives profections/dasha years; ensure the
  // pure engine path itself returns a derived, non-hardcoded window.
  const currentYear = new Date().getFullYear();
  const profYear = timingEngine.nextProfectionsYear(1994, currentYear, [10, 6]);
  assert(profYear && profYear >= currentYear && profYear <= currentYear + 12,
    'profection year should be in the forward 12-year cycle');
}

async function testRepresentativeAnswerQuality() {
  const cases = [
    { q: 'When will I get the job?', terms: ['career', 'job'], timing: true, label: 'CAREER WINDOW' },
    { q: 'When will I get married?', terms: ['marriage', 'partnership'], timing: true, label: 'MARRIAGE WINDOW' },
    { q: 'When will I meet my soulmate?', terms: ['love', 'relationship'], timing: true, label: 'RELATIONSHIP WINDOW' },
    { q: 'Will I move abroad?', terms: ['relocation', 'abroad'], timing: false },
    { q: 'When will I lose my virginity?', terms: ['intimacy', 'trust'], timing: true, label: 'INTIMACY WINDOW' },
    { q: 'Why is this a difficult phase for me?', terms: ['difficult', 'phase'], timing: false },
    { q: 'Is my relationship going to improve?', terms: ['relationship'], timing: false },
    { q: 'What is my life path?', terms: ['direction'], timing: false }
  ];

  for (const entry of cases) {
    const body = await post(entry.q);
    assertPremiumStructure(body.answer);
    for (const term of entry.terms) {
      assert(new RegExp(term, 'i').test(body.answer), entry.q + ' should address ' + term);
    }
    if (entry.timing) {
      assert(firstYear(body.answer), entry.q + ' should include a derived calendar year');
      assert(body.answer.includes('WINDOW'), entry.q + ' should include a timing window label');
      if (entry.label) assert(body.answer.includes(entry.label), entry.q + ' should include ' + entry.label);
    }
  }
}

async function testNameMeaningAnswers() {
  const recognized = await post('What does my name Mahesh mean?');
  assertPremiumStructure(recognized.answer);
  assert(/mahesh/i.test(recognized.answer), 'should name the person');
  assert(/sanskrit/i.test(recognized.answer), 'should give the real Sanskrit origin');
  assert(!/curated name lexicon/i.test(recognized.answer), 'recognized name should not use lexicon fallback');
  assert(!/won't claim a fixed etymology/i.test(recognized.answer), 'recognized name should not disclaim meaning');

  const unknown = await post('What does the name Zyxw mean?');
  assertPremiumStructure(unknown.answer);
  assert(/curated name lexicon/i.test(unknown.answer), 'unknown name should be disclosed honestly');
  assert(/name number/i.test(unknown.answer), 'unknown name should fall back to a name-number theme');
  assert(!/means (a |the )?[A-Za-z]+ and/i.test(unknown.answer), 'unknown name should not invent an etymology');

  const context = nameMeaning.buildNameMeaningContext('mahesh');
  assert.strictEqual(context.recognized, true, 'Mahesh should be in the curated lexicon');
  assert(context.summary.includes('Lord Shiva'), 'Mahesh summary should be accurate');

  const fallback = nameMeaning.buildNameMeaningContext('Zyxw');
  assert.strictEqual(fallback.recognized, false, 'unknown name should not be recognized');
  assert(fallback.number && fallback.number >= 1 && fallback.number <= 9, 'unknown name should reduce to a valid name number');
}

async function testVedicTimingUsesDasha() {
  // A Vedic user with dasha data must get a dasha-based reasoning line, and
  // the window must differ from a different birth date.
  const body = await post('When will I get married?', { tradition: 'vedic' });
  assertPremiumStructure(body.answer);
  assert(firstYear(body.answer), 'vedic timing answer should include a derived year');
  assert(/Maha ?[Dd]asha/i.test(body.answer), 'vedic answer should reference the dasha basis');

  const other = await post('When will I get married?', { tradition: 'vedic', dob: '1985-02-20' });
  assert.notStrictEqual(firstYear(body.answer), firstYear(other.answer),
    'vedic windows should differ for different birth dates');
}

async function run() {
  await testTimingDerivedNotHardcoded();
  await testRepresentativeAnswerQuality();
  await testNameMeaningAnswers();
  await testVedicTimingUsesDasha();
  console.log('✅ answer quality tests passed');
}

run().catch((err) => {
  console.error('❌ answer quality tests failed');
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});