/**
 * Test script for Palm Evidence Integrity - Phase 13B
 * Validates MODE B evidence integrity requirements
 */

const { getOpening, hasVerifiedPalmEvidence } = require('../providers/openingLibrary');

const FORBIDDEN_PHYSICAL_ATTRS = [
    'wide', 'pale', 'deep', 'prominent', 'broad', 'soft', 'full',
    'long', 'broken', 'unbroken', 'red', 'faint', 'forked', 'chained', 'doubled',
    'transverse crease', 'simian line', 'three prongs between fingers',
    'breaks', 'islands', 'stars', 'crosses', 'branches not supplied'
];

function checkForbiddenAttrs(text, forbiddenList) {
    const violations = [];
    const lowerText = text.toLowerCase();
    for (const attr of forbiddenList) {
        if (lowerText.includes(attr.toLowerCase())) {
            violations.push(attr);
        }
    }
    return violations;
}

function runTest(name, fn) {
    try {
        fn();
        console.log(`✅ ${name}`);
        return true;
    } catch (err) {
        console.log(`❌ ${name}: ${err.message}`);
        return false;
    }
}

function assertContains(text, substring, message) {
    if (!text.toLowerCase().includes(substring.toLowerCase())) {
        throw new Error(`${message}: expected to contain "${substring}"`);
    }
}

function assertNotContains(text, substring, message) {
    if (text.toLowerCase().includes(substring.toLowerCase())) {
        throw new Error(`${message}: expected NOT to contain "${substring}"`);
    }
}

function assertTrue(condition, message) {
    if (!condition) throw new Error(message);
}

function assertFalse(condition, message) {
    if (condition) throw new Error(message);
}

function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(`${message}: expected "${expected}", got "${actual}"`);
    }
}

let passed = 0;
let failed = 0;

function test(name, fn) {
    const result = runTest(name, fn);
    if (result) passed++; else failed++;
}

const baseParams = {
    tradition: 'western',
    centralTheme: 'identity and growth',
    symbolicThread: 'a mirror that shows the back of your head',
    openingMood: 'curious recognition'
};

// ============================================================================
// CHECKPOINT 3: MODE B MUST ACTUALLY ACTIVATE
// ============================================================================

test('CHECKPOINT 3: Valid palm evidence activates MODE B', () => {
    const palmEvidence = {
        lines: [
            'life line curves to Venus mount',
            'heart line ends in trident'
        ],
        mounts: [
            'Jupiter high',
            'Venus flat'
        ],
        markings: [
            'star on Apollo',
            'cross on Saturn'
        ],
        fingers: [
            'Mercury bent inward'
        ]
    };

    const opening = getOpening({ ...baseParams, palmEvidence });
    
    // Must contain at least one supplied palm observation or traceable portion
    const hasPalmRef = /venus|jupiter|apollo|saturn|mercury|life line|heart line|trident|star|cross|bent/.test(opening.toLowerCase());
    assertTrue(hasPalmRef, `MODE B opening should reference palm evidence. Got: "${opening}"`);
    
    // Must NOT be a generic MODE A opening
    assertNotContains(opening, 'The Scales do not balance', 'Should not fall back to generic MODE A opening');
    assertNotContains(opening, 'Character is not what the stars promise', 'Should not fall back to generic MODE A opening');
});

// ============================================================================
// CHECKPOINT 4: FABRICATION TESTS
// ============================================================================

test('CHECKPOINT 4A: Venus flat only - no wide/pale/deep/etc', () => {
    const palmEvidence = { mounts: ['Venus flat'] };
    const opening = getOpening({ ...baseParams, palmEvidence });
    
    const violations = checkForbiddenAttrs(opening, ['wide', 'pale', 'deep', 'prominent', 'broad', 'soft', 'full']);
    assertEqual(violations.length, 0, `Fabricated attributes found: ${violations.join(', ')}. Opening: "${opening}"`);
    
    // Should reference the supplied evidence
    assertContains(opening, 'Venus', 'Should reference Venus mount');
    assertContains(opening, 'flat', 'Should reference flat');
});

test('CHECKPOINT 4B: Life line curves - no long/deep/broken/etc', () => {
    const palmEvidence = { lines: ['life line curves toward Venus mount'] };
    const opening = getOpening({ ...baseParams, palmEvidence });
    
    const violations = checkForbiddenAttrs(opening, ['long', 'deep', 'broken', 'unbroken', 'red', 'faint', 'forked', 'chained', 'doubled']);
    assertEqual(violations.length, 0, `Fabricated attributes found: ${violations.join(', ')}. Opening: "${opening}"`);
    
    assertContains(opening, 'life line', 'Should reference life line');
    assertContains(opening, 'curve', 'Should reference curve');
});

test('CHECKPOINT 4C: Heart line trident - no transverse/Simian/three prongs/etc', () => {
    const palmEvidence = { lines: ['heart line ends in trident'] };
    const opening = getOpening({ ...baseParams, palmEvidence });
    
    const violations = checkForbiddenAttrs(opening, ['transverse crease', 'simian line', 'three prongs between fingers', 'breaks', 'islands', 'stars', 'crosses']);
    assertEqual(violations.length, 0, `Fabricated attributes found: ${violations.join(', ')}. Opening: "${opening}"`);
    
    assertContains(opening, 'heart line', 'Should reference heart line');
    assertContains(opening, 'trident', 'Should reference trident');
});

