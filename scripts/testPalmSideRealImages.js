/**
 * PalmPyaar — palm-side visual detection regression suite (REAL images).
 *
 * SCOPE: end-to-end proof on real local photos using the UNMODIFIED
 * production js/palmValidator.js validateImage() inside headless Edge with
 * real MediaPipe, kept separate from the synthetic suite
 * (scripts/testPalmSideDetection.js). This is the suite that proves actual
 * recognition behavior:
 *
 *   A  known back-of-hand photo        -> rejected specifically as back_of_hand
 *   B  known valid palm photos         -> accepted (with palmEvidence)
 *   C  dorsal with thumb inside frame  -> still rejected as back_of_hand
 *      (padded variant + independent MediaPipe margin pass proving every
 *      landmark is inside the frame, so cropping cannot be the reason)
 *   F  known cropped photo             -> still rejected as cropped
 *
 * Images default to the development environment's local photo set
 * (PPALM_TEST_IMAGES_DIR overrides). Nothing is uploaded anywhere: files
 * only travel localhost -> headless Edge.
 *
 * Environment failures (images/Edge/network/MediaPipe unavailable) SKIP
 * with exit 0 and a prominent note. A pipeline that RAN but returned the
 * wrong verdict FAILS with exit 1.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PV_PATH = path.join(ROOT, 'js', 'palmValidator.js');
const MEDIAPIPE_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4/';
const IMAGES_DIR = process.env.PPALM_TEST_IMAGES_DIR || 'C:\\Users\\Mahesh\\Downloads';
const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];
const CDP_PORT = 9500 + (process.pid % 400);
const CASE_TIMEOUT_MS = 120000;

const CASES = [
  {
    id: 'dorsal',
    file: 'WhatsApp Image 2026-10-06 at 15.18.34.jpeg',
    expect: { ok: false, problem: 'back_of_hand' },
    why: '[req A] known back-of-hand photo must be rejected as back_of_hand'
  },
  {
    id: 'dorsal_padded',
    file: 'WhatsApp Image 2026-10-06 at 15.18.34.jpeg',
    pad: true,
    expect: { ok: false, problem: 'back_of_hand', minMargin: 0.01 },
    why: '[req C] dorsal with thumb fully inside frame still back_of_hand'
  },
  {
    id: 'palm_aug_a',
    file: 'WhatsApp Image 2026-08-12 at 20.53.26.jpeg',
    expect: { ok: true },
    why: '[req B] known valid palm photo accepted'
  },
  {
    id: 'palm_aug_b',
    file: 'WhatsApp Image 2026-08-12 at 20.53.53.jpeg',
    expect: { ok: true },
    why: '[req B] known valid palm photo accepted'
  },
  {
    id: 'palm_oct',
    file: 'WhatsApp Image 2026-10-06 at 15.17.02.jpeg',
    expect: { ok: true },
    why: '[req B] known valid palm photo accepted'
  },
  {
    id: 'cropped_invalid',
    file: 'WhatsApp Image 2026-08-05 at 14.47.43.jpeg',
    expect: { ok: false, problem: 'cropped' },
    why: '[req F] existing cropped photo still rejected as cropped'
  }
];

let passed = 0;
let failed = 0;

function pass(msg) {
  console.log('PASS: ' + msg);
  passed++;
}

function fail(msg) {
  console.log('FAIL: ' + msg);
  failed++;
}

function skipAll(reason) {
  console.log('================================================================');
  console.log('SKIP (environment): ' + reason);
  console.log('Real-photo side detection did NOT run here. Run on a machine');
  console.log('with the photo set + headless Edge + network, or set');
  console.log('PPALM_TEST_IMAGES_DIR to the photo directory.');
  console.log('================================================================');
  process.exit(0);
}

function findEdge() {
  for (const p of EDGE_CANDIDATES) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function probeCdn() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(MEDIAPIPE_CDN + 'hands.js', { method: 'HEAD', signal: ctrl.signal });
    clearTimeout(t);
    return r.ok;
  } catch (e) {
    return false;
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitForJson(url, tries) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      return await r.json();
    } catch (e) {
      await sleep(500);
    }
  }
  throw new Error('no response from ' + url);
}

function htmlFor(kase) {
  const b64 = fs.readFileSync(path.join(IMAGES_DIR, kase.file)).toString('base64');
  return `<!doctype html><html><head><meta charset="utf-8"><title>side-real</title></head><body>
<div id="out">running</div>
<script src="/pv.js"></script>
<script>
const B64 = "${b64}";
const PAGE_ID = "${kase.id}";
const PAD = ${kase.pad ? 'true' : 'false'};
const CDN = "${MEDIAPIPE_CDN}";
function emit(obj){
  obj.pageId = PAGE_ID;
  const s = 'SIDETEST_RESULT ' + JSON.stringify(obj);
  try { console.log(s); } catch (e) {}
  try { document.getElementById('out').textContent = s.slice(0, 200); } catch (e) {}
}
function b64ToBytes(b){ const out = new Uint8Array(atob(b).length); let i=0; for (const c of atob(b)) out[i++]=c.charCodeAt(0); return out; }
async function buildFile(pad){
  const bytes = b64ToBytes(B64);
  if (!pad) return new File([bytes], 'test.jpg', { type: 'image/jpeg' });
  const blob = new Blob([bytes], { type: 'image/jpeg' });
  const bmp = await createImageBitmap(blob);
  const padPx = Math.round(bmp.width * 0.08);
  const c = document.createElement('canvas');
  c.width = bmp.width + padPx; c.height = bmp.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(bmp, 0, 0);
  ctx.drawImage(bmp, bmp.width - 1, 0, 1, bmp.height, bmp.width, 0, padPx, bmp.height);
  const out = await new Promise(function(r){ c.toBlob(r, 'image/jpeg', 0.95); });
  return new File([out], 'padded.jpg', { type: 'image/jpeg' });
}
async function computeMargins(blob){
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  c.getContext('2d').drawImage(bmp, 0, 0);
  const h = new Hands({ locateFile: function(f){ return CDN + f; } });
  h.setOptions({ maxNumHands: 2, modelComplexity: 1, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
  let lms = null;
  h.onResults(function(r){ if (r.multiHandLandmarks && r.multiHandLandmarks.length) lms = r.multiHandLandmarks[0]; });
  await h.send({ image: c });
  try { h.close(); } catch (e) {}
  if (!lms) return null;
  let minMargin = 1;
  for (const p of lms) minMargin = Math.min(minMargin, p.x, 1 - p.x, p.y, 1 - p.y);
  return { minMargin: Number(minMargin.toFixed(4)) };
}
async function run(){
  try {
    if (!window.PalmValidator) { emit({ stage: 'env', envErr: 'PalmValidator missing' }); return; }
    const file = await buildFile(PAD);
    let out;
    try {
      const res = await PalmValidator.validateImage(file);
      out = { stage: 'done', ok: true, res: res };
    } catch (err) {
      out = { stage: 'done', ok: false, message: String((err && err.message) || err), problem: (err && err.problem) || null };
    }
    out.libOk = (typeof Hands !== 'undefined');
    if (PAD) {
      if (out.libOk) {
        try { out.margins = await computeMargins(file); }
        catch (e) { out.marginErr = String((e && e.message) || e); }
      } else {
        out.envErr = out.envErr || 'MediaPipe Hands not loaded';
      }
    }
    if (!out.libOk && !out.ok) out.stage = 'env';
    emit(out);
  } catch (err) {
    emit({ stage: 'env', envErr: String((err && err.message) || err) });
  }
}
run();
</script></body></html>`;
}

function pvSource() {
  return fs.readFileSync(PV_PATH, 'utf8');
}

function classify(out) {
  if (!out || out.stage === 'env') return 'ENV';
  if (out.ok === true) return 'ACCEPT';
  if (out.problem && typeof out.problem === 'string') return 'REJECT';
  return 'ENV';
}

function isEnvError(out) {
  if (!out) return true;
  if (out.stage === 'env') return true;
  if (out.ok !== true && !out.problem) return true;
  if (out.harnessError) return true;
  return false;
}

async function main() {
  if (typeof WebSocket === 'undefined') skipAll('this Node build has no global WebSocket (need Node 22+)');

  const edgeBin = findEdge();
  if (!edgeBin) skipAll('headless Edge not found at expected paths');

  const missing = CASES.filter(c => !fs.existsSync(path.join(IMAGES_DIR, c.file)));
  if (missing.length) {
    skipAll('photo files missing from ' + IMAGES_DIR + ': ' + missing.map(m => m.file).join(', '));
  }

  if (!(await probeCdn())) skipAll('cannot reach MediaPipe CDN (' + MEDIAPIPE_CDN + ')');

  const pages = {};
  for (const kase of CASES) pages[kase.id] = htmlFor(kase);

  let onResult = null;
  const server = http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    if (req.method === 'GET' && u === '/pv.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      res.end(pvSource());
    } else if (req.method === 'GET' && u === '/') {
      const id = new URL(req.url, 'http://x').searchParams.get('id') || CASES[0].id;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(pages[id] || pages[CASES[0].id]);
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const profileDir = path.join(os.tmpdir(), 'palmpyaar-side-real-profile');
  fs.mkdirSync(profileDir, { recursive: true });

  const edge = spawn(edgeBin, [
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=' + CDP_PORT,
    '--user-data-dir=' + profileDir,
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--disable-gpu', '--no-sandbox',
    'about:blank'
  ], { stdio: 'ignore' });

  const outcomes = {};

  try {
    const targets = await waitForJson('http://127.0.0.1:' + CDP_PORT + '/json/list', 40);
    const page = targets.find(t => t.type === 'page');
    if (!page) throw new Error('no page target');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('CDP websocket failed')); });

    let msgId = 0;
    let currentId = null;
    const pending = {};
    ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && pending[m.id]) { pending[m.id](m); delete pending[m.id]; }
      if (m.method === 'Runtime.consoleAPICalled' && m.params && m.params.args) {
        for (const a of m.params.args) {
          if (typeof a.value === 'string' && a.value.startsWith('SIDETEST_RESULT ')) {
            let o = null;
            try { o = JSON.parse(a.value.slice('SIDETEST_RESULT '.length)); } catch (e) {}
            if (!o) continue;
            if (o.pageId !== currentId) continue;
            if (onResult) { const f = onResult; onResult = null; f(o); }
          }
        }
      }
    };
    function send(method, params) {
      const id = ++msgId;
      ws.send(JSON.stringify({ id, method, params: params || {} }));
      return new Promise(res => { pending[id] = res; });
    }
    await send('Runtime.enable');
    await send('Page.enable');

    for (const kase of CASES) {
      const got = new Promise((resolve, reject) => {
        const t = setTimeout(() => resolve({ harnessError: 'timeout ' + (CASE_TIMEOUT_MS / 1000) + 's' }), CASE_TIMEOUT_MS);
        onResult = body => { clearTimeout(t); resolve(body); };
      });
      currentId = kase.id;
      await send('Page.navigate', { url: 'http://127.0.0.1:' + port + '/?id=' + kase.id });
      const out = await got;
      currentId = null;
      outcomes[kase.id] = out;
      console.log('ran ' + kase.id + ' -> ' + (out.ok ? 'ACCEPT' : out.problem ? 'REJECT(' + out.problem + ')' : 'ENV(' + (out.message || out.envErr || out.harnessError || '?') + ')'));
    }

    const definitive = CASES.filter(c => classify(outcomes[c.id]) !== 'ENV');
    if (definitive.length === 0) {
      const first = outcomes[CASES[0].id] || {};
      skipAll('MediaPipe pipeline never produced a result: ' + (first.message || first.envErr || first.harnessError || 'unknown'));
    }

    for (const kase of CASES) {
      const out = outcomes[kase.id];
      const label = kase.id + ' ' + kase.why;
      if (classify(out) === 'ENV') {
        fail(label + ' -> environment error mid-run: ' + (out.message || out.envErr || out.harnessError || '?'));
        continue;
      }
      const exp = kase.expect;
      if (exp.ok === true) {
        if (out.ok === true && out.res && out.res.valid === true && out.res.palmEvidence) {
          pass(label);
        } else {
          fail(label + ' -> expected ACCEPT with palmEvidence, got ' + JSON.stringify({ ok: out.ok, problem: out.problem, message: out.message }));
        }
      } else {
        if (out.ok === false && out.problem === exp.problem) {
          pass(label + ' (problem=' + out.problem + ')');
        } else {
          fail(label + ' -> expected REJECT(' + exp.problem + '), got ' + JSON.stringify({ ok: out.ok, problem: out.problem, message: out.message }));
        }
      }
      if (exp.minMargin !== undefined) {
        if (out.margins && typeof out.margins.minMargin === 'number') {
          if (out.margins.minMargin >= exp.minMargin) {
            pass(kase.id + ' independent margin check: every landmark inside frame (minMargin=' + out.margins.minMargin + ' >= ' + exp.minMargin + ')');
          } else {
            fail(kase.id + ' independent margin check: minMargin=' + out.margins.minMargin + ' < ' + exp.minMargin + ' (thumb not fully inside - req C unproven)');
          }
        } else {
          fail(kase.id + ' margin verification missing: ' + (out.marginErr || 'no margins'));
        }
      }
    }
  } catch (err) {
    skipAll('browser/CDP environment failure: ' + err.message);
  } finally {
    try { edge.kill(); } catch (e) {}
    try { server.close(); } catch (e) {}
  }

  console.log('\n=== PALM SIDE DETECTION (REAL PHOTOS) TEST SUMMARY ===');
  console.log('Passed: ' + passed);
  console.log('Failed: ' + failed);
  console.log('Total: ' + (passed + failed));
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(err => {
  console.log('FATAL: ' + (err && err.stack ? err.stack : err));
  process.exit(1);
});
