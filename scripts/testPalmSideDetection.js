/**
 * PalmPyaar — palm-side visual detection regression suite (synthetic).
 *
 * SCOPE: synthetic pixel-buffer and landmark tests only, kept separate from
 * the real-photo suite (scripts/testPalmSideRealImages.js). These tests
 * exercise the deterministic side-detection helpers (computeSideStats,
 * assessVisualSideFromStats), their ordering inside validateImage, and the
 * false-positive guards (ring, lighting, single atypical fingertip,
 * low-chroma photos). They do NOT prove real-world recognition accuracy on
 * photographed hands — that coverage lives in the real-image suite.
 *
 * Covers (synthetic half of the palm-side test plan):
 *   D  normal palm with a ring is not rejected because of the ring
 *   E  normal palm under moderate lighting variation is not rejected
 *   F  existing invalid/cropped photos remain correctly rejected
 *   plus: dorsal-like pixel pattern rejected as back_of_hand, all
 *   conservative boundary conditions, and never-block behavior on
 *   missing/ambiguous input.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const PalmValidator = require(path.join(ROOT, 'js', 'palmValidator.js'));

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

// ---------------------------------------------------------------------------
// Synthetic image + landmark builders (100x100 canvas space)
// ---------------------------------------------------------------------------

const SKIN = [185, 155, 125];        // chroma ~0.324, typical palm-pad skin
const NAIL = [205, 198, 192];        // chroma ~0.063, nail plate
const METAL = [230, 230, 235];       // chroma ~0.022, ring metal

function makeImage(w, h, rgb) {
  const data = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = rgb[0];
    data[i * 4 + 1] = rgb[1];
    data[i * 4 + 2] = rgb[2];
    data[i * 4 + 3] = 255;
  }
  return { data, width: w, height: h };
}

function fillDisc(img, cx, cy, rad, rgb) {
  const rr = rad * rad;
  for (let y = Math.max(0, Math.floor(cy - rad)); y <= Math.min(img.height - 1, Math.ceil(cy + rad)); y++) {
    for (let x = Math.max(0, Math.floor(cx - rad)); x <= Math.min(img.width - 1, Math.ceil(cx + rad)); x++) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy > rr) continue;
      const i = (y * img.width + x) * 4;
      img.data[i] = rgb[0];
      img.data[i + 1] = rgb[1];
      img.data[i + 2] = rgb[2];
    }
  }
}

function applyGainGradient(img, from, to) {
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const f = from + (to - from) * (x / (img.width - 1));
      const i = (y * img.width + x) * 4;
      img.data[i] = Math.min(255, Math.round(img.data[i] * f));
      img.data[i + 1] = Math.min(255, Math.round(img.data[i + 1] * f));
      img.data[i + 2] = Math.min(255, Math.round(img.data[i + 2] * f));
    }
  }
}

function lm(x, y) {
  return { x: x, y: y, z: 0 };
}

// 21-landmark open hand, fingertips at known pixel positions on 100x100:
// thumb(27,55) index(40,32) middle(50,30) ring(60,32) pinky(68,39)
function sideLandmarks() {
  return [
    lm(0.50, 0.85),
    lm(0.40, 0.78), lm(0.34, 0.70), lm(0.30, 0.62), lm(0.27, 0.55),
    lm(0.42, 0.55), lm(0.41, 0.44), lm(0.405, 0.38), lm(0.40, 0.32),
    lm(0.50, 0.54), lm(0.50, 0.42), lm(0.50, 0.36), lm(0.50, 0.30),
    lm(0.58, 0.55), lm(0.59, 0.44), lm(0.595, 0.38), lm(0.60, 0.32),
    lm(0.66, 0.58), lm(0.67, 0.49), lm(0.675, 0.44), lm(0.68, 0.39)
  ];
}

const TIP_PX = [[27, 55], [40, 32], [50, 30], [60, 32], [68, 39]];

function palmBuffer() {
  return makeImage(100, 100, SKIN);
}

function dorsalBuffer() {
  const img = makeImage(100, 100, SKIN);
  for (const [x, y] of TIP_PX) fillDisc(img, x, y, 10, NAIL);
  return img;
}

function sideVerdict(img, landmarks) {
  return PalmValidator.assessVisualSideFromStats(PalmValidator.computeSideStats(img, landmarks));
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

check('S1: side-detection API is exported', function () {
  assertEqual(typeof PalmValidator.assessVisualSide, 'function', 'assessVisualSide');
  assertEqual(typeof PalmValidator.computeSideStats, 'function', 'computeSideStats');
  assertEqual(typeof PalmValidator.assessVisualSideFromStats, 'function', 'assessVisualSideFromStats');
});

// ---------------------------------------------------------------------------
// Core separation on synthetic buffers (dorsal pattern vs palm pattern)
// ---------------------------------------------------------------------------

check('S2: dorsal-like pixel pattern (nail-colored tips) rejected as back_of_hand', function () {
  const r = sideVerdict(dorsalBuffer(), sideLandmarks());
  assertEqual(r.ok, false, 'ok');
  assertEqual(r.problem, 'back_of_hand', 'problem');
});

check('S3: plain palm pixel pattern accepted', function () {
  const r = sideVerdict(palmBuffer(), sideLandmarks());
  assertEqual(r.ok, true, 'ok');
});

check('S4 [req D]: normal palm with a ring is not rejected because of the ring', function () {
  const img = palmBuffer();
  // Ring at the base of the ring finger (between MCP and PIP), the position
  // a real ring occupies — outside every fingertip disc.
  fillDisc(img, 59, 52, 6, METAL);
  const r = sideVerdict(img, sideLandmarks());
  assertEqual(r.ok, true, 'ok');
  const stats = PalmValidator.computeSideStats(img, sideLandmarks());
  assertTrue(stats.avgTipSat > 0.19, 'ring must not drag tip saturation down: ' + stats.avgTipSat);
});

check('S5 [req E]: normal palm under moderate lighting variation is not rejected', function () {
  const img = palmBuffer();
  applyGainGradient(img, 0.55, 1.4); // dim-to-bright across the frame
  const r = sideVerdict(img, sideLandmarks());
  assertEqual(r.ok, true, 'ok');
  const stats = PalmValidator.computeSideStats(img, sideLandmarks());
  assertTrue(stats.avgTipSat > 0.19, 'gain gradient changed saturation: ' + stats.avgTipSat);
});

check('S6: one atypical (dark/desaturated) fingertip does not block a palm', function () {
  const img = palmBuffer();
  fillDisc(img, 68, 39, 10, NAIL); // only the pinky tip looks odd
  const r = sideVerdict(img, sideLandmarks());
  assertEqual(r.ok, true, 'ok');
});

// ---------------------------------------------------------------------------
// Conservative boundary conditions (direct stats-level tests)
// ---------------------------------------------------------------------------

check('S7: full dorsal cluster below both thresholds is rejected', function () {
  const r = PalmValidator.assessVisualSideFromStats({ avgTipSat: 0.15, lowTipCount: 5, palmSat: 0.24 });
  assertEqual(r.problem, 'back_of_hand', 'clear dorsal');
});

check('S8: average just below the 0.19 threshold with 4 low tips is rejected', function () {
  const r = PalmValidator.assessVisualSideFromStats({ avgTipSat: 0.189, lowTipCount: 4, palmSat: 0.25 });
  assertEqual(r.problem, 'back_of_hand', 'boundary dorsal');
});

check('S9: average exactly at the threshold is NOT rejected (strict inequality)', function () {
  const r = PalmValidator.assessVisualSideFromStats({ avgTipSat: 0.19, lowTipCount: 5, palmSat: 0.25 });
  assertEqual(r.ok, true, 'boundary palm');
});

check('S10: low average but only 3 low tips is NOT rejected (4-of-5 guard)', function () {
  const r = PalmValidator.assessVisualSideFromStats({ avgTipSat: 0.15, lowTipCount: 3, palmSat: 0.25 });
  assertEqual(r.ok, true, 'ambiguous case must pass');
});

check('S11: washed-out photo (fingertips and palm center both low chroma) is NOT rejected', function () {
  const r = PalmValidator.assessVisualSideFromStats({ avgTipSat: 0.15, lowTipCount: 5, palmSat: 0.16 });
  assertEqual(r.ok, true, 'low-chroma palm must not be called dorsal');
});

// ---------------------------------------------------------------------------
// Never-block guarantees on missing / ambiguous input
// ---------------------------------------------------------------------------

check('S12: grayscale (no chroma) buffer is skipped, never labeled back_of_hand', function () {
  const gray = makeImage(100, 100, [200, 200, 200]);
  const stats = PalmValidator.computeSideStats(gray, sideLandmarks());
  assertEqual(stats, null, 'grayscale stats');
  assertEqual(PalmValidator.assessVisualSideFromStats(stats).ok, true, 'verdict');
});

check('S13: missing inputs return null stats and never block', function () {
  const img = palmBuffer();
  assertEqual(PalmValidator.computeSideStats(null, sideLandmarks()), null, 'null image');
  assertEqual(PalmValidator.computeSideStats(img, null), null, 'null landmarks');
  assertEqual(PalmValidator.computeSideStats(img, sideLandmarks().slice(0, 20)), null, '20 landmarks');
  assertEqual(PalmValidator.computeSideStats({ data: Buffer.alloc(10), width: 100, height: 100 }, sideLandmarks()), null, 'undersized buffer');
  assertEqual(PalmValidator.assessVisualSideFromStats(undefined).ok, true, 'undefined stats');
  assertEqual(PalmValidator.assessVisualSideFromStats({}).ok, true, 'empty stats');
});

check('S14: non-browser assessVisualSide (no document) skips instead of blocking', function () {
  const r = PalmValidator.assessVisualSide({ width: 10, height: 10 }, sideLandmarks());
  assertEqual(r.ok, true, 'ok');
});

// ---------------------------------------------------------------------------
// Structural: ordering inside validateImage + existing rejects intact
// ---------------------------------------------------------------------------

function readSrc(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

check('S15 [req C]: visual side check runs BEFORE framing checks in validateImage', function () {
  const src = readSrc('js/palmValidator.js');
  const fromResults = src.indexOf('handsInstance.onResults');
  assertTrue(fromResults > 0, 'onResults anchor missing');
  const body = src.slice(fromResults);
  const sideIdx = body.indexOf('assessVisualSide(img, landmarks)');
  const usabilityIdx = body.indexOf('assessPalmUsability(landmarks)');
  assertTrue(sideIdx > 0, 'side check call missing from validateImage');
  assertTrue(usabilityIdx > 0, 'usability call missing from validateImage');
  assertTrue(sideIdx < usabilityIdx, 'side check must run before usability so dorsal wins over cropped');
  assertTrue(body.indexOf('sideError.problem = sideCheck.problem') > 0, 'side rejection must carry back_of_hand problem code');
  assertTrue(body.indexOf('sideCheck.problem') < usabilityIdx, 'side rejection must be emitted before usability');
});

check('S16 [req F]: edge-cropped palm-like photo still rejects as cropped after side passes', function () {
  const edgeLms = sideLandmarks().map(p => lm(0.992 + (p.x - 0.5) * 0.006, p.y));
  const side = sideVerdict(palmBuffer(), edgeLms);
  assertEqual(side.ok, true, 'side must pass for a palm-colored image');
  assertEqual(PalmValidator.assessPalmUsability(edgeLms).problem, 'cropped', 'cropped geometry reject intact');
});

check('S17: existing geometry rejects unchanged (open-hand side landmark set passes usability)', function () {
  const r = PalmValidator.assessPalmUsability(sideLandmarks());
  assertEqual(r.ok, true, 'canonical synthetic open hand unaffected by side work');
});

// ---------------------------------------------------------------------------

console.log('\n=== PALM SIDE DETECTION (SYNTHETIC) TEST SUMMARY ===');
console.log('NOTE: synthetic pixel-buffer tests only - real-photo coverage is');
console.log('in scripts/testPalmSideRealImages.js; do not read these as');
console.log('real-world recognition accuracy.');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
console.log('Total: ' + (passed + failed));

process.exit(failed === 0 ? 0 : 1);
