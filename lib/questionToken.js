/**
 * PalmPyaar Question Entitlement Token
 *
 * Stateless, server-signed HMAC token that tracks how many post-payment
 * questions a customer has used. Each paid reading starts with 3 questions.
 *
 * The token binds:
 *   - readingToken: The HMAC reading token from verify-razorpay.js (proves payment)
 *   - questionCount: How many questions have been used (0, 1, 2, or 3)
 *   - questions: Array of { text, answer } pairs that have been answered
 *   - maxQuestions: 3
 *
 * Format:
 *   <base64url(JSON payload)>.<hex HMAC-SHA256>
 *   HMAC key  = TOKEN_SECRET (server-side only)
 *   HMAC msg  = DOMAIN_Q + "." + base64url(payload)
 *
 * Domain separation ensures the question token signature can never collide
 * with the reading-token HMAC in generate-reading.js or the state token in
 * stateToken.js.
 *
 * Security:
 * - Token is verified server-side using timing-safe comparison.
 * - The readingToken inside the question token is re-verified against
 *   the same HMAC as generate-reading.js to ensure it's still valid.
 * - questionCount is a server-signed integer; the frontend can never
 *   fabricate additional questions.
 * - questions array is signed; tampering invalidates the token.
 */

'use strict';

const crypto = require('crypto');

const MAX_QUESTIONS = 3;
const DOMAIN = 'palmpyaar-question-token-v1';

/**
 * Encode a payload object as base64url.
 * @param {object} payload
 * @returns {string}
 */
function encode(payload) {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/**
 * Decode a base64url payload.
 * @param {string} body
 * @returns {object}
 */
function decode(body) {
  return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
}

/**
 * Sign a question token payload.
 * @param {object} payload - Token payload
 * @param {string} secret - TOKEN_SECRET
 * @returns {string} Signed token string
 */
function sign(payload, secret) {
  const body = encode(payload);
  const sig = crypto.createHmac('sha256', String(secret))
    .update(DOMAIN + '.' + body)
    .digest('hex');
  return body + '.' + sig;
}

/**
 * Verify a question token. Returns the payload or null.
 * @param {string} token - Token to verify
 * @param {string} secret - TOKEN_SECRET
 * @returns {object|null} Payload or null if invalid
 */
function verify(token, secret) {
  if (typeof token !== 'string' || typeof secret !== 'string' || !secret) {
    return null;
  }

  const idx = token.lastIndexOf('.');
  if (idx <= 0 || idx === token.length - 1) return null;

  const body = token.slice(0, idx);
  const sig = token.slice(idx + 1);

  if (!/^[0-9a-f]{64}$/i.test(sig)) return null;

  const expected = crypto.createHmac('sha256', secret)
    .update(DOMAIN + '.' + body)
    .digest('hex');

  const a = Buffer.from(sig, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let payload;
  try {
    payload = decode(body);
  } catch (err) {
    return null;
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  if (!payload.readingToken || typeof payload.readingToken !== 'string') return null;
  if (!Number.isInteger(payload.questionCount) || payload.questionCount < 0) return null;
  if (!Array.isArray(payload.questions)) return null;
  if (payload.maxQuestions !== MAX_QUESTIONS) return null;

  return payload;
}

/**
 * Create the initial question token after payment verification.
 * @param {string} readingToken - The HMAC reading token from verify-razorpay
 * @param {string} secret - TOKEN_SECRET
 * @param {object} [readingData] - Optional reading data for context
 * @returns {string} Signed question token
 */
function createInitialToken(readingToken, secret, readingData) {
  const payload = {
    readingToken: readingToken,
    questionCount: 0,
    maxQuestions: MAX_QUESTIONS,
    questions: [],
    readingData: readingData || null
  };
  return sign(payload, secret);
}

/**
 * Issue a new question token with an incremented question count and
 * the new question/answer pair appended. Called after a question is answered.
 * @param {object} payload - The verified token payload
 * @param {string} secret - TOKEN_SECRET
 * @param {string} questionText - The question that was asked
 * @param {string} answerText - The answer that was generated
 * @returns {string|null} New signed token, or null if max questions exceeded
 */
function issueNextToken(payload, secret, questionText, answerText) {
  if (payload.questionCount >= MAX_QUESTIONS) return null;

  const newQuestions = payload.questions.slice();
  newQuestions.push({
    text: String(questionText || '').slice(0, 500),
    answer: String(answerText || '').slice(0, 5000)
  });

  const newPayload = {
    readingToken: payload.readingToken,
    questionCount: payload.questionCount + 1,
    maxQuestions: MAX_QUESTIONS,
    questions: newQuestions,
    readingData: payload.readingData || null
  };

  return sign(newPayload, secret);
}

/**
 * Check if a question token has remaining questions.
 * @param {object} payload - Verified token payload
 * @returns {boolean}
 */
function hasQuestionsRemaining(payload) {
  if (!payload) return false;
  return payload.questionCount < MAX_QUESTIONS;
}

/**
 * Get the remaining question count.
 * @param {object} payload - Verified token payload
 * @returns {number}
 */
function getRemainingCount(payload) {
  if (!payload) return 0;
  return Math.max(0, MAX_QUESTIONS - payload.questionCount);
}

module.exports = {
  sign,
  verify,
  encode,
  decode,
  MAX_QUESTIONS,
  DOMAIN,
  createInitialToken,
  issueNextToken,
  hasQuestionsRemaining,
  getRemainingCount
};
