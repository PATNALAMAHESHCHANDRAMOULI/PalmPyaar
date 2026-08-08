/**
 * Test script for openingLibrary.js
 * Validates the two-mode architecture and forbidden pattern detection
 */

const { getOpening, hasVerifiedPalmEvidence } = require('../providers/openingLibrary');

// ============================================================================
// FORBIDDEN PATTERNS - These should NEVER appear in MODE A output
// ============================================================================
const FORBIDDEN_PATTERNS = [
    /your life line/i,
    /your heart line/i,
    /your head line/i,
    /your health line/i,
    /your Venus mount/i,
    /your Mercury mount/i,
    /your Saturn mount/i,
    /your Jupiter mount/i,
    /your Apollo mount/i,
    /your Moon mount/i,
    /the scar on your/i,
    /the scar on the/i,
    /at seven/i,
    /at fourteen/i,
    /at twenty/i,
    /at thirty/i,
    /at forty/i,
    /at fifty/i,
    /at sixty/i,
    /when you were \d+/i,
    /when you were seven/i,
    /when you were fourteen/i,
    /fell from the/i,
    /crosses the life line at/i,
    /crosses the head line at/i,
    /crosses the heart line at/i,
    /island on the.*line at/i,
    /marriage line at/i,
    /career line.*at/i,
    /fate line.*at \d+/i,
    /health line.*at \d+/i,
    /Saturn return.*divorce/i,
    /Saturn return.*mastery/i,
    /child's hand has no fate line/i,
    /adult's hand earns one/i,
    /the hand is the more reliable narrator/i,
    /mount of Venus/i,
    /mount of Mercury/i,
    /mount of Saturn/i,
    /mount of Jupiter/i,
    /mount of Apollo/i,
    /mount of Moon/i,
    /life line curves/i,
    /heart line terminates/i,
    /head line forks/i,
    /fate line rises/i,
    /marriage lines/i,
    /mount of Jupiter rises/i,
    /star formation on the mount/i,
    /girdle of Venus/i,
    /mercury finger bends/i,
    /ring of Solomon/i,
    /grille pattern on the mount/i,
    /Saturn line begins/i,
    /Venus mount is/i,
    /triangle forms on the mount/i,
    /head line sweeps/i,
    /island on the heart line/i,
    /Apollo line rises/i,
    /Mars positive is/i,
    /cross on the mount of Saturn/i,
    /health line curves/i,
    /thumb sits low/i,
    /square on the fate line/i,
    /intuition line runs/i,
    /fork at the end of your head line/i,
    /heart line ends under/i,
    /wide gap between head line and life line/i,
    /chained heart line/i,
    /thumb held tight/i,
    /Mercury finger is short/i,
    /mount of Moon is vast/i,
    /double head line/i,
    /life line swings wide/i,
    /fingers are stiff/i,
    /grief in the Saturn line/i,
    /heart line's trident/i,
    /Venus-Saturn square/i,
    /Mars-Pluto conjunction/i,
    /Chiron in the fifth/i,
    /grief that lives in the shoulders/i,
    /Jupiter-Neptune trine/i,
    /fell from the oak tree/i,
    /marriage line at twenty/i,
    /father's Saturn return/i,
    /fate line appears at eighteen/i,
    /career lines/i,
    /health line crosses the life line at forty/i,
    /Saturn return: divorce/i,
    /Apollo line emerges at fifty/i,
    /child's hand has no fate line/i
];

// ============================================================================
// TEST HELPERS
// ============================================================================

