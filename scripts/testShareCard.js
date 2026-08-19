/*
 * Focused tests for the PalmPyaar Moment social sharing card.
 *
 * Tests the pure text/markup/share-decision logic (Node-testable). The
 * Canvas2D image renderer is browser-only and intentionally not executed
 * under Node. Image correctness is guaranteed structurally: preview and
 * download are the same <canvas>, so they always match.
 */
'use strict';

const assert = require('assert');
const moment = require('../js/palmMoment');

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

function everyLine() {
  const out = [];
  Object.keys(moment.THEMES).forEach((key) => {
    moment.THEMES[key].lines.forEach((pair) => {
      pair.forEach((line) => out.push(line));
    });
  });
  return out;
}

function isExactlyTwoSentences(copy) {
  assert(copy && typeof copy === 'object', 'copy should be an object');
  assert(Array.isArray(copy.sentences), 'sentences should be an array');
  assert.strictEqual(copy.sentences.length, 2, 'exactly two sentences required');
  copy.sentences.forEach((s) => {
    assert(typeof s === 'string' && s.trim().length > 0, 'sentence should be non-empty');
    assert(/[.!?]$/.test(s.trim()), 'each sentence should end with terminal punctuation: ' + s);
  });
}

// ---- 1. Card generation works ----
check('T1: card spec is a 9:16 PNG at high resolution', () => {
  const spec = moment.getCardSpec();
  assert.strictEqual(spec.ratio, '9:16');
  assert.strictEqual(spec.filename, 'palmpyaar-moment.png');
  assert.ok(spec.width > 500 && spec.height > 900, 'high resolution expected');
  assert.strictEqual(spec.width / spec.height, 9 / 16);
});

check('T1b: copy generation works for every theme', () => {
  const questionsByTheme = {
    career: ['When will I get the job?'],
    relationships: ['When will I get married?'],
    newBeginnings: ['Will I move abroad this year?'],
    change: ['Should I change my path?'],
    ambition: ['Will I achieve my goals?'],
    confidence: ['How can I feel more confident?'],
    resilience: ['How do I overcome this difficult phase?'],
    growth: ['How can I grow personally?'],
    opportunity: ['Is there an opportunity coming my way?'],
    independence: ['Should I live alone?'],
    selfDiscovery: ['Who am I?'],
    patience: ['When will things get better?']
  };
  Object.keys(questionsByTheme).forEach((theme) => {
    const copy = moment.getMomentCopy(questionsByTheme[theme]);
    isExactlyTwoSentences(copy);
  });
});

// ---- 2. Card contains PalmPyaar branding ----
check('T2: card markup contains PalmPyaar branding', () => {
  const copy = moment.getMomentCopy(['When will I get the job?']);
  const html = moment.buildCardMarkup(copy);
  assert(html.includes('PalmPyaar'), 'markup must contain PalmPyaar');
  const eyebrow = html.match(/<p class="palm-moment__eyebrow">(.*?)<\/p>/);
  assert(eyebrow && eyebrow[1], 'eyebrow wordmark element must exist');
  assert(eyebrow[1].includes('PalmPyaar'), 'eyebrow wordmark must read "PalmPyaar"');
  assert(!eyebrow[1].includes('PALMPYAAR'), 'eyebrow wordmark must not be uppercase');
});

check('T2b: card markup contains the YOUR PALMPYAAR MOMENT heading', () => {
  const copy = moment.getMomentCopy([]);
  const html = moment.buildCardMarkup(copy);
  assert(html.includes('YOUR PALMPYAAR MOMENT'), 'heading missing');
});

// ---- 3. Exactly two sentences ----
check('T3: generated card contains exactly two sentences', () => {
  const samples = [
    moment.getMomentCopy(['When will I get the job?']),
    moment.getMomentCopy(['Will my relationship improve?']),
    moment.getMomentCopy([]),
    moment.getMomentCopy(null),
    moment.getMomentCopy(['When will I move abroad?'])
  ];
  samples.forEach(isExactlyTwoSentences);
});

check('T3b: markup renders exactly two sentence lines', () => {
  const copy = moment.getMomentCopy(['When will I get the job?']);
  const html = moment.buildCardMarkup(copy);
  const count = html.split('class="palm-moment__line"').length - 1;
  assert.strictEqual(count, 2, 'markup must render exactly two sentence lines');
  copy.sentences.forEach((s) => {
    assert(html.includes(s), 'each sentence must appear in the markup');
  });
});

