/*
 * Focused tests for the corrected Vimshottari timing engine and the timing
 * answer path. Covers: nakshatra->lord mapping, balance, Antardasha
 * durations/dates, current Mahadasha/Antardasha, future relevant periods,
 * chart-dependence, topic timing (marriage/career/relocation), success intent,
 * name-meaning, and the signed question-token gate (A-P from the task spec).
 * These tests do not touch payment or security token internals.
 */
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { calculateChart } = require('../lib/astrologyProvider');
const te = require('../lib/timingEngine');
const askQuestion = require('../api/ask-question');
const questionToken = require('../lib/questionToken');

process.env.TOKEN_SECRET = 'timing-engine-test-secret';
process.env.AI_READING = 'false';
delete process.env.DEV_BYPASS;

const NOW = Date.UTC(2026, 7, 1, 0, 0, 0);

function near(actual, expected, tol, label) {
  assert(Math.abs(actual - expected) <= tol,
    label + ': expected ' + expected + ' +/- ' + tol + ', got ' + actual);
}

function chart(dob, time, place, tradition) {
  return calculateChart(dob, time, place, tradition);
}

function windowFor(astro, tradition, dob, topic, now) {
  return te.deriveTimingWindow({
    astrologyData: astro,
    tradition: tradition,
    dob: dob,
    intent: { topic: topic, timing: true },
    now: now
  });
}

function yearWithin(result, lo, hi, label) {
  assert(result && result.supported, label + ': should be supported');
  assert(result.window.startYear >= lo && result.window.startYear <= hi,
    label + ': startYear ' + result.window.startYear + ' not in [' + lo + ',' + hi + ']');
  assert(result.window.endYear >= result.window.startYear,
    label + ': endYear should follow startYear');
  assert(result.window.endYear - result.window.startYear <= 5,
    label + ': window should be narrow (got ' + (result.window.endYear - result.window.startYear + 1) + ' years)');
}

// --- A. Nakshatra -> Mahadasha lord mapping --------------------------------
function testNakshatraToLord() {
  const cases = [
    ['1994-05-15', 'jupiter'], // Punarvasu (idx 6 -> DASHA_ORDER[6])
    ['1990-05-15', 'sun'],     // Uttara Ashadha (idx 20 -> DASHA_ORDER[2])
    ['1985-02-20', 'rahu']     // Shatabhisha (idx 23 -> DASHA_ORDER[5])
  ];
  for (const [dob, expected] of cases) {
    const astro = chart(dob, '10:30', 'Mumbai', 'vedic');
    const md = astro.vedic.dasha.mahaDasha;
    const nakIdx = astro.vedic.nakshatra.number - 1;
    const expectedLord = te.DASHA_ORDER[nakIdx % 9];
    assert.strictEqual(md.lord, expectedLord, dob + ': mapped lord should equal DASHA_ORDER[nakIdx % 9]');
    assert.strictEqual(md.lord, expected, dob + ': mapped lord should be ' + expected);
    assert.ok(Number.isFinite(md.balance) && md.balance > 0 && md.balance < te.DASHA_YEARS[md.lord],
      dob + ': balance should be within the lord period');
  }
}

// --- B. Balance (remaining birth Mahadasha) --------------------------------
function testBalance() {
  const cases = [
    ['1994-05-15', 'jupiter', 16, 14.5, 15.1],
    ['1990-05-15', 'sun', 6, 4.9, 5.4],
    ['1985-02-20', 'rahu', 18, 9.6, 10.1]
  ];
  for (const [dob, lord, lordYears, lo, hi] of cases) {
    const astro = chart(dob, '10:30', 'Mumbai', 'vedic');
    const md = astro.vedic.dasha.mahaDasha;
    assert.strictEqual(md.lord, lord, dob + ': birth Mahadasha lord');
    assert.ok(md.balance >= lo && md.balance <= hi,
      dob + ': balance ' + md.balance.toFixed(3) + ' not in [' + lo + ',' + hi + ']');
    const birthMs = Date.UTC(parseInt(dob.slice(0, 4), 10), parseInt(dob.slice(5, 7), 10) - 1, parseInt(dob.slice(8, 10), 10));
    const endMs = new Date(md.endDate).getTime();
    near((endMs - birthMs) / (365.25 * 86400000), md.balance, 0.05,
      dob + ': birth-MD end date should sit about balance years after birth');
    assert.strictEqual(md.balanceYears, Math.floor(md.balance),
      dob + ': balanceYears should be the floored balance');
  }
}

