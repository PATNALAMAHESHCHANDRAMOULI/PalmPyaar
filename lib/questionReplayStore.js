/*
 * PalmPyaar Question Replay Store
 *
 * HMAC question tokens are tamper-evident but not one-time-use by themselves.
 * This store records the latest valid question token hash for each reading token
 * and atomically advances it when a question is accepted.
 *
 * Production/serverless: uses Vercel KV / Upstash Redis REST when configured via
 * KV_REST_API_URL + KV_REST_API_TOKEN or UPSTASH_REDIS_REST_URL +
 * UPSTASH_REDIS_REST_TOKEN. Without persistent KV in production, it fails closed.
 *
 * Local/tests: uses an in-memory Map when QUESTION_REPLAY_STORE=memory or when
 * NODE_ENV is not production. This is not cross-instance and is not production
 * replay protection.
 */
'use strict';

const crypto = require('crypto');

const memoryLatestByReading = new Map();

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function keyForReading(readingToken) {
  return 'palmpyaar:question-replay:' + sha256(readingToken);
}

function getKvConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
  if (!url || !token) return null;
  return {
    url: url.replace(/\/+$/, ''),
    token
  };
}

function shouldUseMemory() {
  return process.env.QUESTION_REPLAY_STORE === 'memory' || process.env.NODE_ENV !== 'production';
}

function normalizeKvResult(json) {
  if (!json || typeof json !== 'object') return null;
  if (Array.isArray(json.result)) return json.result;
  if (Array.isArray(json)) return json;
  return null;
}

async function consumeWithKv(config, readingToken, currentToken, nextToken, questionCount) {
  const currentHash = sha256(currentToken);
  const nextHash = sha256(nextToken);
  const key = keyForReading(readingToken);
  const script = [
    'local current = redis.call("GET", KEYS[1])',
    'if not current then',
    '  if ARGV[2] ~= "0" then return {0, "missing_state"} end',
    '  redis.call("SET", KEYS[1], ARGV[1])',
    '  return {1, "accepted_initial"}',
    'end',
    'if current ~= ARGV[3] then return {0, "replay"} end',
    'redis.call("SET", KEYS[1], ARGV[1])',
    'return {1, "accepted"}'
  ].join('\n');

  const response = await fetch(config.url + '/eval', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + config.token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify([script, 1, key, nextHash, String(questionCount), currentHash])
  });

  if (!response.ok) {
    return {
      ok: false,
      status: 503,
      error: 'Question entitlement store is unavailable. Please try again.'
    };
  }

  const json = await response.json();
  const result = normalizeKvResult(json);
  if (result && Number(result[0]) === 1) {
    return { ok: true, reason: String(result[1] || 'accepted') };
  }

  return {
    ok: false,
    status: 409,
    error: 'This question token has already been used. Please refresh your result link and try again.',
    reason: result ? String(result[1] || 'replay') : 'invalid_store_response'
  };
}

function consumeWithMemory(readingToken, currentToken, nextToken, questionCount) {
  const currentHash = sha256(currentToken);
  const nextHash = sha256(nextToken);
  const key = keyForReading(readingToken);
  const latestHash = memoryLatestByReading.get(key);

  if (!latestHash) {
    if (questionCount !== 0) {
      return {
        ok: false,
        status: 409,
        error: 'This question token is not current for this reading.',
        reason: 'missing_state'
      };
    }
    memoryLatestByReading.set(key, nextHash);
    return { ok: true, reason: 'accepted_initial_memory' };
  }

  if (latestHash !== currentHash) {
    return {
      ok: false,
      status: 409,
      error: 'This question token has already been used. Please refresh your result link and try again.',
      reason: 'replay_memory'
    };
  }

  memoryLatestByReading.set(key, nextHash);
  return { ok: true, reason: 'accepted_memory' };
}

async function consumeQuestionToken({ readingToken, currentToken, nextToken, questionCount }) {
  if (!readingToken || !currentToken || !nextToken || !Number.isInteger(questionCount)) {
    return {
      ok: false,
      status: 500,
      error: 'Question entitlement state could not be updated.'
    };
  }

  const config = getKvConfig();
  if (config) {
    return consumeWithKv(config, readingToken, currentToken, nextToken, questionCount);
  }

  if (shouldUseMemory()) {
    return consumeWithMemory(readingToken, currentToken, nextToken, questionCount);
  }

  return {
    ok: false,
    status: 503,
    error: 'Question entitlement store is not configured. Please try again later.',
    reason: 'missing_persistent_store'
  };
}

function resetMemoryStore() {
  memoryLatestByReading.clear();
}

module.exports = {
  consumeQuestionToken,
  resetMemoryStore,
  _internal: {
    keyForReading,
    sha256,
    shouldUseMemory,
    getKvConfig
  }
};
