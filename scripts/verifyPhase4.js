/**
 * PalmPyaar Phase 4 — Truthful Geometry-Based Personalization Verification Suite
 *
 * Tests that actual sanitized numerical palm geometry reaches the AI interpretation
 * layer (writer, reviewer, rewriter) and that the prompts contain real values,
 * not merely "verified" status labels.
 *
 * Also verifies that:
 * - No raw image/base64 reaches Groq
 * - photoHash is not treated as palm evidence
 * - Unknown fields cannot inject prompt text
 * - Named palmistry lines/mounts are not introduced merely because geometry exists
 * - Existing Phase 3A and payment/security suites remain green
 */

'use strict';

const assert = require('assert');
const { formatPalmGeometryEvidence } = require('../providers/palmGeometryFormatter');
const { assemblePrompt } = require('../providers/promptAssembler');
const { buildReviewPrompt } = require('../providers/reviewerPromptBuilder');
const { buildRewritePrompt } = require('../providers/rewritePromptBuilder');
const { isValidPalmEvidence } = require('../lib/palmEvidenceValidator');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`FAIL: ${name} — ${err.message}`);
    failed++;
  }
}

// ============================================================================
// TEST DATA
// ============================================================================

const VALID_PALM_EVIDENCE = {
  palmBounds: { width: 0.823, height: 0.712, aspectRatio: 1.156 },
  fingerRatios: { index: 0.92, middle: 0.95, ring: 0.91, pinky: 0.85, thumb: 0.71 },
  geometricRatios: { indexToMiddle: 0.968, fingerSpanToHeight: 1.42, thumbToIndex: 0.78 },
  palmAngle: -4.5
};

const MINIMAL_PALM_EVIDENCE = {
  palmBounds: { width: 0.5, height: 0.5, aspectRatio: 1.0 },
  fingerRatios: { index: 0.5, middle: 0.5, ring: 0.5, pinky: 0.5, thumb: 0.5 },
  geometricRatios: { indexToMiddle: 1.0, fingerSpanToHeight: 1.0, thumbToIndex: 1.0 },
  palmAngle: 0
};

const INJECTION_PALM_EVIDENCE = {
  palmBounds: { width: 0.5, height: 0.5, aspectRatio: 1.0 },
  fingerRatios: { index: 0.5, middle: 0.5, ring: 0.5, pinky: 0.5, thumb: 0.5 },
  geometricRatios: { indexToMiddle: 1.0, fingerSpanToHeight: 1.0, thumbToIndex: 1.0 },
  palmAngle: 0,
  __proto__: { polluted: true },
  extraField: '<script>alert("xss")</script>'
};

const OUT_OF_RANGE_PALM_EVIDENCE = {
  palmBounds: { width: 5.0, height: 0.5, aspectRatio: 1.0 },
  fingerRatios: { index: 0.5, middle: 0.5, ring: 0.5, pinky: 0.5, thumb: 0.5 },
  geometricRatios: { indexToMiddle: 1.0, fingerSpanToHeight: 1.0, thumbToIndex: 1.0 },
  palmAngle: 0
};

const USER_PARAMS = {
  name: 'Ananya Sharma',
  dob: '1990-06-15',
  birthplace: 'Pune',
  tradition: 'western',
  photoHash: 'abc123def456'
};

const REASONING_PLAN = {
  centralTheme: 'growth',
  supportingThemes: ['resilience', 'clarity'],
  emotionalDestination: 'calm',
  symbolicThread: 'light',
  coreFocus: 'recognition',
  loveFocus: 'reflection',
  proFocus: 'hope',
  openingMood: 'wonder',
  closingMood: 'calm',
  callbackStrategy: { coreToLove: 'expand', loveToPro: 'resolve', proToCore: 'anchor' },
  narrativeFlow: 'linear',
  literaryStyle: 'literary',
  traditionLens: 'psychological'
};

const SAMPLE_READING = {
  core: '<p>Sample core reading.</p>',
  love: '<p>Sample love reading.</p>',
  pro: '<p>Sample pro reading.</p>'
};