// --- C. Antardasha durations (proportional, sum = MD years) ----------------
function testAntardashaDurations() {
  const astro = chart('1994-05-15', '10:30', 'Mumbai', 'vedic');
  const md = astro.vedic.dasha.mahaDasha;
  const adas = astro.vedic.dasha.antardashas;
  assert.strictEqual(adas.length, 9, 'should have 9 Antardashas');

  let sum = 0;
  const startIdx = te.DASHA_ORDER.indexOf(md.lord);
  for (let i = 0; i < 9; i++) {
    const expectedLord = te.DASHA_ORDER[(startIdx + i) % 9];
    assert.strictEqual(adas[i].lord, expectedLord, 'AD ' + i + ' lord should follow MD lord sequence');
    const expectedDur = (te.DASHA_YEARS[md.lord] * te.DASHA_YEARS[expectedLord]) / 120;
    near(adas[i].durationYears, expectedDur, 0.02, 'AD ' + adas[i].lord + ' duration');
    near(adas[i].years, expectedDur, 0.02, 'AD ' + adas[i].lord + ' years');
    sum += adas[i].durationYears;
  }
  near(sum, te.DASHA_YEARS[md.lord], 0.1, 'AD durations should sum to the MD years');
  near(sum, 16, 0.1, 'Jupiter Mahadasha should be 16 years');
}

// --- D. Antardasha dates (contiguous, cover the Mahadasha) -----------------
function testAntardashaDates() {
  const astro = chart('1994-05-15', '10:30', 'Mumbai', 'vedic');
  const md = astro.vedic.dasha.mahaDasha;
  const adas = astro.vedic.dasha.antardashas;

  assert.strictEqual(adas[0].startDate, md.startDate, 'first AD should start at MD start');
  assert.strictEqual(adas[8].endDate, md.endDate, 'last AD should end at MD end');

  for (let i = 0; i < 9; i++) {
    const start = new Date(adas[i].startDate).getTime();
    const end = new Date(adas[i].endDate).getTime();
    near((end - start) / (365.25 * 86400000), adas[i].durationYears, 0.02,
      'AD ' + adas[i].lord + ' span should equal its durationYears');
    if (i > 0) {
      assert.strictEqual(adas[i].startDate, adas[i - 1].endDate,
        'AD ' + i + ' should start where AD ' + (i - 1) + ' ended');
    }
  }
}

// --- E. Current Mahadasha --------------------------------------------------
function testCurrentMahadasha() {
  const cases = [
    ['1994-05-15', 'saturn'],
    ['1990-05-15', 'rahu'],
    ['1985-02-20', 'saturn']
  ];
  for (const [dob, expected] of cases) {
    const astro = chart(dob, '10:30', 'Mumbai', 'vedic');
    const sched = te.buildVedicSchedule(astro.vedic.dasha, parseInt(dob.slice(0, 4), 10), NOW);
    assert.ok(sched.currentMD, dob + ': current MD should exist');
    assert.strictEqual(sched.currentMD.lord, expected, dob + ': current Mahadasha should be ' + expected);
    const start = new Date(sched.currentMD.startDate).getTime();
    const end = new Date(sched.currentMD.endDate).getTime();
    assert.ok(start <= NOW && NOW < end, dob + ': current MD should bracket NOW');
    assert.ok(sched.mahadashas.length >= 9, 'schedule should include the full dasha cycle');
  }
}

// --- F. Current Antardasha -------------------------------------------------
function testCurrentAntardasha() {
  const cases = [
    ['1994-05-15', 'jupiter'],
    ['1990-05-15', 'venus'],
    ['1985-02-20', 'rahu']
  ];
  for (const [dob, expected] of cases) {
    const astro = chart(dob, '10:30', 'Mumbai', 'vedic');
    const sched = te.buildVedicSchedule(astro.vedic.dasha, parseInt(dob.slice(0, 4), 10), NOW);
    assert.ok(sched.currentAD, dob + ': current AD should exist');
    assert.strictEqual(sched.currentAD.lord, expected, dob + ': current Antardasha should be ' + expected);
    const start = new Date(sched.currentAD.startDate).getTime();
    const end = new Date(sched.currentAD.endDate).getTime();
    assert.ok(start <= NOW && NOW < end, dob + ': current AD should bracket NOW');
  }
}

