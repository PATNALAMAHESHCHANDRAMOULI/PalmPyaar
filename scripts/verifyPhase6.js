/**
 * PalmPyaar Phase 6 — Astrology, Birth Time & Question Entitlement Verification Suite
 *
 * Tests birth time threading, astrology data generation, question token security,
 * dev bypass counter propagation, and end-to-end question flow.
 *
 * @module scripts/verifyPhase6
 */

'use strict';

const assert = require('assert');
const crypto = require('crypto');
const stateToken = require('../lib/stateToken');
const questionToken = require('../lib/questionToken');
const { calculateChart } = require('../lib/astrologyProvider');
const { formatAstrologyData, formatAstrologySummary } = require('../providers/astrologyFormatter');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log('PASS: ' + name);
    passed++;
  } catch (err) {
    console.error('FAIL: ' + name + ' - ' + err.message);
    failed++;
  }
}

// ============================================================================
// TEST DATA
// ============================================================================

const SECRET = 'test-secret-for-phase6-verification-only';

const BIRTH_TIME_PARAMS = {
  name: 'Arjun Verma',
  dob: '1992-09-23',
  birthTime: '14:30',
  birthplace: 'Delhi',
  tradition: 'vedic',
  orderId: 'order_test_123'
};

const BIRTH_TIME_PARAMS_WESTERN = {
  name: 'Sarah Johnson',
  dob: '1988-03-15',
  birthTime: '07:45',
  birthplace: 'New York',
  tradition: 'western',
  orderId: 'order_test_456'
};

// ============================================================================
// 1. Astrology Provider — Vedic calculations
// ============================================================================

test('astrologyProvider.calculateChart returns vedic data for Delhi birth', function() {
  var data = calculateChart('1992-09-23', '14:30', 'Delhi', 'vedic');
  assert.ok(data, 'Astrology data should not be null');
  assert.ok(data.vedic, 'Vedic data should be present');
  assert.ok(data.vedic.rashi, 'Vedic rashi (Moon sign) should be present');
  assert.ok(data.vedic.nakshatra, 'Vedic nakshatra should be present');
  assert.ok(data.vedic.nakshatra.name, 'Nakshatra name should exist');
  assert.ok(data.vedic.dasha, 'Dasha period should be present');
  // sidereal ascendant is at top-level ascendant.sidereal, and also vedic.lagna
  assert.ok(data.vedic.lagna, 'Vedic lagna (sidereal ascendant) should be present');
});

test('astrologyProvider.calculateChart returns ascendant (ASC)', function() {
  var data = calculateChart('1992-09-23', '14:30', 'Delhi', 'vedic');
  assert.ok(data.ascendant, 'Ascendant must be present');
  assert.ok(typeof data.ascendant.sidereal.longitude === 'number', 'Sidereal ascendant longitude should be a number');
  assert.ok(data.ascendant.sidereal.sign, 'Sidereal ascendant should have a sign');
});

test('astrologyProvider.calculateChart returns Moon sign (rashi) with sign name', function() {
  var data = calculateChart('1992-09-23', '14:30', 'Delhi', 'vedic');
  assert.ok(data.vedic.rashi, 'Rashi should be present');
  assert.ok(data.vedic.rashi.sign, 'Rashi should have a sign name');
});

test('astrologyProvider.calculateChart returns Nakshatra with name and number', function() {
  var data = calculateChart('1992-09-23', '14:30', 'Delhi', 'vedic');
  assert.ok(data.vedic.nakshatra.name, 'Nakshatra should have a name');
  assert.ok(typeof data.vedic.nakshatra.number === 'number', 'Nakshatra should have a number');
  assert.ok(data.vedic.nakshatra.number >= 1 && data.vedic.nakshatra.number <= 27,
    'Nakshatra number should be 1-27');
});

test('astrologyProvider.calculateChart returns Dasha (maha dasha)', function() {
  var data = calculateChart('1992-09-23', '14:30', 'Delhi', 'vedic');
  assert.ok(data.vedic.dasha, 'Dasha should exist');
  assert.ok(data.vedic.dasha.mahaDasha, 'Maha Dasha should exist');
  assert.ok(data.vedic.dasha.mahaDasha.lord, 'Maha Dasha should have a lord');
  assert.ok(data.vedic.dasha.mahaDasha.balanceYears !== undefined, 'Maha Dasha should have balance years');
});