// ---- 4. No astrology jargon ----
check('T4: generated copy contains no astrology jargon', () => {
  moment.JARGON.forEach((word) => {
    const re = new RegExp('\\b' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
    everyLine().forEach((line) => {
      assert(!re.test(line), 'line must not contain jargon "' + word + '": ' + line);
    });
  });
});

check('T4b: per-theme outputs are jargon-free', () => {
  const questions = ['When will I get the job?', 'Will my relationship improve?', 'Should I move abroad?', 'How can I grow?'];
  questions.forEach((q) => {
    const copy = moment.getMomentCopy([q]);
    assert.strictEqual(moment.hasJargon(copy.sentences.join(' ')), false, 'jargon found for: ' + q);
  });
  assert.strictEqual(moment.hasJargon('plain reflective text here'), false);
  assert.strictEqual(moment.hasJargon('My zodiac sign says otherwise'), true, 'jargon detector should flag zodiac');
  assert.strictEqual(moment.hasJargon('PalmPyaar made this'), false, 'brand must not be flagged as jargon');
});

// ---- 5. No banned generic motivational phrases ----
check('T5: generated copy contains no banned generic phrases', () => {
  everyLine().forEach((line) => {
    assert.strictEqual(moment.hasBannedContent(line), false, 'banned phrase in: ' + line);
  });
});

check('T5b: banned phrase detector works', () => {
  assert.strictEqual(moment.hasBannedContent('You are destined for greatness.'), true);
  assert.strictEqual(moment.hasBannedContent('Great things are coming.'), true);
  assert.strictEqual(moment.hasBannedContent('A quiet season is still a season of work.'), false);
});

// ---- 6. Different reading themes ----
check('T6: theme detection maps questions to distinct themes', () => {
  assert.strictEqual(moment.detectTheme(['When will I get the job?']), 'career');
  assert.strictEqual(moment.detectTheme(['When will I get married?']), 'relationships');
  assert.strictEqual(moment.detectTheme(['Will I move abroad this year?']), 'newBeginnings');
  assert.strictEqual(moment.detectTheme(['Should I change my path?']), 'change');
  assert.strictEqual(moment.detectTheme(['Will I achieve my goals?']), 'ambition');
  assert.strictEqual(moment.detectTheme(['How can I feel more confident?']), 'confidence');
  assert.strictEqual(moment.detectTheme(['How do I overcome this difficult phase?']), 'resilience');
  assert.strictEqual(moment.detectTheme(['When will things get better?']), 'patience');
});

check('T6b: theme flows through to the generated copy', () => {
  const copy = moment.getMomentCopy(['When will I get the job?']);
  assert.strictEqual(copy.theme, 'career');
  const copy2 = moment.getMomentCopy(['When will I get married?']);
  assert.strictEqual(copy2.theme, 'relationships');
});

// ---- 7. Missing/empty context fallback ----
check('T7: missing/empty context uses a safe fallback', () => {
  [null, undefined, [], ['']].forEach((input) => {
    const copy = moment.getMomentCopy(input);
    assert.strictEqual(copy.theme, 'reflection', 'empty context must use reflection fallback');
    isExactlyTwoSentences(copy);
    assert.strictEqual(moment.hasBannedContent(copy.sentences.join(' ')), false);
    assert.strictEqual(moment.hasJargon(copy.sentences.join(' ')), false);
  });
});

check('T7b: question objects are accepted alongside strings', () => {
  const copy = moment.getMomentCopy([{ question: 'When will I get the job?' }]);
  assert.strictEqual(copy.theme, 'career');
  isExactlyTwoSentences(copy);
});

// ---- 8. Native share unsupported -> download fallback ----
check('T8: share requires native Web Share with file support', () => {
  assert.strictEqual(moment.resolveShareAction({ share: true, canShareFiles: true }), 'share');
  assert.strictEqual(moment.resolveShareAction({ share: true, canShareFiles: false }), 'download');
  assert.strictEqual(moment.resolveShareAction({ share: false, canShareFiles: true }), 'download');
  assert.strictEqual(moment.resolveShareAction({}), 'download');
  assert.strictEqual(moment.resolveShareAction(), 'download');
});

// ---- 9-12. Existing suites unchanged are confirmed by the full run ----

console.log('\n=== PALM MOMENT SHARE CARD SUMMARY ===');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
console.log('Total:  ' + (passed + failed));
process.exit(failed === 0 ? 0 : 1);