// --- G. Future relevant period is near-term and narrow ---------------------
function testFutureRelevantPeriod() {
  const astro = chart('1994-05-15', '10:30', 'Mumbai', 'vedic');
  const r = windowFor(astro, 'vedic', '1994-05-15', 'career/job', NOW);
  yearWithin(r, 2026, 2035, '1994 vedic career window');
  assert(/2028/.test(r.window.text), '1994 vedic career should include 2028: ' + r.window.text);

  const m = windowFor(astro, 'vedic', '1994-05-15', 'marriage', NOW);
  yearWithin(m, 2026, 2040, '1994 vedic marriage window');
  assert(/2031/.test(m.window.text), '1994 vedic marriage should include 2031: ' + m.window.text);
}

// --- H. Different DOBs produce different timing ----------------------------
function testDifferentDobsDiffer() {
  const vedic = {};
  const western = {};
  for (const dob of ['1994-05-15', '1990-05-15', '1985-02-20']) {
    const v = windowFor(chart(dob, '10:30', 'Mumbai', 'vedic'), 'vedic', dob, 'marriage', NOW);
    const w = windowFor(chart(dob, '10:30', 'Mumbai', 'western'), 'western', dob, 'career/job', NOW);
    vedic[dob] = v.window.startYear + '-' + v.window.endYear;
    western[dob] = w.window.startYear;
  }
  const uniqueVedic = new Set(Object.values(vedic));
  const uniqueWestern = new Set(Object.values(western));
  assert.ok(uniqueVedic.size >= 2, 'vedic timing should differ across charts: ' + JSON.stringify(vedic));
  assert.ok(uniqueWestern.size >= 2, 'western timing should differ across charts: ' + JSON.stringify(western));
}

// --- I. Same birth year + different charts -> different timing -------------
function testSameYearDifferentCharts() {
  const a = chart('1990-05-15', '10:30', 'Mumbai', 'western');
  const b = chart('1990-05-15', '23:30', 'New York', 'western');
  assert.notStrictEqual(a.ascendant.tropical.sign, b.ascendant.tropical.sign,
    'the two charts should have different ascendants');
  const wa = windowFor(a, 'western', '1990-05-15', 'career/job', NOW);
  const wb = windowFor(b, 'western', '1990-05-15', 'career/job', NOW);
  assert.notStrictEqual(wa.window.startYear, wb.window.startYear,
    'same birth year with different charts should not force identical timing');
  assert.strictEqual(wa.window.startYear, 2035, 'Mumbai (Cancer rising) career profection');
  assert.strictEqual(wb.window.startYear, 2027, 'New York (Capricorn rising) career profection');
}

// --- J/K/L. Topic-specific timing: marriage, career, relocation ------------
function testTopicTiming() {
  const v = chart('1994-05-15', '10:30', 'Mumbai', 'vedic');
  const marriage = windowFor(v, 'vedic', '1994-05-15', 'marriage', NOW);
  assert(/Venus/.test(marriage.reasoning), 'vedic marriage should cite the Venus Antardasha: ' + marriage.reasoning);
  yearWithin(marriage, 2026, 2040, 'vedic marriage');

  const career = windowFor(v, 'vedic', '1994-05-15', 'career/job', NOW);
  assert(/Mercury/.test(career.reasoning), 'vedic career should cite the Mercury Antardasha: ' + career.reasoning);
  yearWithin(career, 2026, 2040, 'vedic career');

  const relocation = windowFor(v, 'vedic', '1994-05-15', 'travel/relocation', NOW);
  yearWithin(relocation, 2026, 2040, 'vedic relocation');

  const w = chart('1994-05-15', '10:30', 'Mumbai', 'western');
  const wm = windowFor(w, 'western', '1994-05-15', 'marriage', NOW);
  assert(/7th house/.test(wm.reasoning), 'western marriage should activate the 7th house: ' + wm.reasoning);
  yearWithin(wm, 2026, 2045, 'western marriage');

  const wc = windowFor(w, 'western', '1994-05-15', 'career/job', NOW);
  assert(/10th house/.test(wc.reasoning), 'western career should activate the 10th house: ' + wc.reasoning);
  assert.strictEqual(wc.window.startYear, 2027, '1994 western career profection year');

  const wr = windowFor(w, 'western', '1994-05-15', 'travel/relocation', NOW);
  assert(/12th house/.test(wr.reasoning), 'western relocation should activate the 12th house: ' + wr.reasoning);
}

// --- M. Success intent routes to opportunities, not general ----------------
async function testSuccessIntent() {
  const r = await getAnswer('Will I become successful?', 'vedic');
  assert.strictEqual(r.statusCode, 200);
  assert(/opportunities/.test(r.body.answer.toLowerCase()), 'success question should read as opportunities/future');
  assert(!/Regarding your question|themes of growth/i.test(r.body.answer), 'should not use old generic filler');
  assert(/DIRECT ANSWER/.test(r.body.answer), 'should include the DIRECT ANSWER section');
}