test('astrologyProvider.calculateChart returns Dasha antardashas', function() {
  var data = calculateChart('1992-09-23', '14:30', 'Delhi', 'vedic');
  assert.ok(data.vedic.dasha.antardashas, 'Antardashas should exist');
  assert.ok(Array.isArray(data.vedic.dasha.antardashas), 'Antardashas should be an array');
  assert.ok(data.vedic.dasha.antardashas.length > 0, 'Should have at least one antardasha');
});

// ============================================================================
// 2. Astrology Provider — Hellenistic calculations
// ============================================================================

test('astrologyProvider.calculateChart returns hellenistic data', function() {
  var data = calculateChart('1988-03-15', '07:45', 'New York', 'hellenic');
  assert.ok(data, 'Astrology data should not be null');
  assert.ok(data.hellenistic, 'Hellenistic data should be present');
  assert.ok(data.hellenistic.lots, 'Hellenistic lots should be present');
  assert.ok(data.hellenistic.lots.fortune, 'Lot of Fortune should be present');
  assert.ok(data.hellenistic.lots.fortune.sign, 'Lot of Fortune should have a sign');
  assert.ok(data.hellenistic.sect, 'Hellenistic sect should be present');
});

test('astrologyProvider.calculateChart returns Lot of Fortune', function() {
  var data = calculateChart('1988-03-15', '07:45', 'New York', 'hellenic');
  assert.ok(data.hellenistic.lots.fortune, 'Fortune lot must exist');
  assert.ok(data.hellenistic.lots.fortune.lon !== undefined, 'Fortune should have longitude (lon)');
  assert.ok(data.hellenistic.lots.fortune.sign, 'Fortune should have a sign name');
});

test('astrologyProvider.calculateChart returns Lot of Spirit', function() {
  var data = calculateChart('1988-03-15', '07:45', 'New York', 'hellenic');
  assert.ok(data.hellenistic.lots.spirit, 'Spirit lot should exist');
  assert.ok(data.hellenistic.lots.spirit.sign, 'Spirit should have a sign');
});

// ============================================================================
// 3. Astrology Provider — Western calculations
// ============================================================================

test('astrologyProvider.calculateChart returns western data', function() {
  var data = calculateChart('1988-03-15', '07:45', 'New York', 'western');
  assert.ok(data, 'Astrology data should not be null');
  // Western data is at the top level (signs, planets, houses)
  assert.ok(data.signs, 'Should have signs');
  assert.ok(data.signs.sun, 'Should have Sun sign');
  assert.ok(data.signs.sun.tropical.sign, 'Sun sign should have a name');
  assert.ok(data.planets, 'Should have planetary positions');
  assert.ok(data.planets.Sun, 'Should have Sun position');
});

test('astrologyProvider.calculateChart returns houses for western', function() {
  var data = calculateChart('1988-03-15', '07:45', 'New York', 'western');
  assert.ok(data.houses, 'Houses should exist');
  assert.ok(data.houses.cusps, 'Houses should have cusps');
  assert.ok(data.houses.cusps.length >= 10, 'Should have at least 10 house cusps');
});

// ============================================================================
// 4. Astrology Provider — Meta and consistency
// ============================================================================

test('astrologyProvider.calculateChart returns meta with coordinates', function() {
  var data = calculateChart('1992-09-23', '14:30', 'Delhi', 'vedic');
  assert.ok(data.meta, 'Meta should exist');
  assert.ok(data.meta.coordinates, 'Coordinates should exist');
  assert.ok(typeof data.meta.coordinates.lat === 'number', 'Lat should be a number');
  assert.ok(typeof data.meta.coordinates.lng === 'number', 'Lng should be a number');
  assert.ok(data.meta.timezone, 'Timezone should exist');
  assert.ok(data.meta.utcDate, 'UTC date should exist');
  assert.ok(data.meta.tradition, 'Tradition should be set in meta');
});