test('CHECKPOINT 4D: Complete evidence - no transverse/Simian/wide/pale', () => {
    const palmEvidence = {
        lines: [
            'life line curves to Venus mount',
            'heart line ends in trident'
        ],
        mounts: [
            'Jupiter high',
            'Venus flat'
        ],
        markings: [
            'star on Apollo',
            'cross on Saturn'
        ],
        fingers: [
            'Mercury bent inward'
        ]
    };
    
    const opening = getOpening({ ...baseParams, palmEvidence });
    
    const violations = checkForbiddenAttrs(opening, ['transverse crease', 'simian line', 'wide', 'pale']);
    assertEqual(violations.length, 0, `Fabricated attributes found: ${violations.join(', ')}. Opening: "${opening}"`);
    
    // Should reference at least some supplied evidence
    const hasRef = /venus|jupiter|apollo|saturn|mercury|life line|heart line|trident|star|cross|bent|flat|high/.test(opening.toLowerCase());
    assertTrue(hasRef, `Should reference supplied evidence. Got: "${opening}"`);
});

// ============================================================================
// CHECKPOINT 5: MODE A SAFETY
// ============================================================================

test('CHECKPOINT 5A: No palm evidence - MODE A safe', () => {
    const opening = getOpening(baseParams);
    
    // Should not contain palm-specific language
    const palmTerms = ['life line', 'heart line', 'head line', 'mount of', 'venus mount', 'jupiter mount', 'fate line', 'marriage line', 'scar', 'trident', 'simian'];
    for (const term of palmTerms) {
        assertNotContains(opening, term, `MODE A should not contain "${term}"`);
    }
});

test('CHECKPOINT 5B: photoHash only - MODE A safe', () => {
    const opening = getOpening({ ...baseParams, palmEvidence: { photoHash: 'abc123' } });
    
    const palmTerms = ['life line', 'heart line', 'mount of', 'venus mount', 'trident', 'simian'];
    for (const term of palmTerms) {
        assertNotContains(opening, term, `MODE A with photoHash should not contain "${term}"`);
    }
});

test('CHECKPOINT 5C: photoHashPresent boolean - MODE A safe', () => {
    const opening = getOpening({ ...baseParams, palmEvidence: { photoHashPresent: true } });
    
    const palmTerms = ['life line', 'heart line', 'mount of', 'venus mount', 'trident', 'simian'];
    for (const term of palmTerms) {
        assertNotContains(opening, term, `MODE A with photoHashPresent should not contain "${term}"`);
    }
});

// ============================================================================
// CHECKPOINT 6: EMPTY EVIDENCE
// ============================================================================

test('CHECKPOINT 6A: Empty arrays falls back to MODE A', () => {
    const palmEvidence = { lines: [], mounts: [], markings: [], fingers: [] };
    const opening = getOpening({ ...baseParams, palmEvidence });
    
    const palmTerms = ['life line', 'heart line', 'mount of', 'venus mount', 'trident', 'simian'];
    for (const term of palmTerms) {
        assertNotContains(opening, term, `Empty evidence should not contain "${term}"`);
    }
});

test('CHECKPOINT 6B: Empty object falls back to MODE A', () => {
    const palmEvidence = {};
    const opening = getOpening({ ...baseParams, palmEvidence });
    
    const palmTerms = ['life line', 'heart line', 'mount of', 'venus mount', 'trident', 'simian'];
    for (const term of palmTerms) {
        assertNotContains(opening, term, `Empty object should not contain "${term}"`);
    }
});

// ============================================================================
// CHECKPOINT 7: UNSUPPORTED EVIDENCE PROPERTY
// ============================================================================

test('CHECKPOINT 7: randomObservation not treated as evidence', () => {
    const palmEvidence = {
        lines: ['life line curves toward Venus mount'],
        randomObservation: ['deep red palm']
    };
    const opening = getOpening({ ...baseParams, palmEvidence });
    
    // Should not reference the unsupported property
    assertNotContains(opening, 'deep red palm', 'randomObservation should not be treated as evidence');
    assertNotContains(opening, 'red palm', 'randomObservation should not be treated as evidence');
    
    // Should still reference the valid evidence
    assertContains(opening, 'life line', 'Should reference valid evidence');
});

// ============================================================================
// CHECKPOINT 8: DETERMINISM
// ============================================================================

test('CHECKPOINT 8A: Same input produces identical output', () => {
    const palmEvidence = { mounts: ['Venus flat'] };
    const opening1 = getOpening({ ...baseParams, palmEvidence });
    const opening2 = getOpening({ ...baseParams, palmEvidence });
    assertEqual(opening1, opening2, 'Same input must produce identical output');
});

test('CHECKPOINT 8B: Different valid evidence produces different output', () => {
    const opening1 = getOpening({ ...baseParams, palmEvidence: { mounts: ['Venus flat'] } });
    const opening2 = getOpening({ ...baseParams, palmEvidence: { lines: ['heart line ends in trident'] } });
    assertTrue(opening1 !== opening2, 'Different evidence should produce different openings');
});

// ============================================================================
// SUMMARY
// ============================================================================

console.log('\n=== TEST SUMMARY ===');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total: ${passed + failed}`);

if (failed > 0) {
    process.exit(1);
}