// --- N. Name-meaning answer structure --------------------------------------
async function testNameMeaning() {
  const r = await getAnswer('What does my name mean?', 'vedic');
  assert.strictEqual(r.statusCode, 200);
  assert(/DIRECT ANSWER/.test(r.body.answer), 'name question should keep the direct-answer structure');
  assert(!/Cannot|unable to/i.test(r.body.answer), 'name answer should not fabricate or refuse');
}

// --- O. Signed question-token quota gate ------------------------------------
async function testQuestionTokenQuota() {
  const base = userBase('quota');
  const readingToken = readingTokenFor(base);
  let qToken = questionToken.createInitialToken(readingToken, process.env.TOKEN_SECRET, base);
  let used = 0;
  while (used < 3) {
    const res = await post(validBody('When will I get the job?', qToken, readingToken, base));
    assert.strictEqual(res.statusCode, 200, 'question ' + (used + 1) + ' should succeed');
    used++;
    assert.strictEqual(res.body.questionsUsed, used);
    qToken = res.body.questionToken;
  }
  const fourth = await post(validBody('Can I ask one more?', qToken, readingToken, base));
  assert.strictEqual(fourth.statusCode, 403, '4th question should be rejected server-side');
  assert.strictEqual(fourth.body.questionsUsed, 3);
}

// --- P. Browser-supplied count fields are ignored ---------------------------
async function testBrowserSuppliedCountsIgnored() {
  const base = userBase('browser');
  const readingToken = readingTokenFor(base);
  const qToken = questionToken.createInitialToken(readingToken, process.env.TOKEN_SECRET, base);
  const res = await post(validBody('When will I get the job?', qToken, readingToken, base, {
    questionCount: 999,
    remainingQuestions: 999,
    maxQuestions: 999
  }));
  assert.strictEqual(res.statusCode, 200, 'server should ignore browser-supplied counts');
  assert.strictEqual(res.body.questionsUsed, 1);
  assert.strictEqual(res.body.remainingQuestions, 2);
  assert.strictEqual(res.body.maxQuestions, 3);
}

// --- helpers for handler-level tests ---------------------------------------
function userBase(suffix) {
  return {
    name: 'Timing Test',
    dob: '1994-05-15',
    birthTime: '10:30',
    birthplace: 'Mumbai',
    tradition: 'vedic',
    photoHash: 'a'.repeat(64),
    palmEvidence: null,
    orderId: 'order_timing_' + suffix
  };
}

function readingTokenFor(data) {
  const palmEvidenceStr = data.palmEvidence ? JSON.stringify(data.palmEvidence) : '';
  return crypto.createHmac('sha256', process.env.TOKEN_SECRET)
    .update([data.name, data.dob, data.birthTime, data.birthplace, data.tradition,
      data.photoHash, palmEvidenceStr, data.orderId].join(':')).digest('hex');
}

function createMockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
}

function post(body) {
  const req = { method: 'POST', body };
  const res = createMockRes();
  return askQuestion(req, res).then(function () { return res; });
}

function validBody(question, qToken, readingToken, base, overrides) {
  return {
    ...base,
    ...(overrides || {}),
    question,
    questionToken: qToken,
    readingToken
  };
}

async function getAnswer(question, tradition) {
  const base = userBase('answer_' + question.length + '_' + tradition);
  const readingToken = readingTokenFor(base);
  const qToken = questionToken.createInitialToken(readingToken, process.env.TOKEN_SECRET, base);
  return post(validBody(question, qToken, readingToken, base, { tradition: tradition }));
}

// --- run -------------------------------------------------------------------
async function run() {
  testNakshatraToLord();
  testBalance();
  testAntardashaDurations();
  testAntardashaDates();
  testCurrentMahadasha();
  testCurrentAntardasha();
  testFutureRelevantPeriod();
  testDifferentDobsDiffer();
  testSameYearDifferentCharts();
  testTopicTiming();
  await testSuccessIntent();
  await testNameMeaning();
  await testQuestionTokenQuota();
  await testBrowserSuppliedCountsIgnored();

  const engineSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'timingEngine.js'), 'utf8');
  assert.ok(!/\b20(7[89]|8[0-9]|90|9[0-9])\b/.test(engineSource),
    'timingEngine should not hardcode far-future prediction years');

  console.log('✅ timing engine tests passed');
}

run().catch((err) => {
  console.error('❌ timing engine tests failed');
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});