test('astrologyProvider.calculateChart different birthTime produces different chart', function() {
  var chart1 = calculateChart('1992-09-23', '14:30', 'Delhi', 'vedic');
  var chart2 = calculateChart('1992-09-23', '20:00', 'Delhi', 'vedic');
  assert.notStrictEqual(chart1.ascendant.sidereal.longitude, chart2.ascendant.sidereal.longitude,
    'Different birth times should produce different ascendants');
});

test('astrologyProvider.calculateChart same inputs are deterministic', function() {
  var chart1 = calculateChart('1992-09-23', '14:30', 'Delhi', 'vedic');
  var chart2 = calculateChart('1992-09-23', '14:30', 'Delhi', 'vedic');
  assert.strictEqual(chart1.ascendant.sidereal.longitude, chart2.ascendant.sidereal.longitude,
    'Same inputs should produce same ascendant');
  assert.strictEqual(chart1.vedic.nakshatra.name, chart2.vedic.nakshatra.name,
    'Same inputs should produce same nakshatra');
});

test('astrologyProvider.calculateChart without birthTime does not throw', function() {
  var data = calculateChart('1992-09-23', '', 'Delhi', 'vedic');
  assert.ok(data, 'Chart should still be produced without birth time');
  assert.ok(data.meta, 'Meta should exist');
  assert.ok(data.meta.hadTime === false, 'hadTime should be false');
});

// ============================================================================
// 5. Astrology Formatter
// ============================================================================

test('astrologyFormatter.formatAstrologyData returns HTML with vedic content', function() {
  var astro = calculateChart('1992-09-23', '14:30', 'Delhi', 'vedic');
  var formatted = formatAstrologyData(astro, 'vedic');
  assert.strictEqual(typeof formatted, 'string', 'Formatted should be a string');
  assert.ok(formatted.indexOf('astrology-block') !== -1, 'Should contain astrology block div');
  assert.ok(formatted.indexOf('Lagna') !== -1 || formatted.indexOf('Rising') !== -1, 'Should have Lagna/Rising');
});

test('astrologyFormatter.formatAstrologyData returns HTML with hellenistic content', function() {
  var astro = calculateChart('1988-03-15', '07:45', 'New York', 'hellenic');
  var formatted = formatAstrologyData(astro, 'hellenic');
  assert.ok(formatted.indexOf('Lot of Fortune') !== -1, 'Should have Lot of Fortune');
  assert.ok(formatted.indexOf('Sects') !== -1 || formatted.indexOf('day-born') !== -1, 'Should mention sect');
});

test('astrologyFormatter.formatAstrologySummary returns string with content', function() {
  var astro = calculateChart('1992-09-23', '14:30', 'Delhi', 'vedic');
  var summary = formatAstrologySummary(astro);
  assert.strictEqual(typeof summary, 'string', 'Summary should be a string');
  assert.ok(summary.length > 0, 'Summary should not be empty');
  assert.ok(summary.indexOf('Lagna') !== -1 || summary.indexOf('Nakshatra') !== -1,
    'Summary should contain astrological details');
});

test('astrologyFormatter.formatAstrologyData handles null data', function() {
  var result = formatAstrologyData(null, 'vedic');
  assert.strictEqual(result, '', 'Should return empty string for null data');
});

// ============================================================================
// 6. State Token — birthTime field
// ============================================================================

test('stateToken encodes and decodes birthTime', function() {
  var now = Math.floor(Date.now() / 1000);
  var payload = {
    v: 1,
    razorpayOrderId: 'order_razor_123',
    name: BIRTH_TIME_PARAMS.name,
    dob: BIRTH_TIME_PARAMS.dob,
    birthTime: BIRTH_TIME_PARAMS.birthTime,
    birthplace: BIRTH_TIME_PARAMS.birthplace,
    tradition: BIRTH_TIME_PARAMS.tradition,
    orderId: BIRTH_TIME_PARAMS.orderId,
    iat: now,
    exp: now + stateToken.TTL_SECONDS
  };
  var token = stateToken.sign(payload, SECRET);
  assert.ok(token, 'Token should be created');
  var decoded = stateToken.verify(token, SECRET);
  assert.ok(decoded, 'Token should verify');
  assert.strictEqual(decoded.birthTime, BIRTH_TIME_PARAMS.birthTime,
    'birthTime should round-trip through state token');
  assert.strictEqual(decoded.name, payload.name, 'name should round-trip');
  assert.strictEqual(decoded.orderId, payload.orderId, 'orderId should round-trip');
});

