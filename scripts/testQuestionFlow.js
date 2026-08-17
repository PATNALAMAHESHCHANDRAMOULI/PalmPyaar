/*
 * Focused tests for post-payment follow-up question token flow and
 * deterministic answer quality. These tests do not touch payment logic.
 *
 * Architecture note: this flow is intentionally database-free/stateless.
 * HMAC question tokens are tamper-resistant and carry the signed question
 * count, but a fully stateless server cannot prove that an older valid token
 * was previously consumed. The browser must rotate to the newly issued token;
 * the server must never trust an unsigned client-provided count.
 */
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const askQuestion = require('../api/ask-question');
const questionToken = require('../lib/questionToken');
const groqProvider = require('../providers/groqProvider');

process.env.TOKEN_SECRET = 'question-flow-test-secret';
process.env.AI_READING = 'false';
delete process.env.DEV_BYPASS;

const base = {
  name: 'Test User',
  dob: '1994-05-15',
  birthTime: '10:30',
  birthplace: 'Mumbai',
  tradition: 'western',
  photoHash: 'a'.repeat(64),
  palmEvidence: null,
  orderId: 'order_question_flow_test'
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

async function post(body) {
  const req = { method: 'POST', body };
  const res = createMockRes();
  await askQuestion(req, res);
  return res;
}

function validBody(question, qToken, readingToken, overrides = {}) {
  return {
    ...base,
    ...overrides,
    question,
    questionToken: qToken,
    readingToken
  };
}

function assertFocusedAnswer(answer, expectedTerms) {
  assert(answer && typeof answer === 'string', 'answer should be a string');
  assert(!/Regarding your question|themes of growth|observe the question rather than rush/i.test(answer), 'answer should not use old generic filler');
  for (const term of expectedTerms) {
    assert(new RegExp(term, 'i').test(answer), `answer should address ${term}: ${answer}`);
  }
}

async function testTokenSequence() {
  const readingToken = readingTokenFor(base);
  let qToken = questionToken.createInitialToken(readingToken, process.env.TOKEN_SECRET, base);

  const q1 = await post(validBody('When will I get the job?', qToken, readingToken));
  assert.strictEqual(q1.statusCode, 200, 'Q1 should succeed');
  assert.strictEqual(q1.body.success, true);
  assert.strictEqual(q1.body.questionsUsed, 1);
  assert.strictEqual(q1.body.remainingQuestions, 2);
  assert(q1.body.questionToken && q1.body.questionToken !== qToken, 'Q1 should return a new qToken');
  assert.strictEqual(questionToken.verify(q1.body.questionToken, process.env.TOKEN_SECRET).questionCount, 1);
  assertFocusedAnswer(q1.body.answer, ['career|job']);
  qToken = q1.body.questionToken;

  const q2 = await post(validBody('When will I get married?', qToken, readingToken));
  assert.strictEqual(q2.statusCode, 200, 'Q2 should succeed with refreshed qToken');
  assert.strictEqual(q2.body.questionsUsed, 2);
  assert.strictEqual(q2.body.remainingQuestions, 1);
  assert(q2.body.questionToken && q2.body.questionToken !== qToken, 'Q2 should return a new qToken');
  assert.strictEqual(questionToken.verify(q2.body.questionToken, process.env.TOKEN_SECRET).questionCount, 2);
  assertFocusedAnswer(q2.body.answer, ['marriage|partnership']);
  qToken = q2.body.questionToken;

  const q3 = await post(validBody('Will I move abroad?', qToken, readingToken));
  assert.strictEqual(q3.statusCode, 200, 'Q3 should succeed with refreshed qToken');
  assert.strictEqual(q3.body.questionsUsed, 3);
  assert.strictEqual(q3.body.remainingQuestions, 0);
  assert(q3.body.questionToken, 'Q3 should still return final signed qToken');
  assert.strictEqual(questionToken.verify(q3.body.questionToken, process.env.TOKEN_SECRET).questionCount, 3);
  assertFocusedAnswer(q3.body.answer, ['travel|relocation']);
  qToken = q3.body.questionToken;

  const q4 = await post(validBody('Can I ask one more?', qToken, readingToken));
  assert.strictEqual(q4.statusCode, 403, 'Q4 should be rejected server-side');
  assert.strictEqual(q4.body.success, false);
}

async function testClientCountIsIgnored() {
  const readingToken = readingTokenFor(base);
  let qToken = questionToken.createInitialToken(readingToken, process.env.TOKEN_SECRET, base);
  for (let i = 0; i < questionToken.MAX_QUESTIONS; i++) {
    const res = await post(validBody('Question ' + (i + 1), qToken, readingToken, { questionCount: 0 }));
    assert.strictEqual(res.statusCode, 200, 'question ' + (i + 1) + ' should succeed before max');
    qToken = res.body.questionToken;
  }
  const blocked = await post(validBody('Client tries to reset count', qToken, readingToken, { questionCount: 0 }));
  assert.strictEqual(blocked.statusCode, 403, 'client-side questionCount must not bypass signed max count');
}
async function testTokenFailures() {
  const readingToken = readingTokenFor(base);
  const qToken = questionToken.createInitialToken(readingToken, process.env.TOKEN_SECRET, base);

  const missing = await post(validBody('Will my relationship improve?', '', readingToken));
  assert.strictEqual(missing.statusCode, 403, 'missing qToken should be rejected');

  const invalid = await post(validBody('Will my relationship improve?', 'bad.token', readingToken));
  assert.strictEqual(invalid.statusCode, 403, 'invalid qToken should be rejected');

  const malformed = await post(validBody('', qToken, readingToken));
  assert.strictEqual(malformed.statusCode, 400, 'malformed question should be rejected');

  const missingReading = await post(validBody('Missing reading token?', qToken, ''));
  assert.strictEqual(missingReading.statusCode, 403, 'missing readingToken should be rejected');

  const substitutedReading = await post(validBody('Substituted reading token?', qToken, qToken));
  assert.strictEqual(substitutedReading.statusCode, 403, 'qToken cannot be substituted as readingToken');

  const otherBase = { ...base, name: 'Other User', orderId: 'order_other_question_flow_test' };
  const otherReadingToken = readingTokenFor(otherBase);
  const otherQToken = questionToken.createInitialToken(otherReadingToken, process.env.TOKEN_SECRET, otherBase);
  const wrongReading = await post(validBody('Wrong reading?', otherQToken, readingToken));
  assert.strictEqual(wrongReading.statusCode, 403, 'qToken from another reading should be rejected');

  const parts = qToken.split('.');
  const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  payload.maxQuestions = questionToken.MAX_QUESTIONS + 1;
  const tamperedBody = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const tamperedToken = tamperedBody + '.' + parts[1];
  const tampered = await post(validBody('Tampered token?', tamperedToken, readingToken));
  assert.strictEqual(tampered.statusCode, 403, 'modified qToken payload should be rejected');
}

async function testRepresentativeAnswers() {
  const readingToken = readingTokenFor(base);
  const cases = [
    ['When will I get the job?', ['career|job']],
    ['When will I get married?', ['marriage|partnership']],
    ['Will I move abroad?', ['travel|relocation']],
    ['Will my relationship improve?', ['love|relationship']],
    ['When will I meet someone?', ['love|relationship']],
    ['When will I lose my virginity?', ['intimacy|readiness|respect']]
  ];

  for (const [index, entry] of cases.entries()) {
    const question = entry[0];
    const terms = entry[1];
    const scopedBase = { ...base, orderId: base.orderId + '_answer_' + index };
    const scopedReadingToken = readingTokenFor(scopedBase);
    const qToken = questionToken.createInitialToken(scopedReadingToken, process.env.TOKEN_SECRET, scopedBase);
    const res = await post(validBody(question, qToken, scopedReadingToken, scopedBase));
    assert.strictEqual(res.statusCode, 200, question);
    assertFocusedAnswer(res.body.answer, terms);
    if (/when/i.test(question)) {
      assert(/cannot give a reliable date|cannot derive a trustworthy calendar period|does not support a precise date/i.test(res.body.answer), 'timing answer should be honest about unsupported timing');
    }
  }
}

async function testProviderFailureFallback() {
  const readingToken = readingTokenFor(base);
  const qToken = questionToken.createInitialToken(readingToken, process.env.TOKEN_SECRET, base);
  const originalGenerateAnswer = groqProvider.generateAnswer;
  process.env.AI_READING = 'true';
  process.env.GROQ_API_KEY = 'test-key';
  groqProvider.generateAnswer = async function () {
    throw new Error('simulated provider failure');
  };

  try {
    const res = await post(validBody('When will I get the job?', qToken, readingToken));
    assert.strictEqual(res.statusCode, 200, 'provider failure should return controlled fallback');
    assert.strictEqual(res.body.success, true);
    assertFocusedAnswer(res.body.answer, ['career|job']);
  } finally {
    groqProvider.generateAnswer = originalGenerateAnswer;
    process.env.AI_READING = 'false';
    delete process.env.GROQ_API_KEY;
  }
}

function testFrontendButtonRecoverySource() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'questions.js'), 'utf8');
  assert(source.includes('currentQuestionToken = res.body.questionToken'), 'frontend should replace qToken from server response');
  assert(source.includes('readingToken: currentReadingToken'), 'frontend should keep sending readingToken');
  assert(/else\s*{\s*resetSubmitButton\(\);\s*}/.test(source), 'success path with remaining questions should restore Ask button');
  assert(source.includes("submitBtn.textContent = 'All questions used'"), 'Q3 should disable and mark all questions used');
  assert(/\.catch\(function \(\) \{[\s\S]*resetSubmitButton\(\);/.test(source), 'failure path should restore Ask button');
  assert(source.includes("Unexpected server response. Please try again."), 'non-JSON responses should be controlled');
}

function testNoPersistentQuestionStore() {
  const askSource = fs.readFileSync(path.join(__dirname, '..', 'api', 'ask-question.js'), 'utf8');
  assert(!askSource.includes('questionReplayStore'), 'ask-question should not depend on persistent replay storage');
  assert(!fs.existsSync(path.join(__dirname, '..', 'lib', 'questionReplayStore.js')), 'questionReplayStore.js should not exist in database-free architecture');
}


async function run() {
  await testTokenSequence();
  await testClientCountIsIgnored();
  await testTokenFailures();
  await testRepresentativeAnswers();
  await testProviderFailureFallback();
  testFrontendButtonRecoverySource();
  testNoPersistentQuestionStore();
  console.log('✅ question flow tests passed');
}

run().catch((err) => {
  console.error('❌ question flow tests failed');
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