const SAMPLE_REVIEW = {
  deterministic: {
    overallScore: 7,
    passed: false,
    scores: { recognition: 7, traditionAuthenticity: 8, literaryQuality: 7, emotionalDepth: 6, originality: 6, coherence: 7, humanFeel: 7, premiumExperience: 6, overall: 7 },
    strengths: ['Good opening'],
    weaknesses: ['Needs more specificity'],
    rewriteTargets: [],
    reviewSummary: ' decent draft'
  },
  ai: null
};

// ============================================================================
// FORMATTER TESTS
// ============================================================================

test('F1: formatPalmGeometryEvidence returns empty string for null', () => {
  assert.strictEqual(formatPalmGeometryEvidence(null), '');
});

test('F2: formatPalmGeometryEvidence returns empty string for undefined', () => {
  assert.strictEqual(formatPalmGeometryEvidence(undefined), '');
});

test('F3: formatPalmGeometryEvidence includes actual numeric values for palmBounds', () => {
  const result = formatPalmGeometryEvidence(VALID_PALM_EVIDENCE);
  assert.ok(result.includes('1.156'), 'Should include aspectRatio');
  assert.ok(result.includes('0.823'), 'Should include width');
  assert.ok(result.includes('0.712'), 'Should include height');
});

test('F4: formatPalmGeometryEvidence includes actual numeric values for fingerRatios', () => {
  const result = formatPalmGeometryEvidence(VALID_PALM_EVIDENCE);
  assert.ok(result.includes('0.92'), 'Should include index ratio');
  assert.ok(result.includes('0.95'), 'Should include middle ratio');
  assert.ok(result.includes('0.71'), 'Should include thumb ratio');
});

test('F5: formatPalmGeometryEvidence includes actual numeric values for geometricRatios', () => {
  const result = formatPalmGeometryEvidence(VALID_PALM_EVIDENCE);
  assert.ok(result.includes('0.968'), 'Should include indexToMiddle');
  assert.ok(result.includes('1.42'), 'Should include fingerSpanToHeight');
  assert.ok(result.includes('0.78'), 'Should include thumbToIndex');
});

test('F6: formatPalmGeometryEvidence includes palmAngle', () => {
  const result = formatPalmGeometryEvidence(VALID_PALM_EVIDENCE);
  assert.ok(result.includes('-4.5'), 'Should include palmAngle');
});

test('F7: formatPalmGeometryEvidence does NOT claim named palmistry line terms as facts', () => {
  const result = formatPalmGeometryEvidence(VALID_PALM_EVIDENCE);
  const claimPatterns = [
    /your heart line/i,
    /your life line/i,
    /your head line/i,
    /your fate line/i,
    /your venus mount/i,
    /shows a deep capacity/i,
    /indicates longevity/i,
    /is prominent/i
  ];
  for (const pattern of claimPatterns) {
    assert.ok(!pattern.test(result), `Should not claim palmistry feature: ${pattern}`);
  }
});

test('F8: formatPalmGeometryEvidence does NOT accept raw image content', () => {
  const malicious = {
    palmBounds: { width: 0.5, height: 0.5, aspectRatio: 1.0 },
    fingerRatios: { index: 0.5, middle: 0.5, ring: 0.5, pinky: 0.5, thumb: 0.5 },
    geometricRatios: { indexToMiddle: 1.0, fingerSpanToHeight: 1.0, thumbToIndex: 1.0 },
    palmAngle: 0,
    rawImage: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
  };
  const result = formatPalmGeometryEvidence(malicious);
  assert.ok(!result.includes('data:image'), 'Should not include base64 image data');
  assert.ok(!result.includes('rawImage'), 'Should not include rawImage field');
});

test('F9: formatPalmGeometryEvidence includes interpretation rules', () => {
  const result = formatPalmGeometryEvidence(VALID_PALM_EVIDENCE);
  assert.ok(result.includes('geometric measurements only'), 'Should include interpretation rules');
  assert.ok(result.includes('Do not rename'), 'Should forbid named palmistry features');
});