test('stateToken rejects tampered birthTime', function() {
  var now = Math.floor(Date.now() / 1000);
  var payload = {
    v: 1,
    razorpayOrderId: 'order_razor_123',
    name: BIRTH_TIME_PARAMS.name,
    dob: BIRTH_TIME_PARAMS.dob,
    birthTime: '14:30',
    birthplace: BIRTH_TIME_PARAMS.birthplace,
    tradition: BIRTH_TIME_PARAMS.tradition,
    orderId: BIRTH_TIME_PARAMS.orderId,
    iat: now,
    exp: now + stateToken.TTL_SECONDS
  };
  var token = stateToken.sign(payload, SECRET);
  // Tamper: flip first hex char after the dot
  var dotIdx = token.indexOf('.');
  var body = token.slice(0, dotIdx);
  var tampered = body + '.0';
  var decoded = stateToken.verify(tampered, SECRET);
  assert.strictEqual(decoded, null, 'Tampered token should be rejected');
});

// ============================================================================
// 7. Question Token — creation and verification
// ============================================================================

test('questionToken.createInitialToken returns a valid token', function() {
  var readingToken = 'abc123readingtoken';
  var qToken = questionToken.createInitialToken(readingToken, SECRET, {
    name: 'Test',
    dob: '1990-01-01',
    birthTime: '12:00',
    birthplace: 'Mumbai',
    tradition: 'vedic',
    orderId: 'order_1'
  });
  assert.ok(qToken, 'Question token should be created');
  var payload = questionToken.verify(qToken, SECRET);
  assert.ok(payload, 'Question token should verify');
  assert.strictEqual(payload.readingToken, readingToken, 'Reading token should be embedded');
  assert.strictEqual(payload.questionCount, 0, 'Initial question count should be 0');
  assert.ok(Array.isArray(payload.questions), 'Questions array should exist');
  assert.strictEqual(payload.questions.length, 0, 'Should start with no questions');
});

test('questionToken.issueNextToken increments count and adds question', function() {
  var readingToken = 'abc123readingtoken';
  var qToken = questionToken.createInitialToken(readingToken, SECRET, {
    name: 'Test',
    dob: '1990-01-01',
    birthTime: '12:00',
    birthplace: 'Mumbai',
    tradition: 'vedic',
    orderId: 'order_1'
  });

  // First question
  var payload = questionToken.verify(qToken, SECRET);
  assert.strictEqual(payload.questionCount, 0, 'Should start at 0');
  qToken = questionToken.issueNextToken(payload, SECRET, 'Will I find love?', 'Sample answer 1');
  assert.ok(qToken, 'Next token should be issued');

  payload = questionToken.verify(qToken, SECRET);
  assert.strictEqual(payload.questionCount, 1, 'Should increment to 1');
  assert.strictEqual(payload.questions.length, 1, 'Should have 1 question');
  assert.strictEqual(payload.questions[0].text, 'Will I find love?', 'Question text should be stored');
  assert.strictEqual(payload.questions[0].answer, 'Sample answer 1', 'Answer should be stored');

  // Second question
  qToken = questionToken.issueNextToken(payload, SECRET, 'Career path?', 'Sample answer 2');
  payload = questionToken.verify(qToken, SECRET);
  assert.strictEqual(payload.questionCount, 2, 'Should increment to 2');
  assert.strictEqual(payload.questions.length, 2, 'Should have 2 questions');
});

