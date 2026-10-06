/**
 * PalmPyaar — FIX 1 regression suite: palm image usability validation and
 * image-grounding integration (scripts/testPalmImageValidation.js).
 *
 * SCOPE: structural and synthetic-geometry tests only. The synthetic cases
 * below exercise the deterministic geometry/quality helpers with constructed
 * landmark sets and pixel buffers. They verify the validation logic, its
 * wiring, and its localization — they do NOT prove real-world visual
 * recognition accuracy on photographed hands, and no test here uploads an
 * image anywhere (the production pipeline never uploads images at all).
 *
 * Covers:
 *   A  palmValidator export surface (FIX 1a)
 *   B  localized customer-facing photo-request messages (FIX 1a)
 *   C  assessPalmUsability synthetic landmark cases (FIX 1a)
 *   D  analyzeImageQuality synthetic pixel-buffer cases (FIX 1a)
 *   E  assessEvidenceUsability server-side evidence checks (FIX 1a)
 *   F  extractGeometry purity — geometry only, never lines/mounts (FIX 1a)
 *   G  answerTemplates photoRequest + productHowItWorks copy (FIX 1b)
 *   H  api/ask-question server guard: reject unusable, never reject null
 *      evidence, localized 400 (FIX 1c)
 *   I  providers/groqProvider palm geometry grounding block (FIX 1d)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const PalmValidator = require(path.join(ROOT, 'js', 'palmValidator.js'));
const templates = require(path.join(ROOT, 'providers', 'answerTemplates.js'));

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

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error((label || 'value') + ': expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
  }
}

function assertContains(text, substring, message) {
  if (!String(text).includes(substring)) {
    throw new Error((message || '') + ': expected to contain "' + substring + '"');
  }
}

function readSrc(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

// ---------------------------------------------------------------------------
// A. palmValidator export surface
// ---------------------------------------------------------------------------

check('A1: palmValidator exports the full validation API', function () {
  const expected = [
    'validateImage', 'isReady', 'load', 'extractGeometry', 'isValidPalmEvidence',
    'getPhotoRequestMessage', 'assessPalmUsability', 'assessEvidenceUsability',
    'assessOrientation', 'analyzeImageQuality'
  ];
  for (const key of expected) {
    assertTrue(typeof PalmValidator[key] === 'function', 'missing export: ' + key);
  }
});

// ---------------------------------------------------------------------------
// B. localized photo-request messages
// ---------------------------------------------------------------------------

check('B1: getPhotoRequestMessage returns distinct quality vs palm messages', function () {
  const quality = PalmValidator.getPhotoRequestMessage('quality');
  const palm = PalmValidator.getPhotoRequestMessage('palm');
  assertTrue(typeof quality === 'string' && quality.length > 40, 'quality message missing');
  assertTrue(typeof palm === 'string' && palm.length > 40, 'palm message missing');
  assertTrue(quality !== palm, 'quality and palm messages must differ');
});

check('B2: all six language packs contain both message kinds', function () {
  const src = readSrc('js/palmValidator.js');
  for (const code of ['en', 'te', 'hi', 'ta', 'kn', 'ml']) {
    const re = new RegExp('\\b' + code + ':\\s*\\{[^}]*quality:[^}]*palm:', 'm');
    assertTrue(re.test(src), 'language pack incomplete: ' + code);
  }
});

check('B3: native-script packs written in their own script', function () {
  const src = readSrc('js/palmValidator.js');
  assertContains(src, 'అరచేతి', 'telugu pack missing native script');
  assertContains(src, 'हथेली', 'hindi pack missing native script');
  assertContains(src, 'உள்ளங்கை', 'tamil pack missing native script');
  assertContains(src, 'ಹಸ್ತ', 'kannada pack missing native script');
  assertContains(src, 'കൈപ്പത്തി', 'malayalam pack missing native script');
});

check('B4: English pack is the default fallback (photo wording present)', function () {
  const src = readSrc('js/palmValidator.js');
  assertContains(src, 'PHOTO_REQUEST_MESSAGES.en', 'English default pack not referenced');
  assertContains(src, 'open palm', 'English palm request copy missing');
});

// ---------------------------------------------------------------------------
// C. assessPalmUsability — synthetic 21-landmark cases
// ---------------------------------------------------------------------------

function lm(x, y, z) {
  return { x: x, y: y, z: (typeof z === 'number' ? z : 0) };
}

function canonicalPalm() {
  return [
    lm(0.45, 0.55),
    lm(0.36, 0.50), lm(0.34, 0.45), lm(0.32, 0.40), lm(0.30, 0.35),
    lm(0.37, 0.42), lm(0.36, 0.34), lm(0.355, 0.29), lm(0.35, 0.24),
    lm(0.43, 0.41), lm(0.43, 0.32), lm(0.43, 0.27), lm(0.43, 0.22),
    lm(0.49, 0.42), lm(0.50, 0.34), lm(0.505, 0.29), lm(0.51, 0.24),
    lm(0.55, 0.44), lm(0.57, 0.37), lm(0.575, 0.33), lm(0.58, 0.28)
  ];
}

function tallSidewaysPalm() {
  return [
    lm(0.50, 0.75),
    lm(0.41, 0.68), lm(0.40, 0.62), lm(0.40, 0.56), lm(0.41, 0.50),
    lm(0.45, 0.55), lm(0.44, 0.42), lm(0.435, 0.35), lm(0.43, 0.28),
    lm(0.50, 0.55), lm(0.50, 0.40), lm(0.50, 0.33), lm(0.50, 0.26),
    lm(0.55, 0.56), lm(0.56, 0.43), lm(0.565, 0.36), lm(0.57, 0.29),
    lm(0.59, 0.58), lm(0.60, 0.47), lm(0.60, 0.41), lm(0.60, 0.35)
  ];
}

function scaleToBox(lms, x0, x1, y0, y1) {
  const xs = lms.map(p => p.x);
  const ys = lms.map(p => p.y);
  const minX = Math.min.apply(null, xs);
  const maxX = Math.max.apply(null, xs);
  const minY = Math.min.apply(null, ys);
  const maxY = Math.max.apply(null, ys);
  return lms.map(function (p) {
    return lm(
      x0 + ((p.x - minX) / (maxX - minX)) * (x1 - x0),
      y0 + ((p.y - minY) / (maxY - minY)) * (y1 - y0),
      p.z
    );
  });
}

check('C1: canonical open synthetic palm passes usability', function () {
  const r = PalmValidator.assessPalmUsability(canonicalPalm());
  assertTrue(r.ok === true, 'canonical palm rejected: ' + r.problem);
  assertEqual(r.problem, null, 'canonical problem');
});

check('C2: missing/short landmark sets are missing_hand', function () {
  assertEqual(PalmValidator.assessPalmUsability(null).problem, 'missing_hand', 'null');
  assertEqual(PalmValidator.assessPalmUsability([]).problem, 'missing_hand', 'empty');
  assertEqual(PalmValidator.assessPalmUsability(canonicalPalm().slice(0, 20)).problem, 'missing_hand', '20 landmarks');
});

check('C3: all-points-same frame is degenerate', function () {
  const flat = [];
  for (let i = 0; i < 21; i++) flat.push(lm(0.5, 0.5));
  assertEqual(PalmValidator.assessPalmUsability(flat).problem, 'degenerate', 'degenerate frame');
});

check('C4: landmark touching the frame edge is cropped', function () {
  const lms = canonicalPalm();
  lms[0] = lm(0.005, 0.55);
  assertEqual(PalmValidator.assessPalmUsability(lms).problem, 'cropped', 'edge crop');
});

check('C5: palm occupying almost none of the frame is too_small', function () {
  const tiny = scaleToBox(canonicalPalm(), 0.40, 0.52, 0.40, 0.50);
  assertEqual(PalmValidator.assessPalmUsability(tiny).problem, 'too_small', 'tiny palm');
});

check('C6: curled fingers are fingers_closed', function () {
  const lms = canonicalPalm();
  const tips = [8, 12, 16, 20];
  const pips = [6, 10, 14, 18];
  for (let i = 0; i < tips.length; i++) {
    lms[tips[i]] = lm(lms[tips[i]].x, lms[pips[i]].y + 0.06, 0);
  }
  assertEqual(PalmValidator.assessPalmUsability(lms).problem, 'fingers_closed', 'curled fingers');
});

check('C7: fingers pressed together are fingers_together', function () {
  const lms = canonicalPalm();
  lms[17] = lm(0.37, 0.44);
  lms[18] = lm(0.375, 0.37);
  lms[19] = lm(0.375, 0.33);
  lms[20] = lm(0.37, 0.28);
  assertEqual(PalmValidator.assessPalmUsability(lms).problem, 'fingers_together', 'bunched pinky');
});

check('C8: narrow tall frame is sideways', function () {
  assertEqual(PalmValidator.assessPalmUsability(tallSidewaysPalm()).problem, 'sideways', 'tall profile');
});

check('C9: structural back-of-hand cluster is back_of_hand', function () {
  const lms = canonicalPalm();
  [8, 12, 16, 20].forEach(function (i) { lms[i].z = 0.1; });
  lms[4] = lm(0.375, 0.425);
  assertEqual(PalmValidator.assessPalmUsability(lms).problem, 'back_of_hand', 'dorsal cues');
});

check('C10: usability problems are stable machine codes', function () {
  const codes = ['missing_hand', 'degenerate', 'cropped', 'too_small', 'fingers_closed',
    'fingers_together', 'sideways', 'back_of_hand'];
  const src = readSrc('js/palmValidator.js');
  for (const code of codes) {
    assertContains(src, "'" + code + "'", 'problem code missing from source: ' + code);
  }
});

// ---------------------------------------------------------------------------
// D. analyzeImageQuality — synthetic pixel buffers
// ---------------------------------------------------------------------------

function grayBuffer(w, h, valueAt) {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = valueAt(x, y);
      const i = (y * w + x) * 4;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { data: data, width: w, height: h };
}

check('D1: near-black frame is too_dark', function () {
  const q = PalmValidator.analyzeImageQuality(grayBuffer(32, 32, function () { return 10; }));
  assertEqual(q.problem, 'too_dark', 'dark frame');
});

check('D2: blown-out frame is too_bright', function () {
  const q = PalmValidator.analyzeImageQuality(grayBuffer(32, 32, function () { return 240; }));
  assertEqual(q.problem, 'too_bright', 'bright frame');
});

check('D3: flat frame is low_contrast', function () {
  const q = PalmValidator.analyzeImageQuality(grayBuffer(32, 32, function (x, y) {
    return ((x + y) % 2 === 0) ? 126 : 130;
  }));
  assertEqual(q.problem, 'low_contrast', 'flat frame');
});

check('D4: smooth gradient is blurry (no edges)', function () {
  const q = PalmValidator.analyzeImageQuality(grayBuffer(64, 64, function (x) {
    return Math.round(60 + (x * 140) / 63);
  }));
  assertTrue(q.contrast >= 12, 'gradient should have contrast, got ' + q.contrast);
  assertEqual(q.problem, 'blurry', 'gradient frame');
});

check('D5: sharp high-contrast frame passes with no problem', function () {
  const q = PalmValidator.analyzeImageQuality(grayBuffer(64, 64, function (x, y) {
    const block = ((Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0);
    return block ? 40 : 210;
  }));
  assertTrue(q.sharpness > 8, 'checkerboard should be sharp, got ' + q.sharpness);
  assertEqual(q.problem, null, 'good frame');
});

check('D6: missing pixel data returns null (quality check skipped, never blocks)', function () {
  assertEqual(PalmValidator.analyzeImageQuality(null), null, 'null');
  assertEqual(PalmValidator.analyzeImageQuality({ data: null, width: 10, height: 10 }), null, 'no data');
  assertEqual(PalmValidator.analyzeImageQuality({ data: [1, 2, 3], width: 2, height: 2 }), null, 'too small');
});

// ---------------------------------------------------------------------------
// E. assessEvidenceUsability — server-side evidence checks
// ---------------------------------------------------------------------------

function validEvidence(overrides) {
  const base = {
    palmBounds: { width: 0.3, height: 0.4, aspectRatio: 0.75 },
    fingerRatios: { index: 0.9, middle: 0.9, ring: 0.9, pinky: 0.9, thumb: 0.8 },
    geometricRatios: { indexToMiddle: 1.0, fingerSpanToHeight: 2.0, thumbToIndex: 1.5 },
    palmAngle: 12
  };
  const out = JSON.parse(JSON.stringify(base));
  if (overrides) {
    for (const k of Object.keys(overrides)) {
      if (typeof overrides[k] === 'object' && overrides[k] !== null) {
        Object.assign(out[k], overrides[k]);
      } else {
        out[k] = overrides[k];
      }
    }
  }
  return out;
}

check('E1: usable valid evidence returns null (never blocks)', function () {
  assertEqual(PalmValidator.assessEvidenceUsability(validEvidence()), null, 'usable evidence');
});

check('E2: impossible aspect ratio is aspect_ratio', function () {
  const ev = validEvidence({ palmBounds: { width: 0.5, height: 1.0, aspectRatio: 0.5 } });
  assertEqual(PalmValidator.assessEvidenceUsability(ev), 'aspect_ratio', 'narrow ratio');
});

check('E3: palm almost none of frame is palm_too_small', function () {
  const ev = validEvidence({ palmBounds: { width: 0.03, height: 0.05, aspectRatio: 0.6 } });
  assertEqual(PalmValidator.assessEvidenceUsability(ev), 'palm_too_small', 'tiny evidence');
});

check('E4: never-extended fingers are fingers_not_extended', function () {
  const ev = validEvidence({ fingerRatios: { index: 0.5, middle: 0.5, ring: 0.5, pinky: 0.5, thumb: 0.5 } });
  assertEqual(PalmValidator.assessEvidenceUsability(ev), 'fingers_not_extended', 'curled evidence');
});

check('E5: invalid-shaped evidence returns null (legacy MODE A is never rejected)', function () {
  assertEqual(PalmValidator.assessEvidenceUsability(null), null, 'null');
  assertEqual(PalmValidator.assessEvidenceUsability(undefined), null, 'undefined');
  assertEqual(PalmValidator.assessEvidenceUsability({}), null, 'empty');
  assertEqual(PalmValidator.assessEvidenceUsability({ foo: 1 }), null, 'unexpected keys');
  assertEqual(PalmValidator.assessEvidenceUsability('not-an-object'), null, 'string');
  assertEqual(PalmValidator.assessEvidenceUsability([1, 2, 3]), null, 'array');
  assertEqual(PalmValidator.assessEvidenceUsability(validEvidence({ palmAngle: 999 })), null, 'out-of-range angle');
});

// ---------------------------------------------------------------------------
// F. extractGeometry — geometry only, never lines/mounts
// ---------------------------------------------------------------------------

check('F1: extractGeometry output passes the strict whitelist validator', function () {
  const evidence = PalmValidator.extractGeometry(canonicalPalm());
  assertTrue(evidence && typeof evidence === 'object', 'no evidence extracted');
  assertTrue(PalmValidator.isValidPalmEvidence(evidence), 'evidence failed whitelist');
  assertEqual(Object.keys(evidence).sort().join(','),
    'fingerRatios,geometricRatios,palmAngle,palmBounds', 'top-level keys');
});

check('F2: extracted evidence contains no palm-line or mount fields anywhere', function () {
  const evidence = PalmValidator.extractGeometry(canonicalPalm());
  const flat = JSON.stringify(evidence).toLowerCase();
  for (const banned of ['line', 'mount', 'marking', 'creases', 'heart', 'fate']) {
    assertTrue(flat.indexOf(banned) === -1, 'banned concept in evidence: ' + banned);
  }
});

check('F3: extractGeometry rejects missing/short landmark input', function () {
  assertEqual(PalmValidator.extractGeometry(null), null, 'null');
  assertEqual(PalmValidator.extractGeometry(canonicalPalm().slice(0, 10)), null, 'short');
});

// ---------------------------------------------------------------------------
// G. answerTemplates — localized photoRequest + productHowItWorks copy
// ---------------------------------------------------------------------------

check('G1: getPhotoRequest is exported and localized per language', function () {
  assertTrue(typeof templates.getPhotoRequest === 'function', 'getPhotoRequest missing');
  const en = templates.getPhotoRequest('english');
  const te = templates.getPhotoRequest('telugu');
  assertContains(en, 'open palm', 'English photo request');
  assertTrue(/[ఀ-౿]/.test(te), 'telugu photo request not in Telugu script');
  assertTrue(te !== en, 'telugu request must differ from English');
});

check('G2: every localized bundle ships photoRequest and productHowItWorks', function () {
  for (const lang of ['telugu', 'hindi', 'tamil', 'kannada', 'malayalam']) {
    const bundle = templates.getLocalizedBundle(lang);
    assertTrue(bundle, 'bundle missing for ' + lang);
    assertTrue(typeof bundle.photoRequest === 'string' && bundle.photoRequest.length > 30,
      lang + ' photoRequest missing');
    assertTrue(typeof bundle.productHowItWorks === 'string' && bundle.productHowItWorks.length > 30,
      lang + ' productHowItWorks missing');
  }
});

check('G3: SHARED_TOP_KEYS includes the two new copy keys', function () {
  const src = readSrc('providers/answerTemplates.js');
  const m = src.match(/SHARED_TOP_KEYS\s*=\s*\[([^\]]*)\]/);
  assertTrue(m, 'SHARED_TOP_KEYS not found');
  assertContains(m[1], 'photoRequest', 'photoRequest not shared');
  assertContains(m[1], 'productHowItWorks', 'productHowItWorks not shared');
});

// ---------------------------------------------------------------------------
// H. api/ask-question — server-side guard (FIX 1c)
// ---------------------------------------------------------------------------

check('H1: server guard rejects unusable present evidence with localized 400', function () {
  const src = readSrc('api/ask-question.js');
  const re = /if \(palmEvidence\) \{[\s\S]{0,500}?assessEvidenceUsability\(evidenceForCheck\)[\s\S]{0,400}?PHOTO_UNUSABLE/;
  assertTrue(re.test(src), 'guard block missing or restructured');
  assertContains(src, 'getPhotoRequest(detectedLanguage)', '400 response not localized');
});

check('H2: null evidence is never rejected (legacy path preserved)', function () {
  const src = readSrc('api/ask-question.js');
  const idxGuard = src.indexOf('if (palmEvidence) {');
  const idxCheck = src.indexOf('assessEvidenceUsability(evidenceForCheck)');
  assertTrue(idxGuard >= 0 && idxCheck > idxGuard, 'evidence check not inside presence guard');
  assertContains(src, 'Missing evidence is the legacy geometry-less path', 'null-evidence contract comment missing');
});

check('H3: string evidence is parsed defensively (bad JSON falls back to null)', function () {
  const src = readSrc('api/ask-question.js');
  const re = /if \(palmEvidence\) \{[\s\S]{0,300}?JSON\.parse\(palmEvidence\)[\s\S]{0,200}?evidenceForCheck = null;/;
  assertTrue(re.test(src), 'defensive parse missing');
});

check('H4: ask-question imports both new FIX 1 dependencies', function () {
  const src = readSrc('api/ask-question.js');
  assertContains(src, 'assessEvidenceUsability', 'palmValidator not imported');
  assertContains(src, 'getPhotoRequest', 'answerTemplates photo request not imported');
  assertContains(src, "require('../js/palmValidator')", 'palmValidator require missing');
});

check('H5: raw image bytes never reach the server', function () {
  const src = readSrc('api/ask-question.js');
  assertTrue(src.indexOf('data:image') === -1, 'image data referenced in ask-question');
});

// ---------------------------------------------------------------------------
// I. providers/groqProvider — palm geometry grounding (FIX 1d)
// ---------------------------------------------------------------------------

check('I1: geometry block is whitelist-gated before formatting', function () {
  const src = readSrc('providers/groqProvider.js');
  const re = /isValidPalmEvidence\(params\.palmEvidence\)\s*\?\s*formatPalmGeometryEvidence\(params\.palmEvidence\)\s*:\s*''/;
  assertTrue(re.test(src), 'palmGeometryBlock not whitelist-gated');
});

check('I2: prompt forbids invented palm lines and hand description beyond evidence', function () {
  const src = readSrc('providers/groqProvider.js');
  assertContains(src, 'Never claim to observe palm lines', 'no palm-line prohibition');
  assertContains(src, 'never describe the customer', 'no evidence-bounded description rule');
  assertContains(src, 'palmGeometryBlock', 'geometry block not threaded into prompt');
});

check('I3: geometry formatter emits measurements plus its own no-claims rules', function () {
  const src = readSrc('providers/palmGeometryFormatter.js');
  assertContains(src, 'PALM GEOMETRY EVIDENCE', 'evidence header missing');
  assertContains(src, 'Do not rename these measurements', 'no-named-palmistry-claims rule missing');
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('\n=== FIX 1: PALM IMAGE VALIDATION TEST SUMMARY ===');
console.log('NOTE: structural/synthetic tests only — they do not prove');
console.log('real-world visual recognition accuracy on photographed hands.');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
console.log('Total: ' + (passed + failed));

process.exit(failed === 0 ? 0 : 1);