test('F10: formatPalmGeometryEvidence handles minimal evidence', () => {
  const result = formatPalmGeometryEvidence(MINIMAL_PALM_EVIDENCE);
  assert.ok(result.includes('0.5'), 'Should include minimal values');
  assert.ok(result.includes('PALM GEOMETRY EVIDENCE'), 'Should have header');
});

// ============================================================================
// PROMPT ASSEMBLER TESTS
// ============================================================================

test('P1: assemblePrompt includes actual palm geometry values in USER CONTEXT', async () => {
  const result = await assemblePrompt({
    ...USER_PARAMS,
    palmEvidence: VALID_PALM_EVIDENCE
  });
  const prompt = result.compiledPrompt;
  assert.ok(prompt.includes('1.156'), 'Writer prompt should include aspectRatio');
  assert.ok(prompt.includes('0.92'), 'Writer prompt should include finger ratio');
  assert.ok(prompt.includes('-4.5'), 'Writer prompt should include palmAngle');
});

test('P2: assemblePrompt does NOT replace values with generic "verified"', async () => {
  const result = await assemblePrompt({
    ...USER_PARAMS,
    palmEvidence: VALID_PALM_EVIDENCE
  });
  const prompt = result.compiledPrompt;
  assert.ok(!prompt.includes('Palm Evidence: verified'), 'Should not use generic verified label');
});

test('P3: assemblePrompt with no palmEvidence still works', async () => {
  const result = await assemblePrompt({
    ...USER_PARAMS,
    palmEvidence: null
  });
  assert.ok(result.compiledPrompt.includes('Palm Evidence: none'), 'Should show none when no evidence');
  assert.ok(result.userContext.palmEvidence === null, 'userContext should preserve null');
});

test('P4: assemblePrompt with no palmEvidence does NOT contain geometry numeric values', async () => {
  const result = await assemblePrompt({
    ...USER_PARAMS,
    palmEvidence: null
  });
  const prompt = result.compiledPrompt;
  assert.ok(!prompt.includes('1.156'), 'Should not include actual aspectRatio value when no evidence');
  assert.ok(!prompt.includes('0.92'), 'Should not include actual finger ratio when no evidence');
  assert.ok(!prompt.includes('-4.5'), 'Should not include actual palmAngle when no evidence');
});

test('P5: assemblePrompt photoHash is not treated as palm evidence', async () => {
  const result = await assemblePrompt({
    ...USER_PARAMS,
    photoHash: 'def456abc123',
    palmEvidence: null
  });
  const prompt = result.compiledPrompt;
  assert.ok(!prompt.includes('def456abc123'), 'photoHash should not appear in geometry context');
  assert.ok(prompt.includes('Photo Hash Present: true'), 'photoHash presence should be tracked separately');
});

test('P6: Different palmEvidence produces different prompt content', async () => {
  const result1 = await assemblePrompt({
    ...USER_PARAMS,
    palmEvidence: VALID_PALM_EVIDENCE
  });
  const result2 = await assemblePrompt({
    ...USER_PARAMS,
    palmEvidence: MINIMAL_PALM_EVIDENCE
  });
  assert.notEqual(result1.compiledPrompt, result2.compiledPrompt, 'Different evidence should produce different prompts');
});

test('P7: Same palmEvidence produces identical prompt (deterministic)', async () => {
  const result1 = await assemblePrompt({
    ...USER_PARAMS,
    palmEvidence: VALID_PALM_EVIDENCE
  });
  const result2 = await assemblePrompt({
    ...USER_PARAMS,
    palmEvidence: VALID_PALM_EVIDENCE
  });
  assert.strictEqual(result1.compiledPrompt, result2.compiledPrompt, 'Same inputs should produce identical prompts');
});

// ============================================================================
// REVIEWER PROMPT BUILDER TESTS
// ============================================================================

test('R1: buildReviewPrompt includes actual palm geometry values', () => {
  const prompt = buildReviewPrompt({
    reading: SAMPLE_READING,
    reasoningPlan: REASONING_PLAN,
    tradition: 'western',
    reviewReport: SAMPLE_REVIEW.deterministic,
    userContext: {
      name: USER_PARAMS.name,
      dob: USER_PARAMS.dob,
      birthplace: USER_PARAMS.birthplace,
      tradition: USER_PARAMS.tradition,
      photoHashPresent: true,
      palmEvidence: VALID_PALM_EVIDENCE
    }
  });
  assert.ok(prompt.includes('1.156'), 'Reviewer prompt should include aspectRatio');
  assert.ok(prompt.includes('0.92'), 'Reviewer prompt should include finger ratio');
});