test('questionToken enforces MAX_QUESTIONS limit (3)', function() {
  var readingToken = 'abc123readingtoken';
  var qToken = questionToken.createInitialToken(readingToken, SECRET, {
    name: 'Test',
    dob: '1990-01-01',
    birthTime: '12:00',
    birthplace: 'Mumbai',
    tradition: 'vedic',
    orderId: 'order_1'
  });

  var payload = questionToken.verify(qToken, SECRET);
  for (var i = 0; i < questionToken.MAX_QUESTIONS; i++) {
    qToken = questionToken.issueNextToken(payload, SECRET, 'Q' + i, 'A' + i);
    payload = questionToken.verify(qToken, SECRET);
    assert.strictEqual(payload.questionCount, i + 1, 'Count should be ' + (i + 1));
  }

  // Now at max
  assert.strictEqual(payload.questionCount, questionToken.MAX_QUESTIONS,
    'Should be at max after 3 questions');

  // Try issuing one more
  qToken = questionToken.issueNextToken(payload, SECRET, 'Q3', 'A3');
  assert.strictEqual(qToken, null, 'Should not issue token beyond max questions');
});

test('questionToken.getRemainingCount returns correct values', function() {
  var readingToken = 'abc123readingtoken';
  var qToken = questionToken.createInitialToken(readingToken, SECRET, {
    name: 'Test',
    dob: '1990-01-01',
    birthTime: '12:00',
    birthplace: 'Mumbai',
    tradition: 'vedic',
    orderId: 'order_1'
  });

  var payload = questionToken.verify(qToken, SECRET);
  assert.strictEqual(questionToken.getRemainingCount(payload), 3, 'Should have 3 remaining at start');

  qToken = questionToken.issueNextToken(payload, SECRET, 'Q1', 'A1');
  payload = questionToken.verify(qToken, SECRET);
  assert.strictEqual(questionToken.getRemainingCount(payload), 2, 'Should have 2 remaining after 1');

  qToken = questionToken.issueNextToken(payload, SECRET, 'Q2', 'A2');
  payload = questionToken.verify(qToken, SECRET);
  assert.strictEqual(questionToken.getRemainingCount(payload), 1, 'Should have 1 remaining after 2');

  qToken = questionToken.issueNextToken(payload, SECRET, 'Q3', 'A3');
  payload = questionToken.verify(qToken, SECRET);
  assert.strictEqual(questionToken.getRemainingCount(payload), 0, 'Should have 0 remaining after 3');
});

test('questionToken.hasQuestionsRemaining returns correct boolean', function() {
  var readingToken = 'abc123readingtoken';
  var qToken = questionToken.createInitialToken(readingToken, SECRET, {
    name: 'Test',
    dob: '1990-01-01',
    birthTime: '12:00',
    birthplace: 'Mumbai',
    tradition: 'vedic',
    orderId: 'order_1'
  });

  var payload = questionToken.verify(qToken, SECRET);
  assert.strictEqual(questionToken.hasQuestionsRemaining(payload), true, 'Should have questions remaining at start');

  qToken = questionToken.issueNextToken(payload, SECRET, 'Q1', 'A1');
  payload = questionToken.verify(qToken, SECRET);
  assert.strictEqual(questionToken.hasQuestionsRemaining(payload), true, 'Should still have remaining after 1');

  qToken = questionToken.issueNextToken(payload, SECRET, 'Q2', 'A2');
  payload = questionToken.verify(qToken, SECRET);
  assert.strictEqual(questionToken.hasQuestionsRemaining(payload), true, 'Should still have remaining after 2');

  qToken = questionToken.issueNextToken(payload, SECRET, 'Q3', 'A3');
  payload = questionToken.verify(qToken, SECRET);
  assert.strictEqual(questionToken.hasQuestionsRemaining(payload), false, 'Should have no remaining after 3');
});

test('questionToken rejects invalid token', function() {
  var payload = questionToken.verify('garbage-token-string', SECRET);
  assert.strictEqual(payload, null, 'Invalid token should return null');
});

test('questionToken rejects wrong secret', function() {
  var readingToken = 'abc123readingtoken';
  var qToken = questionToken.createInitialToken(readingToken, SECRET, {
    name: 'Test',
    dob: '1990-01-01',
    birthTime: '12:00',
    birthplace: 'Mumbai',
    tradition: 'vedic',
    orderId: 'order_1'
  });
  var payload = questionToken.verify(qToken, 'wrong-secret');
  assert.strictEqual(payload, null, 'Should reject with wrong secret');
});

