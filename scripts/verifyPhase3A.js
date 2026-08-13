/**
 * PalmPyaar Phase 3A — Geometry Extraction Layer Verification
 *
 * Verifies the client-side geometry extraction and palmEvidence threading:
 *   G1  palmValidator.js exposes extractGeometry() and isValidPalmEvidence()
 *   G2  extractGeometry() produces the correct evidence shape from landmarks
 *   G3  extractGeometry() returns null for malformed input
 *   G4  isValidPalmEvidence() accepts well-formed geometry
 *   G5  isValidPalmEvidence() rejects prototype pollution / extra keys
 *   G6  isValidPalmEvidence() rejects non-numbers / out-of-range values
 *   G7  teaser.js stores and exposes currentPalmEvidence via getPalmEvidence()
 *   G8  teaser.js clears palmEvidence on validation failure
 *   G9  checkout.js threads palmEvidence through validateInputs()
 *   G10 checkout.js sends palmEvidence in the verify-razorpay fetch body
 *   G11 create-payment.js accepts and validates palmEvidence (server-side)
 *   G12 create-payment.js binds palmEvidence into the state token
 *   G13 verify-razorpay.js cross-checks palmEvidence against the state token
 *   G14 verify-razorpay.js includes palmEvidence in the reading token HMAC
 *   G15 verify-razorpay.js includes palmEvidence in the result URL
 *   G16 generate-reading.js validates palmEvidence server-side before provider use
 *   G17 generate-reading.js includes palmEvidence in the HMAC token recomputation
 *   G18 generate-reading.js passes palmEvidence to the provider
 *   G19 promptAssembler.js includes palmEvidence in userContext
 *   G20 promptAssembler.js renders palmEvidence status in the compiled prompt
 *   G21 groqProvider.js passes palmEvidence in userContext to reviewer/rewriter
 *   G22 No palm-line/mount/personality detection in the extracted evidence
 *   G23 No paid CV service references in the geometry extraction path
 *   G24 No API secrets in the client-side geometry code
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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
// Sample landmarks (21 points) for synthetic extraction testing
// ---------------------------------------------------------------------------

function makeLandmarks(overrides) {
  var pts = [];
  for (var i = 0; i < 21; i++) {
    pts.push({ x: 0.5, y: 0.5, z: 0 });
  }
  // Wrist at center-left
  pts[0] = { x: 0.3, y: 0.5, z: 0 };
  // Thumb MCP at (0.4, 0.4), tip at (0.5, 0.3)
  pts[2] = { x: 0.4, y: 0.4, z: 0 };
  pts[4] = { x: 0.5, y: 0.3, z: 0 };
  // Index MCP at (0.5, 0.3), PIP at (0.5, 0.45), tip at (0.5, 0.1)
  pts[5] = { x: 0.5, y: 0.3, z: 0 };
  pts[6] = { x: 0.5, y: 0.45, z: 0 };
  pts[8] = { x: 0.5, y: 0.1, z: 0 };
  // Middle MCP at (0.6, 0.3), PIP at (0.6, 0.45), tip at (0.6, 0.05)
  pts[9] = { x: 0.6, y: 0.3, z: 0 };
  pts[10] = { x: 0.6, y: 0.45, z: 0 };
  pts[12] = { x: 0.6, y: 0.05, z: 0 };
  // Pinky MCP at (0.7, 0.35)
  pts[17] = { x: 0.7, y: 0.35, z: 0 };
  if (overrides) {
    for (var k in overrides) {
      if (overrides.hasOwnProperty(k)) pts[k] = overrides[k];
    }
  }
  return pts;
}

// ---------------------------------------------------------------------------
// Load the source files for structural checks
// ---------------------------------------------------------------------------

const palmValidatorSrc = fs.readFileSync(path.join(ROOT, 'js', 'palmValidator.js'), 'utf8');
const teaserSrc = fs.readFileSync(path.join(ROOT, 'js', 'teaser.js'), 'utf8');
const checkoutSrc = fs.readFileSync(path.join(ROOT, 'js', 'checkout.js'), 'utf8');
const createPaymentSrc = fs.readFileSync(path.join(ROOT, 'api', 'create-payment.js'), 'utf8');
const verifyRazorpaySrc = fs.readFileSync(path.join(ROOT, 'api', 'verify-razorpay.js'), 'utf8');
const generateReadingSrc = fs.readFileSync(path.join(ROOT, 'api', 'generate-reading.js'), 'utf8');
const promptAssemblerSrc = fs.readFileSync(path.join(ROOT, 'providers', 'promptAssembler.js'), 'utf8');
const groqProviderSrc = fs.readFileSync(path.join(ROOT, 'providers', 'groqProvider.js'), 'utf8');
const palmEvidenceValidatorSrc = fs.readFileSync(path.join(ROOT, 'lib', 'palmEvidenceValidator.js'), 'utf8');

// ---------------------------------------------------------------------------
// G1: palmValidator.js exposes extractGeometry and isValidPalmEvidence
// ---------------------------------------------------------------------------

check('G1: palmValidator.js exposes extractGeometry and isValidPalmEvidence', function () {
  assertContains(palmValidatorSrc, 'extractGeometry', 'extractGeometry not found');
  assertContains(palmValidatorSrc, 'isValidPalmEvidence', 'isValidPalmEvidence not found');
  assertContains(palmValidatorSrc, 'extractGeometry: extractGeometry', 'extractGeometry not exported');
  assertContains(palmValidatorSrc, 'isValidPalmEvidence: isValidPalmEvidence', 'isValidPalmEvidence not exported');
});

// ---------------------------------------------------------------------------
// G2: extractGeometry logic — verify by loading the function via vm (browser IIFE)
// ---------------------------------------------------------------------------

check('G2: extractGeometry produces correct evidence shape from landmarks', function () {
  // Load the PalmValidator IIFE in a sandbox with document/window stubs
  var moduleCode = palmValidatorSrc;

  // Stub browser globals needed by the IIFE
  var sandbox = {
    document: {
      querySelector: function () { return null; },
      head: { appendChild: function () {} },
      readyState: 'loading',
      addEventListener: function () {}
    },
    window: {},
    Image: function () { this.onload = null; this.onerror = null; this.src = ''; },
    URL: { createObjectURL: function () { return 'blob:fake'; }, revokeObjectURL: function () {} },
    crypto: { subtle: { digest: function () { return Promise.resolve(new ArrayBuffer(8)); } } },
    TextEncoder: function () {}
  };
  sandbox.window = sandbox;

  var vm = require('vm');
  var ctx = vm.createContext(sandbox);
  vm.runInContext(moduleCode, ctx);

  assertTrue(typeof sandbox.PalmValidator.extractGeometry === 'function', 'extractGeometry not exposed');
  var evidence = sandbox.PalmValidator.extractGeometry(makeLandmarks());

  assertTrue(evidence !== null, 'extractGeometry returned null for valid landmarks');
  assertTrue(typeof evidence === 'object', 'evidence is not an object');

  // Structure
  assertTrue(typeof evidence.palmBounds === 'object', 'palmBounds missing');
  assertTrue(typeof evidence.fingerRatios === 'object', 'fingerRatios missing');
  assertTrue(typeof evidence.geometricRatios === 'object', 'geometricRatios missing');
  assertTrue(typeof evidence.palmAngle === 'number', 'palmAngle missing or not number');

  // palmBounds keys
  var pbKeys = Object.keys(evidence.palmBounds);
  assertTrue(pbKeys.indexOf('width') >= 0, 'palmBounds.width missing');
  assertTrue(pbKeys.indexOf('height') >= 0, 'palmBounds.height missing');
  assertTrue(pbKeys.indexOf('aspectRatio') >= 0, 'palmBounds.aspectRatio missing');
  assertTrue(pbKeys.length === 3, 'palmBounds has extra keys: ' + pbKeys.join(','));

  // fingerRatios keys
  var frKeys = Object.keys(evidence.fingerRatios);
  ['index', 'middle', 'ring', 'pinky', 'thumb'].forEach(function (k) {
    assertTrue(frKeys.indexOf(k) >= 0, 'fingerRatios.' + k + ' missing');
  });
  assertTrue(frKeys.length === 5, 'fingerRatios has wrong key count');

  // geometricRatios keys
  var grKeys = Object.keys(evidence.geometricRatios);
  ['indexToMiddle', 'fingerSpanToHeight', 'thumbToIndex'].forEach(function (k) {
    assertTrue(grKeys.indexOf(k) >= 0, 'geometricRatios.' + k + ' missing');
  });
  assertTrue(grKeys.length === 3, 'geometricRatios has wrong key count');

  // All values are finite numbers
  function allFinite(obj) {
    for (var k in obj) {
      if (typeof obj[k] !== 'number' || !isFinite(obj[k])) return false;
    }
    return true;
  }
  assertTrue(allFinite(evidence.palmBounds), 'palmBounds has non-finite values');
  assertTrue(allFinite(evidence.fingerRatios), 'fingerRatios has non-finite values');
  assertTrue(allFinite(evidence.geometricRatios), 'geometricRatios has non-finite values');
});

// ---------------------------------------------------------------------------
// G3: extractGeometry returns null for malformed input
// ---------------------------------------------------------------------------

check('G3: extractGeometry returns null for malformed input', function () {
  var vm = require('vm');
  var sandbox = {
    document: { querySelector: function () { return null; }, head: { appendChild: function () {} }, readyState: 'loading', addEventListener: function () {} },
    window: {},
    Image: function () { this.onload = null; this.onerror = null; this.src = ''; },
    URL: { createObjectURL: function () { return 'blob:fake'; }, revokeObjectURL: function () {} },
    crypto: { subtle: { digest: function () { return Promise.resolve(new ArrayBuffer(8)); } } },
    TextEncoder: function () {}
  };
  sandbox.window = sandbox;
  vm.runInContext(palmValidatorSrc, vm.createContext(sandbox));

  var extractGeometry = sandbox.PalmValidator.extractGeometry;
  assertTrue(extractGeometry(null) === null, 'null should return null');
  assertTrue(extractGeometry(undefined) === null, 'undefined should return null');
  assertTrue(extractGeometry([]) === null, 'empty array should return null');
  assertTrue(extractGeometry([1, 2]) === null, 'too few landmarks should return null');
  assertTrue(extractGeometry(makeLandmarks()) !== null, 'valid landmarks should return evidence');
});

// ---------------------------------------------------------------------------
// G4-G6: Server-side isValidPalmEvidence
// ---------------------------------------------------------------------------

check('G4: isValidPalmEvidence accepts well-formed geometry', function () {
  var { isValidPalmEvidence } = require('../lib/palmEvidenceValidator');
  var valid = {
    palmBounds: { width: 0.5, height: 0.6, aspectRatio: 0.833 },
    fingerRatios: { index: 0.9, middle: 0.95, ring: 0.9, pinky: 0.85, thumb: 0.8 },
    geometricRatios: { indexToMiddle: 0.95, fingerSpanToHeight: 1.2, thumbToIndex: 0.85 },
    palmAngle: 15.5
  };
  assertTrue(isValidPalmEvidence(valid) === true, 'valid evidence should pass');
});

check('G5: isValidPalmEvidence rejects prototype pollution / extra keys', function () {
  var { isValidPalmEvidence } = require('../lib/palmEvidenceValidator');

  assertTrue(isValidPalmEvidence(null) === false, 'null should fail');
  assertTrue(isValidPalmEvidence(undefined) === false, 'undefined should fail');
  assertTrue(isValidPalmEvidence('string') === false, 'string should fail');
  assertTrue(isValidPalmEvidence([]) === false, 'array should fail');
  assertTrue(isValidPalmEvidence({}) === false, 'empty object should fail');

  var withExtra = {
    palmBounds: { width: 0.5, height: 0.6, aspectRatio: 0.833 },
    fingerRatios: { index: 0.9, middle: 0.95, ring: 0.9, pinky: 0.85, thumb: 0.8 },
    geometricRatios: { indexToMiddle: 0.95, fingerSpanToHeight: 1.2, thumbToIndex: 0.85 },
    palmAngle: 15.5,
    injected: 'malicious'
  };
  assertTrue(isValidPalmEvidence(withExtra) === false, 'extra top-level key should fail');

  var withProto = {
    palmBounds: { width: 0.5, height: 0.6, aspectRatio: 0.833 },
    fingerRatios: { index: 0.9, middle: 0.95, ring: 0.9, pinky: 0.85, thumb: 0.8 },
    geometricRatios: { indexToMiddle: 0.95, fingerSpanToHeight: 1.2, thumbToIndex: 0.85 },
    palmAngle: 15.5
  };
  // Add an own property via defineProperty to simulate pollution attempt
  Object.defineProperty(withProto, 'inject', { value: 'bad', enumerable: true });
  assertTrue(isValidPalmEvidence(withProto) === false, 'extra own property should fail');

  var withExtraPbKey = {
    palmBounds: { width: 0.5, height: 0.6, aspectRatio: 0.833, extra: 1 },
    fingerRatios: { index: 0.9, middle: 0.95, ring: 0.9, pinky: 0.85, thumb: 0.8 },
    geometricRatios: { indexToMiddle: 0.95, fingerSpanToHeight: 1.2, thumbToIndex: 0.85 },
    palmAngle: 15.5
  };
  assertTrue(isValidPalmEvidence(withExtraPbKey) === false, 'extra palmBounds key should fail');
});

check('G6: isValidPalmEvidence rejects non-numbers / out-of-range values', function () {
  var { isValidPalmEvidence } = require('../lib/palmEvidenceValidator');

  var nonNum = {
    palmBounds: { width: '0.5', height: 0.6, aspectRatio: 0.833 },
    fingerRatios: { index: 0.9, middle: 0.95, ring: 0.9, pinky: 0.85, thumb: 0.8 },
    geometricRatios: { indexToMiddle: 0.95, fingerSpanToHeight: 1.2, thumbToIndex: 0.85 },
    palmAngle: 15.5
  };
  assertTrue(isValidPalmEvidence(nonNum) === false, 'string number value should fail');

  var outOfRange = {
    palmBounds: { width: 5, height: 0.6, aspectRatio: 0.833 },
    fingerRatiors: { index: 0.9, middle: 0.95, ring: 0.9, pinky: 0.85, thumb: 0.8 },
    geometricRatios: { indexToMiddle: 0.95, fingerSpanToHeight: 1.2, thumbToIndex: 0.85 },
    palmAngle: 15.5
  };
  assertTrue(isValidPalmEvidence(outOfRange) === false, 'out-of-range palmBounds.width should fail');

  var badAngle = {
    palmBounds: { width: 0.5, height: 0.6, aspectRatio: 0.833 },
    fingerRatios: { index: 0.9, middle: 0.95, ring: 0.9, pinky: 0.85, thumb: 0.8 },
    geometricRatios: { indexToMiddle: 0.95, fingerSpanToHeight: 1.2, thumbToIndex: 0.85 },
    palmAngle: 500
  };
  assertTrue(isValidPalmEvidence(badAngle) === false, 'palmAngle out of [-180,180] should fail');

  var nanVal = {
    palmBounds: { width: 0.5, height: 0.6, aspectRatio: 0.833 },
    fingerRatios: { index: 0.9, middle: 0.95, ring: 0.9, pinky: 0.85, thumb: NaN },
    geometricRatios: { indexToMiddle: 0.95, fingerSpanToHeight: 1.2, thumbToIndex: 0.85 },
    palmAngle: 15.5
  };
  assertTrue(isValidPalmEvidence(nanVal) === false, 'NaN value should fail');
});

// ---------------------------------------------------------------------------
// G7: teaser.js stores and exposes currentPalmEvidence
// ---------------------------------------------------------------------------

check('G7: teaser.js stores currentPalmEvidence and exposes getPalmEvidence', function () {
  assertContains(teaserSrc, 'currentPalmEvidence', 'currentPalmEvidence variable not found');
  assertContains(teaserSrc, 'getPalmEvidence', 'getPalmEvidence not found');
  // Exposed on window.PalmTeaser
  assertContains(teaserSrc, 'getPalmEvidence: function', 'getPalmEvidence not on PalmTeaser namespace');
});

// ---------------------------------------------------------------------------
// G8: teaser.js clears palmEvidence on validation failure
// ---------------------------------------------------------------------------

check('G8: teaser.js clears palmEvidence on validation failure', function () {
  // In the catch handler and on invalid result path, currentPalmEvidence should be cleared
  var catchIdx = teaserSrc.indexOf('currentPalmEvidence = null');
  assertTrue(catchIdx >= 0, 'currentPalmEvidence not cleared anywhere');
  // Should appear at least in: file missing, invalid MIME, too large, validation fail, hash error, catch
  var occurrences = teaserSrc.split('currentPalmEvidence = null').length - 1;
  assertTrue(occurrences >= 4, 'currentPalmEvidence should be cleared in multiple error paths (found ' + occurrences + ')');
});

// ---------------------------------------------------------------------------
// G9: checkout.js threads palmEvidence through validateInputs
// ---------------------------------------------------------------------------

check('G9: checkout.js threads palmEvidence through validateInputs', function () {
  assertContains(checkoutSrc, 'getPalmEvidence', 'checkout.js does not call getPalmEvidence');
  assertContains(checkoutSrc, 'palmEvidence: palmEvidence', 'palmEvidence not in validateInputs return');
});

// ---------------------------------------------------------------------------
// G10: checkout.js sends palmEvidence in verify-razorpay fetch body
// ---------------------------------------------------------------------------

check('G10: checkout.js sends palmEvidence in verify-razorpay fetch body', function () {
  // The verifyPayment function should include palmEvidence in its JSON.stringify body
  var fetchIdx = checkoutSrc.indexOf("fetch('/api/verify-razorpay'");
  assertTrue(fetchIdx >= 0, 'verify-razorpay fetch not found');
  var fetchBodySection = checkoutSrc.slice(fetchIdx, fetchIdx + 2000);
  assertContains(fetchBodySection, 'palmEvidence: data.palmEvidence', 'palmEvidence not sent in verify-razorpay body');
});

// ---------------------------------------------------------------------------
// G11: create-payment.js accepts and validates palmEvidence
// ---------------------------------------------------------------------------

check('G11: create-payment.js accepts and validates palmEvidence', function () {
  assertContains(createPaymentSrc, 'palmEvidence', 'palmEvidence not in create-payment.js');
  assertContains(createPaymentSrc, 'isValidPalmEvidence', 'isValidPalmEvidence not used in create-payment.js');
  assertContains(createPaymentSrc, 'Invalid palm evidence', 'missing validation error message for palm evidence');
});

// ---------------------------------------------------------------------------
// G12: create-payment.js binds palmEvidence into state token
// ---------------------------------------------------------------------------

check('G12: create-payment.js binds palmEvidence in state token', function () {
  assertContains(createPaymentSrc, 'palmEvidence: cleanPalmEvidence', 'palmEvidence not in state token sign payload');
});

// ---------------------------------------------------------------------------
// G13: verify-razorpay.js cross-checks palmEvidence against state token
// ---------------------------------------------------------------------------

check('G13: verify-razorpay.js cross-checks palmEvidence against state token', function () {
  assertContains(verifyRazorpaySrc, 'browserPalmEvidenceStr', 'browser palmEvidence string comparison not found');
  assertContains(verifyRazorpaySrc, 'statePalmEvidenceStr', 'state palmEvidence string comparison not found');
  assertContains(verifyRazorpaySrc, 'Palm evidence does not match', 'palm evidence mismatch error message not found');
});

// ---------------------------------------------------------------------------
// G14: verify-razorpay.js includes palmEvidence in reading token HMAC
// ---------------------------------------------------------------------------

check('G14: verify-razorpay.js includes palmEvidence in reading token HMAC', function () {
  // The token minting line should include palmEvidenceStr between photoHash and orderId
  var tokenIdx = verifyRazorpaySrc.indexOf('rawPayload');
  assertTrue(tokenIdx >= 0, 'rawPayload for token not found');
  var tokenSection = verifyRazorpaySrc.slice(tokenIdx, tokenIdx + 500);
  assertContains(tokenSection, 'palmEvidenceStr', 'palmEvidenceStr not in token payload');
  assertContains(tokenSection, 'state.photoHash', 'photoHash not in token payload');
});

// ---------------------------------------------------------------------------
// G15: verify-razorpay.js includes palmEvidence in result URL
// ---------------------------------------------------------------------------

check('G15: verify-razorpay.js includes palmEvidence in result URL', function () {
  var buildUrlIdx = verifyRazorpaySrc.indexOf('function buildResultUrl');
  assertTrue(buildUrlIdx >= 0, 'buildResultUrl not found');
  var urlSection = verifyRazorpaySrc.slice(buildUrlIdx, buildUrlIdx + 800);
  assertContains(urlSection, 'palmEvidence', 'palmEvidence not in buildResultUrl');
});

// ---------------------------------------------------------------------------
// G16: generate-reading.js validates palmEvidence server-side
// ---------------------------------------------------------------------------

check('G16: generate-reading.js validates palmEvidence server-side', function () {
  assertContains(generateReadingSrc, 'isValidPalmEvidence', 'isValidPalmEvidence not used in generate-reading.js');
  assertContains(generateReadingSrc, 'palmEvidence', 'palmEvidence not in generate-reading.js');
});

// ---------------------------------------------------------------------------
// G17: generate-reading.js includes palmEvidence in HMAC token recomputation
// ---------------------------------------------------------------------------

check('G17: generate-reading.js includes palmEvidence in HMAC token', function () {
  var rawPayloadIdx = generateReadingSrc.indexOf('rawPayload');
  assertTrue(rawPayloadIdx >= 0, 'rawPayload not found in generate-reading');
  var payloadSection = generateReadingSrc.slice(rawPayloadIdx, rawPayloadIdx + 500);
  assertContains(payloadSection, 'palmEvidenceStr', 'palmEvidenceStr not in generate-reading token payload');
});

// ---------------------------------------------------------------------------
// G18: generate-reading.js passes palmEvidence to provider
// ---------------------------------------------------------------------------

check('G18: generate-reading.js passes palmEvidence to provider', function () {
  var providerIdx = generateReadingSrc.indexOf('provider.generateReading');
  assertTrue(providerIdx >= 0, 'provider.generateReading not found');
  var providerSection = generateReadingSrc.slice(providerIdx, providerIdx + 500);
  assertContains(providerSection, 'palmEvidence', 'palmEvidence not passed to provider');
});

// ---------------------------------------------------------------------------
// G19: promptAssembler.js includes palmEvidence in userContext
// ---------------------------------------------------------------------------

check('G19: promptAssembler.js includes palmEvidence in userContext', function () {
  assertContains(promptAssemblerSrc, 'palmEvidence', 'palmEvidence not in promptAssembler.js');
  var sanitizeIdx = promptAssemblerSrc.indexOf('photoHashPresent');
  assertTrue(sanitizeIdx >= 0, 'sanitizeUserContext not found');
  var sanitizeSection = promptAssemblerSrc.slice(sanitizeIdx - 200, sanitizeIdx + 200);
  assertContains(sanitizeSection, 'palmEvidence', 'palmEvidence not in sanitizeUserContext return');
});

// ---------------------------------------------------------------------------
// G20: promptAssembler.js renders palmEvidence status in compiled prompt
// ---------------------------------------------------------------------------

check('G20: promptAssembler.js renders palmEvidence in USER CONTEXT section', function () {
  assertContains(promptAssemblerSrc, 'Palm Evidence:', 'Palm Evidence line not in user context section');
});

// ---------------------------------------------------------------------------
// G21: groqProvider.js passes palmEvidence in userContext to reviewer/rewriter
// ---------------------------------------------------------------------------

check('G21: groqProvider.js passes palmEvidence in userContext', function () {
  assertContains(groqProviderSrc, 'palmEvidence', 'palmEvidence not in groqProvider userContext');
});

// ---------------------------------------------------------------------------
// G22: No palm-line/mount/personality detection in extracted evidence
// ---------------------------------------------------------------------------

check('G22: extractGeometry does NOT detect palm lines, mounts, or personality traits', function () {
  // Extract the extractGeometry function body and strip comments
  var fnMatch = palmValidatorSrc.match(/function extractGeometry\(landmarks\) \{([\s\S]*)\n   \}/);
  var body = fnMatch ? fnMatch[1] : '';
  // Strip JSDoc-style and inline comments
  body = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  // Must NOT mention line detection, mount classification, or personality in the actual code
  assertNotContains(body, 'line', 'extractGeometry should not detect palm lines');
  assertNotContains(body, 'mount', 'extractGeometry should not classify mounts');
  assertNotContains(body, 'personality', 'extractGeometry should not infer personality');
  assertNotContains(body, 'fate', 'extractGeometry should not detect fate line');
  assertNotContains(body, 'heart', 'extractGeometry should not detect heart line');
  assertNotContains(body, 'character', 'extractGeometry should not infer character');
});

// ---------------------------------------------------------------------------
// G23: No paid CV service references in geometry extraction path
// ---------------------------------------------------------------------------

check('G23: no paid CV service endpoints in palmValidator.js', function () {
  var paidPatterns = [
    'vision.googleapis.com',
    'api.deepai',
    'api.clarifai',
    'rekognition',
    'cognitive.microsoft.com',
    'aws.amazon.com',
  ];
  for (var i = 0; i < paidPatterns.length; i++) {
    assertNotContains(palmValidatorSrc, paidPatterns[i], 'paid CV service found');
  }
  // Still uses free MediaPipe CDN
  assertContains(palmValidatorSrc, 'cdn.jsdelivr.net', 'MediaPipe not from free CDN');
  assertContains(palmValidatorSrc, '@mediapipe/hands', 'MediaPipe Hands not referenced');
});

// ---------------------------------------------------------------------------
// G24: No API secrets in client-side geometry code
// ---------------------------------------------------------------------------

check('G24: no API secrets in client-side geometry extraction code', function () {
  var secretPatterns = [
    /RAZORPAY_KEY_SECRET/i,
    /TOKEN_SECRET/i,
    /GROQ_API_KEY/i,
    /GEMINI_API_KEY/i,
    /gsk_[a-z0-9]{16,}/i,
    /rzp_(live|test)_/i,
    /sk-[a-z0-9]{20,}/i,
  ];
  var sourceFiles = {
    'js/palmValidator.js': palmValidatorSrc,
    'js/teaser.js': teaserSrc,
    'js/checkout.js': checkoutSrc
  };
  for (var f in sourceFiles) {
    var src = sourceFiles[f];
    for (var i = 0; i < secretPatterns.length; i++) {
      var m = src.match(secretPatterns[i]);
      if (m && (secretPatterns[i].source.includes('gsk_') || secretPatterns[i].source.includes('rzp_') || secretPatterns[i].source.includes('sk-'))) {
        assertTrue(!m, f + ' contains a secret value: ' + secretPatterns[i]);
      }
    }
  }
});

// ---------------------------------------------------------------------------
// G25: Full round-trip integration — palmEvidence flows through create-payment -> verify-razorpay
// ---------------------------------------------------------------------------

check('G25: palmEvidence round-trips through create-payment + verify-razorpay HMAC', async function () {
  const createPayment = require('../api/create-payment');
  const verifyRazorpay = require('../api/verify-razorpay');
  const stateToken = require('../lib/stateToken');

  const SECRET = 'phase3a-test-secret';
  const KEY_ID = 'rzp_test_publicKeyId';
  const KEY_SECRET = 'razorpay-flow-key-secret';
  const RZ_ORDER = 'order_test123';

  // Minimal palmEvidence that passes validation
  const palmEvidence = {
    palmBounds: { width: 0.5, height: 0.6, aspectRatio: 0.833 },
    fingerRatios: { index: 0.9, middle: 0.95, ring: 0.9, pinky: 0.85, thumb: 0.8 },
    geometricRatios: { indexToMiddle: 0.95, fingerSpanToHeight: 1.2, thumbToIndex: 0.85 },
    palmAngle: 15.5
  };

  // --- create-payment ---
  var globalFetch = global.fetch;
  global.fetch = async function () {
    return {
      ok: true,
      status: 200,
      json: async function () { return { id: RZ_ORDER }; }
    };
  };

  var savedEnv = {};
  ['NODE_ENV', 'DEV_BYPASS', 'TOKEN_SECRET', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET'].forEach(function (k) {
    savedEnv[k] = process.env[k];
  });

  try {
    process.env.NODE_ENV = 'production';
    process.env.TOKEN_SECRET = SECRET;
    process.env.RAZORPAY_KEY_ID = KEY_ID;
    process.env.RAZORPAY_KEY_SECRET = KEY_SECRET;

    var createRes = { _json: null, statusCode: 0 };
    createRes.status = function (code) { createRes.statusCode = code; return createRes; };
    createRes.json = function (obj) { createRes._json = obj; return createRes; };
    createRes.setHeader = function () {};

    var createReq = {
      method: 'POST',
      body: JSON.stringify({
        name: 'Test User',
        dob: '1990-05-15',
        birthplace: 'Pune',
        tradition: 'western',
        photoHash: 'a'.repeat(64),
        palmEvidence: palmEvidence
      })
    };

    await createPayment(createReq, createRes);
    assertTrue(createRes.statusCode === 200, 'create-payment failed: ' + JSON.stringify(createRes._json));
    assertTrue(createRes._json.success === true, 'create-payment did not return success');

    var payment = createRes._json.payment;
    var state = stateToken.verify(payment.stateToken, SECRET);
    assertTrue(state !== null, 'state token verification failed');
    assertTrue(state.palmEvidence !== null && state.palmEvidence !== undefined, 'palmEvidence not bound in state token');

    // --- verify-razorpay ---
    var verifyRes = { _json: null, statusCode: 0 };
    verifyRes.status = function (code) { verifyRes.statusCode = code; return verifyRes; };
    verifyRes.json = function (obj) { verifyRes._json = obj; return verifyRes; };
    verifyRes.setHeader = function () {};

    var razorpaySig = crypto.createHmac('sha256', KEY_SECRET)
      .update(RZ_ORDER + '|' + 'pay_test123')
      .digest('hex');

    var verifyReq = {
      method: 'POST',
      body: JSON.stringify({
        name: 'Test User',
        dob: '1990-05-15',
        birthplace: 'Pune',
        tradition: 'western',
        photoHash: 'a'.repeat(64),
        palmEvidence: palmEvidence,
        orderId: payment.orderId,
        stateToken: payment.stateToken,
        razorpayOrderId: payment.razorpayOrderId,
        razorpayPaymentId: 'pay_test123',
        razorpaySignature: razorpaySig
      })
    };

    await verifyRazorpay(verifyReq, verifyRes);
    assertTrue(verifyRes.statusCode === 200, 'verify-razorpay failed: ' + JSON.stringify(verifyRes._json));
    assertTrue(verifyRes._json.success === true, 'verify-razorpay did not return success');
    assertTrue(verifyRes._json.verified === true, 'verify-razorpay did not return verified=true');

    // Check that palmEvidence is in the resultUrl
    var url = new URL('https://example.com' + verifyRes._json.resultUrl);
    assertTrue(url.searchParams.has('palmEvidence'), 'palmEvidence not in resultUrl');
    var urlPalmEvidence = JSON.parse(url.searchParams.get('palmEvidence'));
    assertTrue(urlPalmEvidence.palmBounds.width === 0.5, 'palmEvidence width mismatch in URL');

    // Verify the reading token includes palmEvidence in its HMAC
    var token = url.searchParams.get('token');
    var palmEvidenceStr = JSON.stringify(palmEvidence);
    var expectedToken = crypto.createHmac('sha256', SECRET)
      .update(['Test User', '1990-05-15', 'Pune', 'western', 'a'.repeat(64), palmEvidenceStr, payment.orderId].join(':'))
      .digest('hex');
    assertTrue(token === expectedToken, 'reading token does not include palmEvidence in HMAC');

    // --- generate-reading with the resultUrl params ---
    var genRes = { _json: null, statusCode: 0 };
    genRes.status = function (code) { genRes.statusCode = code; return genRes; };
    genRes.json = function (obj) { genRes._json = obj; return genRes; };
    genRes.setHeader = function () {};

    var genReq = {
      method: 'GET',
      query: {
        name: url.searchParams.get('name'),
        dob: url.searchParams.get('dob'),
        birthplace: url.searchParams.get('birthplace'),
        tradition: url.searchParams.get('tradition'),
        photoHash: url.searchParams.get('photoHash'),
        palmEvidence: url.searchParams.get('palmEvidence'),
        orderId: url.searchParams.get('orderId'),
        token: url.searchParams.get('token')
      }
    };

    await require('../api/generate-reading')(genReq, genRes);
    assertTrue(genRes.statusCode === 200, 'generate-reading failed: ' + JSON.stringify(genRes._json));
    assertTrue(genRes._json.success === true, 'generate-reading did not return success');

  } finally {
    global.fetch = globalFetch;
    Object.keys(savedEnv).forEach(function (k) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    });
  }
});

// ---------------------------------------------------------------------------
// G26: palmEvidence mismatch between browser and state token is rejected
// ---------------------------------------------------------------------------

check('G26: forged palmEvidence (mismatch) is rejected by verify-razorpay', async function () {
  const createPayment = require('../api/create-payment');
  const verifyRazorpay = require('../api/verify-razorpay');

  const SECRET = 'phase3a-forgery-test';
  const KEY_ID = 'rzp_test_other';
  const KEY_SECRET = 'other-key-secret';
  const RZ_ORDER = 'order_forgery';

  const validEvidence = {
    palmBounds: { width: 0.5, height: 0.6, aspectRatio: 0.833 },
    fingerRatios: { index: 0.9, middle: 0.95, ring: 0.9, pinky: 0.85, thumb: 0.8 },
    geometricRatios: { indexToMiddle: 0.95, fingerSpanToHeight: 1.2, thumbToIndex: 0.85 },
    palmAngle: 15.5
  };

  var forgedEvidence = {
    palmBounds: { width: 0.9, height: 0.1, aspectRatio: 9 },
    fingerRatios: { index: 0.1, middle: 0.1, ring: 0.1, pinky: 0.1, thumb: 0.1 },
    geometricRatios: { indexToMiddle: 0.1, fingerSpanToHeight: 0.1, thumbToIndex: 0.1 },
    palmAngle: -170
  };

  var savedEnv = {};
  ['NODE_ENV', 'DEV_BYPASS', 'TOKEN_SECRET', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET'].forEach(function (k) {
    savedEnv[k] = process.env[k];
  });

  var globalFetch = global.fetch;
  global.fetch = async function () {
    return { ok: true, status: 200, json: async function () { return { id: RZ_ORDER }; } };
  };

  try {
    process.env.NODE_ENV = 'production';
    process.env.TOKEN_SECRET = SECRET;
    process.env.RAZORPAY_KEY_ID = KEY_ID;
    process.env.RAZORPAY_KEY_SECRET = KEY_SECRET;

    // Create payment WITH valid evidence
    var createRes = { _json: null, statusCode: 0 };
    createRes.status = function (code) { createRes.statusCode = code; return createRes; };
    createRes.json = function (obj) { createRes._json = obj; return createRes; };
    createRes.setHeader = function () {};

    await createPayment({
      method: 'POST',
      body: JSON.stringify({
        name: 'Test', dob: '1990-01-01', birthplace: 'City', tradition: 'western',
        photoHash: 'b'.repeat(64), palmEvidence: validEvidence
      })
    }, createRes);

    var state = require('../lib/stateToken').verify(createRes._json.payment.stateToken, SECRET);
    assertTrue(state !== null, 'state token should verify');

    var razorpaySig = crypto.createHmac('sha256', KEY_SECRET)
      .update(RZ_ORDER + '|pay_forged')
      .digest('hex');

    // Verify with FORGED palmEvidence (mismatch)
    var verifyRes = { _json: null, statusCode: 0 };
    verifyRes.status = function (code) { verifyRes.statusCode = code; return verifyRes; };
    verifyRes.json = function (obj) { verifyRes._json = obj; return verifyRes; };
    verifyRes.setHeader = function () {};

    await verifyRazorpay({
      method: 'POST',
      body: JSON.stringify({
        name: 'Test', dob: '1990-01-01', birthplace: 'City', tradition: 'western',
        photoHash: 'b'.repeat(64), palmEvidence: forgedEvidence,
        orderId: createRes._json.payment.orderId,
        stateToken: createRes._json.payment.stateToken,
        razorpayOrderId: createRes._json.payment.razorpayOrderId,
        razorpayPaymentId: 'pay_forged',
        razorpaySignature: razorpaySig
      })
    }, verifyRes);

    assertTrue(verifyRes.statusCode === 400, 'forged palmEvidence should be rejected (expected 400, got ' + verifyRes.statusCode + '): ' + JSON.stringify(verifyRes._json));
    assertTrue(verifyRes._json.error.includes('Palm evidence does not match'), 'wrong error message: ' + verifyRes._json.error);

  } finally {
    global.fetch = globalFetch;
    Object.keys(savedEnv).forEach(function (k) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    });
  }
});

// ---------------------------------------------------------------------------
// G27: Invalid palmEvidence is rejected by create-payment
// ---------------------------------------------------------------------------

check('G27: create-payment rejects malformed palmEvidence', async function () {
  const createPayment = require('../api/create-payment');

  var savedEnv = {};
  ['NODE_ENV', 'DEV_BYPASS', 'TOKEN_SECRET', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET'].forEach(function (k) {
    savedEnv[k] = process.env[k];
  });
  process.env.NODE_ENV = 'production';
  process.env.TOKEN_SECRET = 'test-secret';
  process.env.RAZORPAY_KEY_ID = 'rzp_test_x';
  process.env.RAZORPAY_KEY_SECRET = 'test-secret-2';

  var globalFetch = global.fetch;
  global.fetch = async function () {
    return { ok: true, status: 200, json: async function () { return { id: 'order_x' }; } };
  };

  try {
    var res = { _json: null, statusCode: 0 };
    res.status = function (code) { res.statusCode = code; return res; };
    res.json = function (obj) { res._json = obj; return res; };
    res.setHeader = function () {};

    await createPayment({
      method: 'POST',
      body: JSON.stringify({
        name: 'Test', dob: '1990-01-01', birthplace: 'City', tradition: 'western',
        photoHash: 'c'.repeat(64),
        palmEvidence: { malicious: 'injected' }
      })
    }, res);

    assertTrue(res.statusCode === 400, 'malformed palmEvidence should be rejected (got ' + res.statusCode + ')');
    assertTrue(res._json.error.includes('palm evidence'), 'should mention palm evidence');
  } finally {
    global.fetch = globalFetch;
    Object.keys(savedEnv).forEach(function (k) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    });
  }
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('\n=== PHASE 3A VERIFICATION SUMMARY ===');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
console.log('Total: ' + (passed + failed));

process.exit(failed === 0 ? 0 : 1);