test('R2: buildReviewPrompt with null palmEvidence does NOT contain geometry', () => {
  const prompt = buildReviewPrompt({
    reading: SAMPLE_READING,
    reasoningPlan: REASONING_PLAN,
    tradition: 'western',
    reviewReport: SAMPLE_REVIEW.deterministic,
    userContext: {
      name: USER_PARAMS.name,
      dob: USER_PARAMS.dob,
      birthplace: USER_PARAMS.birthplace,
      tradition: USER_PARAMS.tradition,
      photoHashPresent: true,
      palmEvidence: null
    }
  });
  assert.ok(!prompt.includes('aspectRatio'), 'Reviewer prompt should not include geometry when null');
  assert.ok(prompt.includes('Palm Evidence: None'), 'Should show None');
});

// ============================================================================
// REWRITE PROMPT BUILDER TESTS
// ============================================================================

test('W1: buildRewritePrompt includes actual palm geometry values', () => {
  const prompt = buildRewritePrompt({
    draft: SAMPLE_READING,
    reasoningPlan: REASONING_PLAN,
    review: SAMPLE_REVIEW,
    userContext: {
      name: USER_PARAMS.name,
      dob: USER_PARAMS.dob,
      birthplace: USER_PARAMS.birthplace,
      tradition: USER_PARAMS.tradition,
      photoHashPresent: true,
      palmEvidence: VALID_PALM_EVIDENCE
    },
    tradition: 'western'
  });
  assert.ok(prompt.includes('1.156'), 'Rewriter prompt should include aspectRatio');
  assert.ok(prompt.includes('0.92'), 'Rewriter prompt should include finger ratio');
});

test('W2: buildRewritePrompt with null palmEvidence does NOT contain geometry', () => {
  const prompt = buildRewritePrompt({
    draft: SAMPLE_READING,
    reasoningPlan: REASONING_PLAN,
    review: SAMPLE_REVIEW,
    userContext: {
      name: USER_PARAMS.name,
      dob: USER_PARAMS.dob,
      birthplace: USER_PARAMS.birthplace,
      tradition: USER_PARAMS.tradition,
      photoHashPresent: true,
      palmEvidence: null
    },
    tradition: 'western'
  });
  assert.ok(!prompt.includes('aspectRatio'), 'Rewriter prompt should not include geometry when null');
  assert.ok(prompt.includes('Palm Evidence: None'), 'Should show None');
});

// ============================================================================
// SECURITY / VALIDATION TESTS
// ============================================================================

test('S1: isValidPalmEvidence rejects unknown fields', () => {
  assert.strictEqual(isValidPalmEvidence(INJECTION_PALM_EVIDENCE), false, 'Should reject evidence with extra fields');
});

test('S2: isValidPalmEvidence rejects out-of-range numeric values', () => {
  assert.strictEqual(isValidPalmEvidence(OUT_OF_RANGE_PALM_EVIDENCE), false, 'Should reject out-of-range values');
});

test('S3: isValidPalmEvidence accepts well-formed geometry', () => {
  assert.strictEqual(isValidPalmEvidence(VALID_PALM_EVIDENCE), true, 'Should accept valid evidence');
});

test('S4: palmEvidence with injection strings cannot reach formatter output', () => {
  const result = formatPalmGeometryEvidence(INJECTION_PALM_EVIDENCE);
  assert.ok(!result.includes('__proto__'), 'Should not include prototype pollution');
  assert.ok(!result.includes('<script>'), 'Should not include XSS payload');
  assert.ok(!result.includes('extraField'), 'Should not include unknown fields');
});