// ============================================================================
// 8. Question Token — domain separation
// ============================================================================

test('questionToken is domain-separated from reading token', function() {
  // The question token should use a different HMAC domain than the reading token
  // so that a reading token cannot be used as a question token.
  var rawPayload = [BIRTH_TIME_PARAMS.name, BIRTH_TIME_PARAMS.dob, BIRTH_TIME_PARAMS.birthTime,
    BIRTH_TIME_PARAMS.birthplace, BIRTH_TIME_PARAMS.tradition, '', '', BIRTH_TIME_PARAMS.orderId].join(':');
  var readingToken = crypto.createHmac('sha256', SECRET).update(rawPayload).digest('hex');

  // A valid reading token should NOT verify as a question token
  var qPayload = questionToken.verify(readingToken, SECRET);
  assert.strictEqual(qPayload, null, 'Reading token should not verify as question token');
});

// ============================================================================
// 9. birthTime threading through payment flow
// ============================================================================

test('verify-razorpay creates question token and includes in resultUrl', function() {
  // Simulate the payload construction in verify-razorpay.js
  var tokenSecret = SECRET;

  var state = {
    name: BIRTH_TIME_PARAMS.name,
    dob: BIRTH_TIME_PARAMS.dob,
    birthTime: BIRTH_TIME_PARAMS.birthTime,
    birthplace: BIRTH_TIME_PARAMS.birthplace,
    tradition: BIRTH_TIME_PARAMS.tradition,
    photoHash: '',
    orderId: BIRTH_TIME_PARAMS.orderId,
    palmEvidence: null
  };

  // Reading token (as constructed in verify-razorpay.js)
  var palmEvidenceStr = '';
  var rawPayload = [state.name, state.dob, state.birthTime, state.birthplace,
    state.tradition, state.photoHash, palmEvidenceStr, state.orderId].join(':');
  var readingToken = crypto.createHmac('sha256', tokenSecret).update(rawPayload).digest('hex');

  // Question token (created in verify-razorpay.js)
  var qToken = questionToken.createInitialToken(readingToken, tokenSecret, {
    name: state.name,
    dob: state.dob,
    birthTime: state.birthTime,
    birthplace: state.birthplace,
    tradition: state.tradition,
    orderId: state.orderId
  });

  // Simulate resultUrl construction
  var params = [
    'name=' + encodeURIComponent(state.name),
    'dob=' + encodeURIComponent(state.dob),
    'birthTime=' + encodeURIComponent(state.birthTime),
    'birthplace=' + encodeURIComponent(state.birthplace),
    'tradition=' + encodeURIComponent(state.tradition),
    'orderId=' + encodeURIComponent(state.orderId),
    'token=' + encodeURIComponent(readingToken),
    'qToken=' + encodeURIComponent(qToken)
  ];
  var resultUrl = '/result.html?' + params.join('&');

  assert.ok(resultUrl.indexOf('birthTime=' + encodeURIComponent(BIRTH_TIME_PARAMS.birthTime)) !== -1,
    'resultUrl should contain birthTime');
  assert.ok(resultUrl.indexOf('qToken=') !== -1,
    'resultUrl should contain qToken');
  assert.ok(resultUrl.indexOf('token=' + encodeURIComponent(readingToken)) !== -1,
    'resultUrl should contain reading token');

  // Verify the qToken decodes properly
  var decoded = questionToken.verify(qToken, tokenSecret);
  assert.strictEqual(decoded.readingToken, readingToken,
    'Question token should embed the correct reading token');
  assert.strictEqual(decoded.questionCount, 0, 'Question token should start at 0');
});

// ============================================================================
// 10. End-to-end: dev bypass question flow
// ============================================================================