function checkForbiddenPatterns(text, mode) {
    const violations = [];
    for (const pattern of FORBIDDEN_PATTERNS) {
        if (pattern.test(text)) {
            violations.push({ pattern: pattern.source, match: text.match(pattern)[0] });
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

function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(`${message}: expected "${expected}", got "${actual}"`);
    }
}

function assertTrue(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function assertFalse(condition, message) {
    if (condition) {
        throw new Error(message);
    }
}

function assertContains(text, substring, message) {
    if (!text.includes(substring)) {
        throw new Error(`${message}: expected to contain "${substring}"`);
    }
}

function assertNotContains(text, substring, message) {
    if (text.includes(substring)) {
        throw new Error(`${message}: expected NOT to contain "${substring}"`);
    }
}

// ============================================================================
// TEST CASES
// ============================================================================

let passed = 0;
let failed = 0;

function test(name, fn) {
    const result = runTest(name, fn);
    if (result) passed++;
    else failed++;
}

// --- hasVerifiedPalmEvidence tests ---

test('hasVerifiedPalmEvidence: null returns false', () => {
    assertFalse(hasVerifiedPalmEvidence(null), 'null should return false');
});

test('hasVerifiedPalmEvidence: undefined returns false', () => {
    assertFalse(hasVerifiedPalmEvidence(undefined), 'undefined should return false');
});

test('hasVerifiedPalmEvidence: empty object returns false', () => {
    assertFalse(hasVerifiedPalmEvidence({}), 'empty object should return false');
});

test('hasVerifiedPalmEvidence: photoHash only returns false', () => {
    assertFalse(hasVerifiedPalmEvidence({ photoHash: 'abc123' }), 'photoHash alone is not palm evidence');
});

test('hasVerifiedPalmEvidence: photoHashPresent boolean returns false', () => {
    assertFalse(hasVerifiedPalmEvidence({ photoHashPresent: true }), 'photoHashPresent boolean is not palm evidence');
});

test('hasVerifiedPalmEvidence: lines array with content returns true', () => {
    assertTrue(hasVerifiedPalmEvidence({ lines: ['life line curves to Venus'] }), 'lines array with content should return true');
});

test('hasVerifiedPalmEvidence: mounts array with content returns true', () => {
    assertTrue(hasVerifiedPalmEvidence({ mounts: ['Jupiter high'] }), 'mounts array with content should return true');
});

test('hasVerifiedPalmEvidence: markings array with content returns true', () => {
    assertTrue(hasVerifiedPalmEvidence({ markings: ['star on Apollo'] }), 'markings array with content should return true');
});

test('hasVerifiedPalmEvidence: fingers array with content returns true', () => {
    assertTrue(hasVerifiedPalmEvidence({ fingers: ['Mercury bent'] }), 'fingers array with content should return true');
});

test('hasVerifiedPalmEvidence: empty arrays returns false', () => {
    assertFalse(hasVerifiedPalmEvidence({ lines: [], mounts: [], markings: [], fingers: [] }), 'empty arrays should return false');
});

// --- MODE A: No palm evidence tests ---

const baseParams = {
    tradition: 'western',
    centralTheme: 'identity and growth',
    symbolicThread: 'a mirror that shows the back of your head',
    openingMood: 'curious recognition'
};

test('MODE A: Western tradition produces output', () => {
    const opening = getOpening({ ...baseParams, tradition: 'western' });
    assertTrue(typeof opening === 'string' && opening.length > 0, 'Should produce non-empty string');
});

test('MODE A: Vedic tradition produces output', () => {
    const opening = getOpening({ ...baseParams, tradition: 'vedic' });
    assertTrue(typeof opening === 'string' && opening.length > 0, 'Should produce non-empty string');
});

test('MODE A: Hellenic tradition produces output', () => {
    const opening = getOpening({ ...baseParams, tradition: 'hellenic' });
    assertTrue(typeof opening === 'string' && opening.length > 0, 'Should produce non-empty string');
});

test('MODE A: No forbidden palm patterns in Western', () => {
    const opening = getOpening({ ...baseParams, tradition: 'western' });
    const violations = checkForbiddenPatterns(opening, 'MODE_A');
    assertEqual(violations.length, 0, `Forbidden patterns found: ${JSON.stringify(violations)}`);
});

test('MODE A: No forbidden palm patterns in Vedic', () => {
    const opening = getOpening({ ...baseParams, tradition: 'vedic' });
    const violations = checkForbiddenPatterns(opening, 'MODE_A');
    assertEqual(violations.length, 0, `Forbidden patterns found: ${JSON.stringify(violations)}`);
});

test('MODE A: No forbidden palm patterns in Hellenic', () => {
    const opening = getOpening({ ...baseParams, tradition: 'hellenic' });
    const violations = checkForbiddenPatterns(opening, 'MODE_A');
    assertEqual(violations.length, 0, `Forbidden patterns found: ${JSON.stringify(violations)}`);
});

test('MODE A: photoHash alone does not trigger palm templates', () => {
    const opening = getOpening({ ...baseParams, tradition: 'western', palmEvidence: { photoHash: 'abc123' } });
    const violations = checkForbiddenPatterns(opening, 'MODE_A');
    assertEqual(violations.length, 0, `Forbidden patterns found with photoHash: ${JSON.stringify(violations)}`);
});

test('MODE A: photoHashPresent boolean does not trigger palm templates', () => {
    const opening = getOpening({ ...baseParams, tradition: 'western', palmEvidence: { photoHashPresent: true } });
    const violations = checkForbiddenPatterns(opening, 'MODE_A');
    assertEqual(violations.length, 0, `Forbidden patterns found with photoHashPresent: ${JSON.stringify(violations)}`);
});

test('MODE A: Deterministic - same input yields same output', () => {
    const opening1 = getOpening(baseParams);
    const opening2 = getOpening(baseParams);
    assertEqual(opening1, opening2, 'Same input should produce same output');
});

test('MODE A: Different tradition yields different opening', () => {
    const western = getOpening({ ...baseParams, tradition: 'western' });
    const vedic = getOpening({ ...baseParams, tradition: 'vedic' });
    const hellenic = getOpening({ ...baseParams, tradition: 'hellenic' });
    assertTrue(western !== vedic, 'Western and Vedic should differ');
    assertTrue(vedic !== hellenic, 'Vedic and Hellenic should differ');
    assertTrue(western !== hellenic, 'Western and Hellenic should differ');
});

test('MODE A: Different mood yields different opening', () => {
    const mood1 = getOpening({ ...baseParams, openingMood: 'poetic' });
    const mood2 = getOpening({ ...baseParams, openingMood: 'grounded' });
    assertTrue(mood1 !== mood2, 'Different moods should produce different openings');
});

test('MODE A: Different theme yields different opening', () => {
    const theme1 = getOpening({ ...baseParams, centralTheme: 'love and relationships' });
    const theme2 = getOpening({ ...baseParams, centralTheme: 'career and purpose' });
    assertTrue(theme1 !== theme2, 'Different themes should produce different openings');
});

test('MODE A: Western opening contains no palm-specific language', () => {
    const opening = getOpening({ ...baseParams, tradition: 'western' });
    // Should not contain any palm-specific terms
    assertNotContains(opening.toLowerCase(), 'life line', 'Western MODE A should not mention life line');
    assertNotContains(opening.toLowerCase(), 'heart line', 'Western MODE A should not mention heart line');
    assertNotContains(opening.toLowerCase(), 'head line', 'Western MODE A should not mention head line');
    assertNotContains(opening.toLowerCase(), 'mount of', 'Western MODE A should not mention mounts');
    assertNotContains(opening.toLowerCase(), 'fate line', 'Western MODE A should not mention fate line');
    assertNotContains(opening.toLowerCase(), 'marriage line', 'Western MODE A should not mention marriage line');
    assertNotContains(opening.toLowerCase(), 'scar', 'Western MODE A should not mention scars');
    assertNotContains(opening.toLowerCase(), 'at seven', 'Western MODE A should not mention specific ages');
    assertNotContains(opening.toLowerCase(), 'at fourteen', 'Western MODE A should not mention specific ages');
});

test('MODE A: Vedic opening contains no palm-specific language', () => {
    const opening = getOpening({ ...baseParams, tradition: 'vedic' });
    assertNotContains(opening.toLowerCase(), 'life line', 'Vedic MODE A should not mention life line');
    assertNotContains(opening.toLowerCase(), 'heart line', 'Vedic MODE A should not mention heart line');
    assertNotContains(opening.toLowerCase(), 'mount of', 'Vedic MODE A should not mention mounts');
    assertNotContains(opening.toLowerCase(), 'scar', 'Vedic MODE A should not mention scars');
    // Should contain Vedic terminology
    assertTrue(
        opening.includes('Shani') || opening.includes('Chandra') || opening.includes('Rahu') || 
        opening.includes('Guru') || opening.includes('Mangal') || opening.includes('Shukra') ||
        opening.includes('Budha') || opening.includes('Surya') || opening.includes('Vimshottari') ||
        opening.includes('nakshatra') || opening.includes('dasha') || opening.includes('karma') ||
        opening.includes('lagna') || opening.includes('sadhana') || opening.includes('tapasya'),
        'Vedic MODE A should contain Vedic terminology'
    );
});

test('MODE A: Hellenic opening contains no palm-specific language', () => {
    const opening = getOpening({ ...baseParams, tradition: 'hellenic' });
    assertNotContains(opening.toLowerCase(), 'life line', 'Hellenic MODE A should not mention life line');
    assertNotContains(opening.toLowerCase(), 'heart line', 'Hellenic MODE A should not mention heart line');
    assertNotContains(opening.toLowerCase(), 'mount of', 'Hellenic MODE A should not mention mounts');
    assertNotContains(opening.toLowerCase(), 'scar', 'Hellenic MODE A should not mention scars');
    // Should contain Hellenic terminology
    assertTrue(
        opening.includes('Lot of') || opening.includes('sect') || opening.includes('profected') ||
        opening.includes('time-lord') || opening.includes('zodiacal releasing') || opening.includes('decani') ||
        opening.includes('primary direction') || opening.includes('bound ruler') || opening.includes('twelfth-part'),
        'Hellenic MODE A should contain Hellenic terminology'
    );
});

test('MODE A: Western opening feels premium and specific', () => {
    const opening = getOpening({ ...baseParams, tradition: 'western' });
    // Should be substantial, not generic
    assertTrue(opening.length > 50, 'Opening should be substantial');
    // Should not be generic disclaimer language
    assertNotContains(opening.toLowerCase(), 'i cannot see', 'Should not say "I cannot see"');
    assertNotContains(opening.toLowerCase(), 'i don\'t have', 'Should not say "I don\'t have"');
    assertNotContains(opening.toLowerCase(), 'based on the information', 'Should not say "Based on the information"');
    assertNotContains(opening.toLowerCase(), 'without enough', 'Should not say "without enough"');
});

test('MODE A: Vedic opening feels premium and specific', () => {
    const opening = getOpening({ ...baseParams, tradition: 'vedic' });
    assertTrue(opening.length > 50, 'Opening should be substantial');
    assertNotContains(opening.toLowerCase(), 'i cannot see', 'Should not say "I cannot see"');
    assertNotContains(opening.toLowerCase(), 'i don\'t have', 'Should not say "I don\'t have"');
    assertNotContains(opening.toLowerCase(), 'based on the information', 'Should not say "Based on the information"');
    assertNotContains(opening.toLowerCase(), 'without enough', 'Should not say "without enough"');
});

test('MODE A: Hellenic opening feels premium and specific', () => {
    const opening = getOpening({ ...baseParams, tradition: 'hellenic' });
    assertTrue(opening.length > 50, 'Opening should be substantial');
    assertNotContains(opening.toLowerCase(), 'i cannot see', 'Should not say "I cannot see"');
    assertNotContains(opening.toLowerCase(), 'i don\'t have', 'Should not say "I don\'t have"');
    assertNotContains(opening.toLowerCase(), 'based on the information', 'Should not say "Based on the information"');
    assertNotContains(opening.toLowerCase(), 'without enough', 'Should not say "without enough"');
});

// --- MODE B: With verified palm evidence tests ---

const palmEvidence = {
    lines: ['life line curves to Venus mount', 'heart line ends in trident'],
    mounts: ['Jupiter high', 'Venus flat'],
    markings: ['star on Apollo', 'cross on Saturn'],
    fingers: ['Mercury bent inward']
};

test('MODE B: With palm evidence produces output', () => {
    const opening = getOpening({ ...baseParams, tradition: 'western', palmEvidence });
    assertTrue(typeof opening === 'string' && opening.length > 0, 'Should produce non-empty string');
});

test('MODE B: Palm evidence allows palm-specific language', () => {
    const opening = getOpening({ ...baseParams, tradition: 'western', palmEvidence });
    // Should be able to reference palm features now
    const hasPalmLanguage = /life line|heart line|head line|fate line|health line|marriage line|apollo line|saturn line|mount of|venus mount|jupiter mount|saturn mount|mercury mount|apollo mount|moon mount|mars mount|finger|thumb|star|cross|island|grille|triangle|square|simian|transverse|chained|fork|trident|scar|marking/i.test(opening);
    assertTrue(hasPalmLanguage, 'MODE B should allow palm-specific language');
});

test('MODE B: Different tradition with palm evidence works', () => {
    const western = getOpening({ ...baseParams, tradition: 'western', palmEvidence });
    const vedic = getOpening({ ...baseParams, tradition: 'vedic', palmEvidence });
    const hellenic = getOpening({ ...baseParams, tradition: 'hellenic', palmEvidence });
    assertTrue(western !== vedic, 'Western and Vedic should differ with palm evidence');
    assertTrue(vedic !== hellenic, 'Vedic and Hellenic should differ with palm evidence');
});

test('MODE B: Deterministic with palm evidence', () => {
    const opening1 = getOpening({ ...baseParams, tradition: 'western', palmEvidence });
    const opening2 = getOpening({ ...baseParams, tradition: 'western', palmEvidence });
    assertEqual(opening1, opening2, 'Same input with palm evidence should produce same output');
});

test('MODE B: Empty arrays in palmEvidence falls back to MODE A', () => {
    const emptyEvidence = { lines: [], mounts: [], markings: [], fingers: [] };
    const opening = getOpening({ ...baseParams, tradition: 'western', palmEvidence: emptyEvidence });
    const violations = checkForbiddenPatterns(opening, 'MODE_A');
    assertEqual(violations.length, 0, 'Empty palm evidence arrays should not trigger MODE B');
});

test('MODE B: Only uses supplied observations, never invents', () => {
    // Supply only specific evidence
    const limitedEvidence = {
        lines: ['heart line ends in trident'],
        mounts: [],
        markings: [],
        fingers: []
    };
    const opening = getOpening({ ...baseParams, tradition: 'western', palmEvidence: limitedEvidence });
    // Should reference the supplied evidence (heart line trident)
    // Should NOT reference unsupplied evidence (life line, mounts, etc.)
    assertNotContains(opening.toLowerCase(), 'life line', 'Should not invent life line observation');
    assertNotContains(opening.toLowerCase(), 'mount of jupiter', 'Should not invent Jupiter mount observation');
    assertNotContains(opening.toLowerCase(), 'mount of venus', 'Should not invent Venus mount observation');
    assertNotContains(opening.toLowerCase(), 'star on apollo', 'Should not invent Apollo star observation');
    assertNotContains(opening.toLowerCase(), 'cross on saturn', 'Should not invent Saturn cross observation');
});

// --- Edge cases ---

test('Missing parameters handled gracefully', () => {
    const opening = getOpening({});
    assertTrue(typeof opening === 'string' && opening.length > 0, 'Should handle missing params');
});

test('Only tradition provided works', () => {
    const opening = getOpening({ tradition: 'western' });
    assertTrue(typeof opening === 'string' && opening.length > 0, 'Should work with only tradition');
});

test('MODE A: symbolicThread influences selection', () => {
    const opening1 = getOpening({ ...baseParams, symbolicThread: 'water' });
    const opening2 = getOpening({ ...baseParams, symbolicThread: 'fire' });
    // Different symbolic threads should potentially yield different openings
    // (may be same due to hash collision, but should at least not error)
    assertTrue(typeof opening1 === 'string' && typeof opening2 === 'string', 'Both should produce valid output');
});

test('MODE A: centralTheme influences selection', () => {
    const opening1 = getOpening({ ...baseParams, centralTheme: 'love and relationships' });
    const opening2 = getOpening({ ...baseParams, centralTheme: 'career and purpose' });
    const opening3 = getOpening({ ...baseParams, centralTheme: 'health and healing' });
    const opening4 = getOpening({ ...baseParams, centralTheme: 'spiritual growth' });
    // All should produce valid, different outputs
    assertTrue(typeof opening1 === 'string' && opening1.length > 0);
    assertTrue(typeof opening2 === 'string' && opening2.length > 0);
    assertTrue(typeof opening3 === 'string' && opening3.length > 0);
    assertTrue(typeof opening4 === 'string' && opening4.length > 0);
});

// --- Summary ---

console.log('\n=== TEST SUMMARY ===');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total: ${passed + failed}`);

if (failed > 0) {
    process.exit(1);
}