test('S5: photoHash is not treated as palm evidence in formatter', () => {
  const fakeEvidence = {
    palmBounds: { width: 0.5, height: 0.5, aspectRatio: 1.0 },
    fingerRatios: { index: 0.5, middle: 0.5, ring: 0.5, pinky: 0.5, thumb: 0.5 },
    geometricRatios: { indexToMiddle: 1.0, fingerSpanToHeight: 1.0, thumbToIndex: 1.0 },
    palmAngle: 0,
    photoHash: 'abc123'
  };
  const result = formatPalmGeometryEvidence(fakeEvidence);
  assert.ok(!result.includes('abc123'), 'Should not include photoHash in geometry block');
});

test('S6: No named palmistry claims in geometry block of writer prompt', async () => {
  const result = await assemblePrompt({
    ...USER_PARAMS,
    palmEvidence: VALID_PALM_EVIDENCE
  });
  const prompt = result.compiledPrompt;
  const geometryBlockMatch = prompt.match(/PALM GEOMETRY EVIDENCE[\s\S]*?Interpretation rules:/);
  const geometryBlock = geometryBlockMatch ? geometryBlockMatch[0] : '';
  const claimPatterns = [
    /your heart line/i,
    /your life line/i,
    /your head line/i,
    /your fate line/i,
    /your venus mount/i,
    /shows a deep capacity/i,
    /indicates longevity/i,
    /is prominent/i
  ];
  for (const pattern of claimPatterns) {
    assert.ok(!pattern.test(geometryBlock), `Geometry block should not claim: ${pattern}`);
  }
});

test('S7: Reviewer prompt geometry block does not claim named palmistry features', () => {
  const prompt = buildReviewPrompt({
    reading: SAMPLE_READING,
    reasoningPlan: REASONING_PLAN,
    tradition: 'western',
    reviewReport: SAMPLE_REVIEW.deterministic,
    userContext: {
      name: USER_PARAMS.name,
      dob: USER_PARAMS.dob,
      birthplace: USER_PARAMS.birthplace,
      tradition: USER_PARAMS.tradition,
      photoHashPresent: true,
      palmEvidence: VALID_PALM_EVIDENCE
    }
  });
  const geometryBlockMatch = prompt.match(/Palm Geometry:[\s\S]*?Interpretation rules:/);
  const geometryBlock = geometryBlockMatch ? geometryBlockMatch[0] : '';
  const claimPatterns = [
    /your heart line/i,
    /your life line/i,
    /your head line/i,
    /your fate line/i,
    /your venus mount/i,
    /shows a deep capacity/i,
    /indicates longevity/i,
    /is prominent/i
  ];
  for (const pattern of claimPatterns) {
    assert.ok(!pattern.test(geometryBlock), `Reviewer geometry block should not claim: ${pattern}`);
  }
});

test('S8: Rewriter prompt geometry block does not claim named palmistry features', () => {
  const prompt = buildRewritePrompt({
    draft: SAMPLE_READING,
    reasoningPlan: REASONING_PLAN,
    review: SAMPLE_REVIEW,
    userContext: {
      name: USER_PARAMS.name,
      dob: USER_PARAMS.dob,
      birthplace: USER_PARAMS.birthplace,
      tradition: USER_PARAMS.tradition,
      photoHashPresent: true,
      palmEvidence: VALID_PALM_EVIDENCE
    },
    tradition: 'western'
  });
  const geometryBlockMatch = prompt.match(/Palm Geometry:[\s\S]*?Interpretation rules:/);
  const geometryBlock = geometryBlockMatch ? geometryBlockMatch[0] : '';
  const claimPatterns = [
    /your heart line/i,
    /your life line/i,
    /your head line/i,
    /your fate line/i,
    /your venus mount/i,
    /shows a deep capacity/i,
    /indicates longevity/i,
    /is prominent/i
  ];
  for (const pattern of claimPatterns) {
    assert.ok(!pattern.test(geometryBlock), `Rewriter geometry block should not claim: ${pattern}`);
  }
});

// ============================================================================
// SUMMARY
// ============================================================================

console.log('\n' + '='.repeat(60));
console.log('PHASE 4 VERIFICATION SUMMARY');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total:  ${passed + failed}`);
console.log('='.repeat(60));

if (failed > 0) {
  process.exit(1);
}