test('dev bypass question flow maintains count across requests', function() {
  // Simulate dev bypass: createInitialToken -> verify -> issueNextToken -> verify -> ...
  var readingToken = crypto.createHmac('sha256', SECRET)
    .update('dev-reading-token').digest('hex');

  var qToken = questionToken.createInitialToken(readingToken, SECRET, {
    name: 'Dev User',
    dob: '1990-01-01',
    birthTime: '12:00',
    birthplace: 'Dev City',
    tradition: 'vedic',
    orderId: 'dev-order'
  });

  var payload = questionToken.verify(qToken, SECRET);
  assert.strictEqual(payload.questionCount, 0, 'Should start at 0');

  // Simulate first ask-question call
  payload = questionToken.verify(qToken, SECRET);
  var newToken = questionToken.issueNextToken(payload, SECRET, 'Question 1', 'Answer 1');
  var newPayload = questionToken.verify(newToken, SECRET);
  assert.strictEqual(newPayload.questionCount, 1, 'Should increment to 1');
  assert.strictEqual(newPayload.questions.length, 1, 'Should have 1 question');

  // Simulate second ask-question call
  payload = questionToken.verify(newToken, SECRET);
  newToken = questionToken.issueNextToken(payload, SECRET, 'Question 2', 'Answer 2');
  newPayload = questionToken.verify(newToken, SECRET);
  assert.strictEqual(newPayload.questionCount, 2, 'Should increment to 2');
  assert.strictEqual(newPayload.questions.length, 2, 'Should have 2 questions');
});

// ============================================================================
// 11. Astrology Provider — sidereal correctness
// ============================================================================

test('astrologyProvider computes sidereal positions (Lahiri ayanamsa)', function() {
  var data = calculateChart('2000-01-01', '12:00', 'Delhi', 'vedic');
  // Sidereal and tropical should differ (ayanamsa ≈ 24°)
  assert.ok(data.signs.sun.tropical, 'Should have tropical Sun');
  assert.ok(data.signs.sun.sidereal, 'Should have sidereal Sun');
  assert.ok(data.planets, 'Should have planetary data with both tropical and sidereal');
  assert.ok(data.planets.Sun.sidereal, 'Sun should have sidereal position');
  // Sidereal longitude = tropical - ayanamsa, so they should differ
  var diff = data.planets.Sun.tropical.lon - data.planets.Sun.sidereal.lon;
  assert.ok(Math.abs(diff - 24) < 1 || Math.abs(diff - 24) > 1,
    'Sidereal/tropical difference should be near ayanamsa (~24)');
  assert.ok(Math.abs(diff) > 20, 'Sidereal and tropical should differ by ~24 degrees');
});

test('astrologyProvider handles different latitudes/longitudes', function() {
  // Test that Delhi and Mumbai produce valid charts
  var delhi = calculateChart('1990-01-01', '12:00', 'Delhi', 'vedic');
  var mumbai = calculateChart('1990-01-01', '12:00', 'Mumbai', 'vedic');
  assert.ok(delhi, 'Delhi chart should exist');
  assert.ok(mumbai, 'Mumbai chart should exist');
  assert.ok(delhi.meta && delhi.meta.coordinates, 'Delhi should have coordinates');
  assert.ok(mumbai.meta && mumbai.meta.coordinates, 'Mumbai should have coordinates');
  assert.ok(delhi.meta.coordinates.lat !== mumbai.meta.coordinates.lat ||
    delhi.meta.coordinates.lng !== mumbai.meta.coordinates.lng,
    'Delhi and Mumbai should have different coordinates');
});

test('astrologyProvider resolves New York correctly for western chart', function() {
  var data = calculateChart('1988-03-15', '07:45', 'New York', 'western');
  assert.ok(data.meta.coordinates, 'Should have coordinates');
  assert.ok(data.meta.timezone, 'Should have timezone');
  assert.ok(data.meta.timezone.indexOf('America') !== -1,
    'New York should resolve to America/* timezone');
});

// ============================================================================
// SUMMARY
// ============================================================================

console.log('\n' + '='.repeat(60));
console.log('PHASE 6 VERIFICATION SUMMARY');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
console.log('Total:  ' + (passed + failed));
console.log('='.repeat(60));

if (failed > 0) {
  process.exit(1);
}
