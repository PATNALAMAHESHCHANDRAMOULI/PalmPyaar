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
const OpenAI = require('openai');

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

function tamperQuestionCount(qToken, newCount) {
  const parts = qToken.split('.');
  const payload = questionToken.decode(parts[0]);
  payload.questionCount = newCount;
  const tamperedBody = questionToken.encode(payload);
  return tamperedBody + '.' + parts[1];
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
  const initialPayload = questionToken.verify(qToken, process.env.TOKEN_SECRET);
  assert(initialPayload, 'initial qToken should verify');
  assert.strictEqual(initialPayload.questionCount, 0, 'initial qToken should start at count 0');
  assert.strictEqual(initialPayload.maxQuestions, 3, 'initial qToken should encode maxQuestions 3');
  assert.deepStrictEqual(initialPayload.questions, [], 'initial qToken should have no answered questions');

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
  assert.strictEqual(q4.body.questionsUsed, 3);
  assert.strictEqual(q4.body.maxQuestions, 3);
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
async function testBrowserSuppliedCountsIgnored() {
  const readingToken = readingTokenFor(base);
  const qToken = questionToken.createInitialToken(readingToken, process.env.TOKEN_SECRET, base);
  const res = await post(validBody('When will I get the job?', qToken, readingToken, {
    questionCount: 999,
    remainingQuestions: 999,
    maxQuestions: 999
  }));

  assert.strictEqual(res.statusCode, 200, 'server should ignore browser-supplied count fields');
  assert.strictEqual(res.body.questionsUsed, 1, 'questionsUsed should come from signed qToken count 0');
  assert.strictEqual(res.body.remainingQuestions, 2, 'remainingQuestions should come from signed qToken count 0');
  assert.strictEqual(res.body.maxQuestions, 3, 'maxQuestions should come from server constant');
  assert.strictEqual(questionToken.verify(res.body.questionToken, process.env.TOKEN_SECRET).questionCount, 1);
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
  assert.strictEqual(questionToken.verify(tamperedToken, process.env.TOKEN_SECRET), null, 'modified qToken should fail HMAC verification');
  const tampered = await post(validBody('Tampered token?', tamperedToken, readingToken));
  assert.strictEqual(tampered.statusCode, 403, 'modified qToken payload should be rejected');

  const countTampered = tamperQuestionCount(qToken, 2);
  const countTamperedRes = await post(validBody('Count-tampered token?', countTampered, readingToken));
  assert.strictEqual(countTamperedRes.statusCode, 403, 'tampered questionCount should be rejected by API');

  const modifiedReading = await post(validBody('Modified reading token?', qToken, 'b'.repeat(64)));
  assert.strictEqual(modifiedReading.statusCode, 403, 'modified readingToken should be rejected');
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
      assert(/\b(19|20)\d{2}\b/.test(res.body.answer), 'timing answer should include a derived calendar window');
      assert(!/cannot give a reliable date|cannot derive a trustworthy calendar period|does not support a precise date/i.test(res.body.answer), 'timing answer should not use weak fallback language');
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

async function testGenerateAnswerContentHandling() {
  const client = new OpenAI({ apiKey: 'test-key' });
  const completionsProto = Object.getPrototypeOf(client.chat.completions);
  const originalCreate = completionsProto.create;

  process.env.GROQ_API_KEY = 'test-key';

  const answerParams = {
    question: 'When will I get the job?',
    dob: base.dob,
    birthTime: base.birthTime,
    tradition: base.tradition,
    astrologyData: null,
    questionIntent: { topic: 'career/job', timing: true }
  };

  try {
    completionsProto.create = async function () {
      return {
        choices: [{ message: { content: '<p class="reading-paragraph">Mock non-empty Groq answer.</p>' }, finish_reason: 'stop' }],
        usage: { completion_tokens: 42 }
      };
    };
    const nonEmptyResult = await groqProvider.generateAnswer(answerParams);
    assert.strictEqual(nonEmptyResult.answer, '<p class="reading-paragraph">Mock non-empty Groq answer.</p>', 'non-empty content should be returned as-is');

    completionsProto.create = async function () {
      return {
        choices: [{ message: { content: '' }, finish_reason: 'length' }],
        usage: { completion_tokens: 1500 }
      };
    };
    const emptyResult = await groqProvider.generateAnswer(answerParams);
    assert.strictEqual(
      emptyResult.answer,
      'Answer generation is temporarily unavailable. Please try again in a moment.',
      'empty content should fall back to the safe technical message'
    );
  } finally {
    completionsProto.create = originalCreate;
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

async function testFrontendRefreshPersistence() {
  const questionsUi = require('../js/questions.js');
  const readingToken = readingTokenFor(base);
  const urlToken = questionToken.createInitialToken(readingToken, process.env.TOKEN_SECRET, base);

  assert.strictEqual(questionsUi.chooseEffectiveToken(urlToken, ''), urlToken, 'missing storage should fall back to URL token');
  const initialPayload = questionsUi.decodeQuestionTokenPayload(urlToken);
  assert.strictEqual(initialPayload.questionCount, 0, 'initial URL token should decode to count 0');

  const q1 = await post(validBody('When will I get the job?', urlToken, readingToken));
  assert.strictEqual(q1.statusCode, 200);
  const afterQ1Token = q1.body.questionToken;

  // Refresh simulation: the URL still carries the ORIGINAL (count 0) token,
  // exactly as reported in the bug. Storage now holds the Q1 (count 1) token.
  const effectiveAfterQ1 = questionsUi.chooseEffectiveToken(urlToken, afterQ1Token);
  assert.strictEqual(effectiveAfterQ1, afterQ1Token, 'refresh after Q1 must restore the Q1 token, not the original URL token');
  assert.strictEqual(questionsUi.decodeQuestionTokenPayload(effectiveAfterQ1).questionCount, 1);

  const q2 = await post(validBody('When will I get married?', afterQ1Token, readingToken));
  assert.strictEqual(q2.statusCode, 200);
  const afterQ2Token = q2.body.questionToken;
  const effectiveAfterQ2 = questionsUi.chooseEffectiveToken(urlToken, afterQ2Token);
  assert.strictEqual(effectiveAfterQ2, afterQ2Token, 'refresh after Q2 must restore the Q2 token');
  assert.strictEqual(questionsUi.decodeQuestionTokenPayload(effectiveAfterQ2).questionCount, 2);

  const q3 = await post(validBody('Will I move abroad?', afterQ2Token, readingToken));
  assert.strictEqual(q3.statusCode, 200);
  const afterQ3Token = q3.body.questionToken;
  const effectiveAfterQ3 = questionsUi.chooseEffectiveToken(urlToken, afterQ3Token);
  assert.strictEqual(effectiveAfterQ3, afterQ3Token, 'refresh after Q3 must restore the Q3 (exhausted) token');
  const finalPayload = questionsUi.decodeQuestionTokenPayload(effectiveAfterQ3);
  assert.strictEqual(finalPayload.questionCount, 3);
  assert.strictEqual(finalPayload.questions.length, 3, 'restored token must carry full Q&A history for UI restore');

  const q4AfterRefresh = await post(validBody('Can I ask one more?', effectiveAfterQ3, readingToken));
  assert.strictEqual(q4AfterRefresh.statusCode, 403, 'server must still reject Q4 after a refresh-restored exhausted token');
}

function testReadingIsolationStorage() {
  const questionsUi = require('../js/questions.js');
  const baseA = { ...base, orderId: 'order_reading_A' };
  const baseB = { ...base, orderId: 'order_reading_B' };
  const readingTokenA = readingTokenFor(baseA);
  const readingTokenB = readingTokenFor(baseB);

  const keyA = questionsUi.deriveStorageKey('order_reading_A', readingTokenA);
  const keyB = questionsUi.deriveStorageKey('order_reading_B', readingTokenB);
  assert.notStrictEqual(keyA, keyB, 'different readings must use different storage keys');

  const tokenA = questionToken.createInitialToken(readingTokenA, process.env.TOKEN_SECRET, baseA);
  const tokenAAfterQ = questionToken.issueNextToken(
    questionToken.verify(tokenA, process.env.TOKEN_SECRET),
    process.env.TOKEN_SECRET,
    'Some question?',
    'Some answer.'
  );
  const tokenB = questionToken.createInitialToken(readingTokenB, process.env.TOKEN_SECRET, baseB);

  // A stored token for reading A must never be selected as the effective
  // token for reading B's URL token, even if a storage key collision were
  // to somehow occur.
  const effective = questionsUi.chooseEffectiveToken(tokenB, tokenAAfterQ);
  assert.strictEqual(effective, tokenB, 'a stored token for a different reading must never be used');
}

function testMissingStorageFallsBackToUrlToken() {
  const questionsUi = require('../js/questions.js');
  const readingToken = readingTokenFor(base);
  const urlToken = questionToken.createInitialToken(readingToken, process.env.TOKEN_SECRET, base);

  assert.strictEqual(questionsUi.chooseEffectiveToken(urlToken, ''), urlToken);
  assert.strictEqual(questionsUi.chooseEffectiveToken(urlToken, null), urlToken);
  assert.strictEqual(questionsUi.chooseEffectiveToken(urlToken, undefined), urlToken);
  assert.strictEqual(questionsUi.chooseEffectiveToken(urlToken, 'not-a-real-token'), urlToken, 'corrupt stored value must fall back to URL token');
}

async function testInvalidStoredTokenDoesNotBypassServer() {
  const questionsUi = require('../js/questions.js');
  const readingToken = readingTokenFor(base);
  const urlToken = questionToken.createInitialToken(readingToken, process.env.TOKEN_SECRET, base);

  // Simulate a tampered localStorage value: same shape, forged count,
  // re-signed with a secret the attacker does not actually have — the
  // server always uses the real TOKEN_SECRET, so this signature can never
  // verify there, even though the frontend cannot detect the forgery by
  // decoding alone (it has no access to TOKEN_SECRET to verify with).
  const forgedPayload = questionToken.decode(urlToken.split('.')[0]);
  forgedPayload.questionCount = 0;
  const forgedToken = questionToken.sign(forgedPayload, 'attacker-guessed-secret');

  const chosen = questionsUi.chooseEffectiveToken(urlToken, forgedToken);
  assert.strictEqual(chosen, forgedToken, 'frontend cannot detect a forged signature by decoding alone');

  const res = await post(validBody('Attempting to bypass with a forged stored token?', chosen, readingToken));
  assert.strictEqual(res.statusCode, 403, 'server must reject a forged/tampered stored token regardless of frontend choice');
}

function testNoPersistentQuestionStore() {
  const askSource = fs.readFileSync(path.join(__dirname, '..', 'api', 'ask-question.js'), 'utf8');
  assert(!askSource.includes('questionReplayStore'), 'ask-question should not depend on persistent replay storage');
  assert(!fs.existsSync(path.join(__dirname, '..', 'lib', 'questionReplayStore.js')), 'questionReplayStore.js should not exist in database-free architecture');
}


async function run() {
  await testTokenSequence();
  await testClientCountIsIgnored();
  await testBrowserSuppliedCountsIgnored();
  await testTokenFailures();
  await testRepresentativeAnswers();
  await testProviderFailureFallback();
  await testGenerateAnswerContentHandling();
  await testFrontendRefreshPersistence();
  testReadingIsolationStorage();
  testMissingStorageFallsBackToUrlToken();
  await testInvalidStoredTokenDoesNotBypassServer();
  testFrontendButtonRecoverySource();
  testNoPersistentQuestionStore();
  console.log('✅ question flow tests passed');
}

run().catch((err) => {
  console.error('❌ question flow tests failed');
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
