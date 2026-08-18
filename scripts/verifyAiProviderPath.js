/**
 * PalmPyaar Phase 0B — AI Provider Path + Environment Verification
 *
 * Verifies the REAL request path without spending quota:
 *   AI_READING -> provider selection -> groqProvider -> readingPipeline
 *   -> assembled PalmPyaar prompt -> Groq Chat Completions (local mock server)
 *
 * Tests:
 *   T1   AI_READING=true selects the Groq provider (real handler + mock server)
 *   T2   The intended model is passed to the provider request
 *   T3   The assembled PalmPyaar prompt reaches the provider
 *   T4   Missing API key produces a controlled, labeled failure (no throw, no secret)
 *   T5   Provider/network failure produces a controlled, labeled failure
 *   T6   Malformed provider response is rejected safely (labeled fallback, no crash)
 *   T7   No API secret appears anywhere in client-side/static files
 *   T8   Production config never silently uses the template provider (fallback is labeled)
 *   T9-T12  Existing regression suites still pass
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DEFAULT_MODEL = 'openai/gpt-oss-120b';

let passed = 0;
let failed = 0;

function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { console.log('PASS: ' + name); passed++; })
    .catch((err) => { console.log('FAIL: ' + name + ' -> ' + (err && err.message ? err.message : err)); failed++; });
}

function assertTrue(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

// ---------------------------------------------------------------------------
// Local mock Groq server (OpenAI-compatible /chat/completions)
// ---------------------------------------------------------------------------

function startMock(mode) {
  const requests = [];

  const server = http.createServer((req, res) => {
    if (req.url === '/chat/completions' && req.method === 'POST') {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        let body = null;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { body = null; }

        const allText = body && body.messages
          ? body.messages.map((m) => String(m.content || '')).join('\n') : '';

        let type = 'writer';
        if (allText.includes('REWRITE INSTRUCTIONS')) type = 'rewriter';
        else if (allText.includes('EVALUATION CRITERIA')) type = 'reviewer';

        requests.push({ type, body });

        let content;
        if (type === 'reviewer') {
          content = 'STRENGTHS\n- Clear structure.\nWEAKNESSES\n- Sections are short.\nREWRITE ADVICE\n- Expand each section.\nOVERALL VERDICT\n7/10';
        } else if (mode === 'malformed') {
          content = 'This response contains no section markers whatsoever.';
        } else if (type === 'rewriter') {
          content = '===CORE===\n<p>Mock rewriter core reading for Test User.</p>\n===LOVE===\n<p>Mock rewriter love reading.</p>\n===PRO===\n<p>Mock rewriter pro reading.</p>';
        } else {
          content = '===CORE===\n<p>Mock writer core reading for Test User.</p>\n===LOVE===\n<p>Mock writer love reading.</p>\n===PRO===\n<p>Mock writer pro reading.</p>';
        }

        const payload = {
          id: 'chatcmpl-mock-' + type,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: (body && body.model) || DEFAULT_MODEL,
          choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 }
        };

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const url = 'http://127.0.0.1:' + server.address().port;
      resolve({ url, requests, close: () => { try { server.closeAllConnections(); } catch (e) {} return new Promise((r) => server.close(r)); } });
    });
  });
}

// ---------------------------------------------------------------------------
// Handler invocation helpers
// ---------------------------------------------------------------------------

const handler = require('../api/generate-reading');

function makeReqRes(method, query) {
  const res = {
    _json: null, statusCode: 0,
    setHeader() {},
    status(code) { res.statusCode = code; return res; },
    json(obj) { res._json = obj; return res; }
  };
  return [{ method, query: query || {} }, res];
}

async function invokeHandler(query) {
  const [req, res] = makeReqRes('GET', query);
  await handler(req, res);
  return res;
}

const VALID_QUERY = {
  name: 'Test User',
  dob: '1990-05-15',
  birthplace: 'Pune',
  tradition: 'western',
  photoHash: '',
  orderId: 'ord123'
};

// ---------------------------------------------------------------------------
// Client-side secret scan
// ---------------------------------------------------------------------------

function scanClientFilesForSecrets() {
  const dirs = ['js', 'css', 'content'];
  const files = ['index.html', 'result.html'];
  const patterns = [
    /GROQ_API_KEY|GEMINI_API_KEY|XAI_API_KEY|AI_READING\s*=/,
    /gsk_[A-Za-z0-9]{16,}/,
    /sk-[A-Za-z0-9]{16,}/,
    /rzp_(live|test)_[A-Za-z0-9]{16,}/,
    /process\.env/
  ];
  const hits = [];

  for (const dir of dirs) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs)) {
      if (!/\.[a-z]+$/i.test(f)) continue;
      const p = path.join(abs, f);
      if (fs.statSync(p).isFile()) files.push(path.relative(ROOT, p));
    }
  }

  for (const f of files) {
    const abs = path.join(ROOT, f);
    if (!fs.existsSync(abs)) continue;
    const text = fs.readFileSync(abs, 'utf8');
    for (const p of patterns) {
      if (p.test(text)) hits.push(f + ' matched ' + p);
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Regression suites
// ---------------------------------------------------------------------------

function runSuite(script) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'scripts', script)], {
      cwd: ROOT, env: { ...process.env, NODE_ENV: 'production' }
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { out += d.toString(); });
    child.on('close', (code) => resolve({ code, out }));
    child.on('error', (e) => resolve({ code: -1, out: 'spawn error: ' + e.message }));
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

(async () => {
  process.env.NODE_ENV = 'development';
  process.env.DEV_BYPASS = 'true';
  process.env.TOKEN_SECRET = 'phase0b-test-secret-abc';

  let mock = null;

  // ---- T1-T3: AI_READING=true selects Groq; model + assembled prompt reach it ----
  try {
    mock = await startMock('ok');
    process.env.AI_READING = 'true';
    process.env.GROQ_API_KEY = 'gsk_test_mock';
    process.env.GROQ_BASE_URL = mock.url;
    delete process.env.GROQ_MODEL;

    const res = await invokeHandler({ ...VALID_QUERY });

    await check('T1: AI_READING=true selects the Groq provider (real handler reached the mock)', () => {
      assertTrue(res._json && res._json.success === true, 'handler failed: ' + JSON.stringify(res._json));
      assertTrue(res._json.reading.core && res._json.reading.love && res._json.reading.pro, 'missing reading sections');
      assertTrue(res._json.aiGenerated === true, 'aiGenerated not true: ' + JSON.stringify(res._json));
      assertTrue(res._json.provider === 'groq', 'provider field wrong: ' + res._json.provider);
      assertTrue(mock.requests.some((r) => r.type === 'writer'), 'no writer request reached the mock (provider NOT selected)');
    });

    await check('T2: intended model is passed to the provider (openai/gpt-oss-120b)', () => {
      const writer = mock.requests.find((r) => r.type === 'writer');
      assertTrue(!!writer, 'no writer request');
      assertTrue(writer.body.model === DEFAULT_MODEL, 'model was ' + writer.body.model);
    });

    await check('T3: assembled PalmPyaar prompt reaches the provider', () => {
      const writer = mock.requests.find((r) => r.type === 'writer');
      assertTrue(!!writer, 'no writer request');
      const text = writer.body.messages.map((m) => String(m.content || '')).join('\n');
      assertTrue(text.includes('You are PalmPyaar'), 'system identity missing');
      assertTrue(text.includes('INTERNAL REASONING PLAN'), 'reasoning plan missing');
      assertTrue(text.includes('Selected Opening:'), 'selected opening missing');
    });
  } finally {
    if (mock) { try { await mock.close(); } catch (e) {} mock = null; }
  }

  // ---- T4: missing API key ----
  await check('T4: missing API key produces a controlled labeled failure', async () => {
    const groqProvider = require('../providers/groqProvider');
    delete process.env.GROQ_API_KEY;
    const r = await groqProvider.generateReading({ name: 'Test User', dob: '1990-05-15', birthplace: 'Pune', tradition: 'western' });
    assertTrue(r.core && r.love && r.pro, 'no sections returned');
    assertTrue(r.aiGenerated === false, 'fallback not labeled template');
    assertTrue(r.reason === 'missing_api_key', 'reason was ' + r.reason);
    assertTrue(JSON.stringify(r).indexOf('gsk_') === -1, 'secret leaked');
  });

  // ---- T5: provider failure ----
  await check('T5: provider/network failure produces a controlled labeled failure', async () => {
    const groqProvider = require('../providers/groqProvider');
    process.env.GROQ_API_KEY = 'gsk_test_mock';
    process.env.GROQ_BASE_URL = 'http://127.0.0.1:1'; // nothing listens here
    const r = await groqProvider.generateReading({ name: 'Test User', dob: '1990-05-15', birthplace: 'Pune', tradition: 'western' });
    assertTrue(r.core && r.love && r.pro, 'no sections returned');
    assertTrue(r.aiGenerated === false, 'fallback not labeled template');
    assertTrue(r.reason === 'provider_error', 'reason was ' + r.reason);
  });

  // ---- T6: malformed provider response ----
  try {
    mock = await startMock('malformed');
    process.env.GROQ_BASE_URL = mock.url;

    await check('T6: malformed provider response is rejected safely (labeled fallback)', async () => {
      const groqProvider = require('../providers/groqProvider');
      process.env.GROQ_API_KEY = 'gsk_test_mock';
      const r = await groqProvider.generateReading({ name: 'Test User', dob: '1990-05-15', birthplace: 'Pune', tradition: 'western' });
      assertTrue(r.core && r.love && r.pro, 'no sections returned');
      assertTrue(r.aiGenerated === false, 'malformed output was not labeled as fallback');
      assertTrue(!!r.reason, 'no reason recorded');
    });
  } finally {
    if (mock) { try { await mock.close(); } catch (e) {} mock = null; }
  }

  // ---- T7: client-side secret scan ----
  await check('T7: no API secret or AI env reference in client-side/static files', () => {
    const hits = scanClientFilesForSecrets();
    assertTrue(hits.length === 0, 'secret-like patterns found: ' + JSON.stringify(hits.slice(0, 5)));
  });

  // ---- T7b: refund policy page removed ----
  await check('T7b: refund-policy.html has been removed (no user-facing refund policy page)', () => {
    assertTrue(!fs.existsSync(path.join(ROOT, 'refund-policy.html')), 'refund-policy.html must not exist');
  });

  // ---- T8: production AI config does not silently use template ----
  try {
    mock = await startMock('ok');
    process.env.AI_READING = 'true';
    process.env.GROQ_API_KEY = 'gsk_test_mock';
    process.env.GROQ_BASE_URL = mock.url;
    const okRes = await invokeHandler({ ...VALID_QUERY });
    await check('T8a: healthy AI path is explicitly labeled aiGenerated=true', () => {
      assertTrue(okRes._json.aiGenerated === true, 'aiGenerated not true');
      assertTrue(okRes._json.reading.aiGenerated === true, 'reading metadata missing');
    });

    process.env.GROQ_BASE_URL = 'http://127.0.0.1:1';
    const failRes = await invokeHandler({ ...VALID_QUERY });
    await check('T8b: failed AI path returns explicit labeled fallback (never silent template-as-AI)', () => {
      assertTrue(failRes._json.success === true, 'handler errored: ' + JSON.stringify(failRes._json));
      assertTrue(failRes._json.aiGenerated === false, 'failed AI path hid the fallback');
      assertTrue(!!failRes._json.reading.reason, 'no fallback reason exposed');
    });
  } finally {
    if (mock) { try { await mock.close(); } catch (e) {} mock = null; }
    delete process.env.AI_READING;
    delete process.env.GROQ_API_KEY;
    delete process.env.GROQ_BASE_URL;
    delete process.env.GROQ_MODEL;
  }

  // ---- T9-T12: regression suites ----
  const suites = [
    ['testPipelineIntegration.js'],
    ['verifyProductionPath.js'],
    ['testPalmEvidenceIntegrity.js'],
    ['testOpeningLibrary.js']
  ];

  for (const [script] of suites) {
    await check('Regression: ' + script, async () => {
      const r = await runSuite(script);
      assertTrue(r.code === 0, script + ' exited ' + r.code + '\n' + r.out.slice(-800));
    });
  }

  console.log('\n=== SUMMARY ===');
  console.log('Passed: ' + passed);
  console.log('Failed: ' + failed);
  process.exit(failed === 0 ? 0 : 1);
})().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
