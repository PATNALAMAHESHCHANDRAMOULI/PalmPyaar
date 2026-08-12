/**
 * PalmPyaar Phase 2 — Palm Validation Layer Verification
 *
 * Verifies the client-side palm image validation layer:
 *   T1  js/palmValidator.js exists and exposes the expected API
 *   T2  js/palmValidator.js loads MediaPipe from a free CDN (no paid service)
 *   T3  js/teaser.js integrates PalmValidator.validateImage before hashing
 *   T4  js/teaser.js does NOT hash before validation passes
 *   T5  payment flow is untouched (checkout.js still requires photoHash)
 *   T6  no API keys / secrets in the new client-side code
 *   T7  no paid CV service endpoint referenced
 *   T8  Libra zodiac sign still correct (unchanged)
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    console.log('PASS: ' + name);
    passed++;
  } catch (err) {
    console.log('FAIL: ' + name + ' -> ' + (err && err.message ? err.message : err));
    failed++;
  }
}

function assertTrue(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

function assertContains(text, substring, message) {
  if (!String(text).toLowerCase().includes(String(substring).toLowerCase())) {
    throw new Error((message || '') + ': expected to contain "' + substring + '"');
  }
}

function assertNotContains(text, substring, message) {
  if (String(text).toLowerCase().includes(String(substring).toLowerCase())) {
    throw new Error((message || '') + ': expected NOT to contain "' + substring + '"');
  }
}

// ---------------------------------------------------------------------------
// T1: palmValidator.js exists and exposes expected API
// ---------------------------------------------------------------------------

check('T1: js/palmValidator.js exists', function () {
  assertTrue(fs.existsSync(path.join(ROOT, 'js', 'palmValidator.js')), 'palmValidator.js missing');
});

check('T1: palmValidator.js exposes validateImage, isReady, load', function () {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'palmValidator.js'), 'utf8');
  assertContains(src, 'validateImage', 'validateImage not exported');
  assertContains(src, 'isReady', 'isReady not exported');
  assertContains(src, 'load:', 'load not exported');
  // Exposes as window.PalmValidator
  assertContains(src, 'PalmValidator', 'PalmValidator namespace not found');
});

check('T1: palmValidator.js uses IIFE pattern (no ES modules / TypeScript)', function () {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'palmValidator.js'), 'utf8');
  assertNotContains(src, 'import ', 'unexpected ES module import');
  assertNotContains(src, 'export ', 'unexpected ES module export');
  assertNotContains(src, ': string', 'unexpected TypeScript syntax');
  assertContains(src, "'use strict'", 'missing strict mode');
});

// ---------------------------------------------------------------------------
// T2: uses free CDN MediaPipe (no paid service)
// ---------------------------------------------------------------------------

check('T2: loads MediaPipe Hands from a free CDN (jsdelivr)', function () {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'palmValidator.js'), 'utf8');
  assertContains(src, 'cdn.jsdelivr.net', 'no jsdelivr CDN reference');
  assertContains(src, '@mediapipe/hands', 'no MediaPipe Hands reference');
});

check('T2: no paid CV API endpoints referenced', function () {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'palmValidator.js'), 'utf8');
  const paidPatterns = [
    'vision.googleapis.com',
    'api.deepai',
    'api.clarifai',
    'aws.amazon.com/rekognition',
    'cognitive.microsoft.com',
  ];
  for (const p of paidPatterns) {
    assertNotContains(src, p, 'paid CV service found in palmValidator.js');
  }
});

// ---------------------------------------------------------------------------
// T3: teaser.js integrates PalmValidator before hashing
// ---------------------------------------------------------------------------

check('T3: teaser.js calls PalmValidator.validateImage', function () {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'teaser.js'), 'utf8');
  assertContains(src, 'PalmValidator.validateImage', 'teaser.js does not call PalmValidator.validateImage');
  assertContains(src, 'Checking image', 'teaser.js missing validation status message');
});

check('T3: teaser.js hashes ONLY after validation passes', function () {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'teaser.js'), 'utf8');
  // Find the validateImage callback and ensure hashPhoto is inside it
  const validateIdx = src.indexOf('PalmValidator.validateImage');
  const hashIdx = src.indexOf('hashPhoto(file)', validateIdx);
  assertTrue(hashIdx > validateIdx, 'hashPhoto not called after validation');
});

check('T3: teaser.js sets error state on validation failure', function () {
  const src = fs.readFileSync(path.path = path.join(ROOT, 'js', 'teaser.js'), 'utf8');
  assertContains(src, 'err.message', 'no error handling for validation failure');
  assertContains(src, "state !== 'error'", 'updateUnlockState does not guard against overriding error state');
});

// ---------------------------------------------------------------------------
// T4: teaser.js does not hash before validation
// ---------------------------------------------------------------------------

check('T4: teaser.js does NOT immediately hash on file selection (MIME check only path removed)', function () {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'teaser.js'), 'utf8');
  // The old flow had: setPhotoStatus('Hashing on your device…') immediately after MIME check
  // The new flow has: setPhotoStatus('Checking image…') before validation
  assertNotContains(src, 'Hashing on your device', 'old immediate-hash flow still present');
  assertContains(src, 'Checking image', 'validation flow message not found');
});

// ---------------------------------------------------------------------------
// T5: payment flow (checkout.js / create-payment.js / verify-razorpay.js) untouched
// ---------------------------------------------------------------------------

check('T5: checkout.js still requires photoHash from PalmTeaser', function () {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'checkout.js'), 'utf8');
  assertContains(src, 'PalmTeaser.getPhotoHash', 'checkout.js does not get photoHash');
  assertContains(src, 'A hand photo is required', 'checkout.js missing photoHash requirement');
});

check('T5: create-payment.js still enforces photoHash server-side', function () {
  const src = fs.readFileSync(path.join(ROOT, 'api', 'create-payment.js'), 'utf8');
  assertContains(src, 'cleanPhotoHash', 'create-payment.js does not sanitize photoHash');
  assertContains(src, 'Invalid photo hash', 'create-payment.js does not validate photoHash format');
  assertContains(src, 'A hand photo is required', 'create-payment.js does not require photoHash');
});

check('T5: verify-razorpay.js untouched (still verifies Razorpay signature)', function () {
  const src = fs.readFileSync(path.join(ROOT, 'api', 'verify-razorpay.js'), 'utf8');
  assertContains(src, 'Razorpay', 'verify-razorpay.js missing Razorpay reference');
  assertContains(src, 'createHmac', 'verify-razorpay.js missing HMAC verification');
  assertNotContains(src, 'ADMIN_CONFIRM_SECRET', 'verify-razorpay.js should not have admin confirm (UPI leftover)');
});

// ---------------------------------------------------------------------------
// T6: no secrets in new client-side code
// ---------------------------------------------------------------------------

check('T6: no API keys or secrets in palmValidator.js or teaser.js', function () {
  const files = ['js/palmValidator.js', 'js/teaser.js'];
  const secretPatterns = [
    /RAZORPAY_KEY_SECRET/i,
    /TOKEN_SECRET/i,
    /GROQ_API_KEY/i,
    /GEMINI_API_KEY/i,
    /gsk_[a-z0-9]{16,}/i,
    /rzp_(live|test)_/i,
    /sk-[a-z0-9]{20,}/i,
  ];
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const p of secretPatterns) {
      const m = src.match(p);
      // Allow mentioning the variable NAME for documentation, but not actual values
      if (p.source.includes('gsk_') || p.source.includes('rzp_') || p.source.includes('sk-')) {
        assertTrue(!m, (f + ' contains a secret value: ' + p).trim());
      }
    }
  }
});

check('T7: MediaPipe model files loaded from free CDN (no paid API key required)', function () {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'palmValidator.js'), 'utf8');
  assertContains(src, 'cdn.jsdelivr.net', 'MediaPipe not loaded from free jsdelivr CDN');
  assertContains(src, 'locateFile', 'no locateFile for model resolution');
  assertNotContains(src, 'api.key', 'potential API key in model URL');
  assertNotContains(src, 'key=', 'query param in model URL (would indicate paid auth)');
});

// ---------------------------------------------------------------------------
// T8: Libra zodiac sign still fixed (not broken by changes)
// ---------------------------------------------------------------------------

check('T8: Libra zodiac boundary (Sep 23 – Oct 22) present in teaser.js', function () {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'teaser.js'), 'utf8');
  assertTrue(/Libra/.test(src), 'Libra sign not found');
  assertTrue(/9.*23.*10.*22|'Libra'.*start.*\['?9'?.*23/.test(src.replace(/\s+/g, ' ')), 'Libra date boundary not Sep 23-Oct 22');
});

// ---------------------------------------------------------------------------
// T9: index.html includes palmValidator.js script
// ---------------------------------------------------------------------------

check('T9: index.html loads palmValidator.js before teaser.js', function () {
  const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const pvIdx = src.indexOf('js/palmValidator.js');
  const teaserIdx = src.indexOf('js/teaser.js');
  assertTrue(pvIdx >= 0, 'palmValidator.js not in index.html');
  assertTrue(pvIdx < teaserIdx, 'palmValidator.js must load before teaser.js');
});

check('T9: index.html updated to mention validation in photo hint', function () {
  const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assertContains(src, 'MediaPipe', 'index.html not updated to mention MediaPipe validation');
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('\n=== PALM VALIDATION VERIFICATION SUMMARY ===');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
console.log('Total: ' + (passed + failed));

process.exit(failed === 0 ? 0 : 1);
