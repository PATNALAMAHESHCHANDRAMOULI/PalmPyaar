/**
 * Test script for reviewEngine.js scoreRecognition name safety.
 * Validates that:
 *  - Normal names are counted correctly and never crash.
 *  - Names containing regex metacharacters are escaped safely (no crash, correct count).
 *  - Empty/missing names are guarded.
 */

const { reviewReading } = require('../providers/reviewEngine');

// ============================================================================
// TEST HELPERS
// ============================================================================

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

function assertTrue(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function assertInRange(value, min, max, message) {
    if (typeof value !== 'number' || value < min || value > max) {
        throw new Error(`${message}: expected number in [${min}, ${max}], got "${value}"`);
    }
}

// ============================================================================
// FIXTURES
// ============================================================================

const baseReasoningPlan = {
    centralTheme: 'temperament and purpose',
    supportingThemes: ['identity', 'balance', 'courage'],
    emotionalDestination: 'quiet confidence',
    symbolicThread: 'a locked room with many keys',
    coreFocus: 'innate nature',
    loveFocus: 'relational patterns',
    proFocus: 'calling',
    openingMood: 'curiosity',
    closingMood: 'calm',
    callbackStrategy: {
        coreToLove: 'the self you meet in CORE',
        loveToPro: 'the heart you know in LOVE',
        proToCore: 'the path that returns you to yourself'
    },
    narrativeFlow: 'spiral deepening',
    literaryStyle: 'poetic directness',
    traditionLens: 'temperament and planetary condition'
};

function makeContext(name) {
    return {
        name,
        dob: '1990-06-15',
        birthplace: 'Pune',
        tradition: 'western',
        photoHashPresent: false
    };
}

function reviewWithCore(core, name) {
    return reviewReading({
        reading: { core, love: 'love text', pro: 'pro text' },
        reasoningPlan: baseReasoningPlan,
        tradition: 'western',
        userContext: makeContext(name)
    });
}

const NORMAL_NAME = 'Aarav';
const NORMAL_CORE_TWICE = `${NORMAL_NAME}, you are here. ${NORMAL_NAME}, you are whole.`;
const NORMAL_CORE_ABSENT = 'You are here. You are whole.';

const META_NAME = 'K[,{5}';
const META_CORE_TWICE = `${META_NAME}, you are here. ${META_NAME}, you are whole.`;
const META_CORE_ABSENT = 'You are here. You are whole.';

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

// --- Normal names ---

test('Normal name: review completes without error', () => {
    const result = reviewWithCore(NORMAL_CORE_TWICE, NORMAL_NAME);
    assertInRange(result.scores.recognition, 1, 10, 'Recognition score out of range');
});

test('Normal name: counted when present twice', () => {
    const present = reviewWithCore(NORMAL_CORE_TWICE, NORMAL_NAME).scores.recognition;
    const absent = reviewWithCore(NORMAL_CORE_ABSENT, NORMAL_NAME).scores.recognition;
    assertTrue(present > absent, 'Name present twice should score higher than absent');
});

// --- Regex metacharacter names ---

test('Regex metacharacter name: review completes without error', () => {
    const result = reviewWithCore(META_CORE_TWICE, META_NAME);
    assertInRange(result.scores.recognition, 1, 10, 'Recognition score out of range');
});

test('Regex metacharacter name: counted as literal string', () => {
    const present = reviewWithCore(META_CORE_TWICE, META_NAME).scores.recognition;
    const absent = reviewWithCore(META_CORE_ABSENT, META_NAME).scores.recognition;
    assertTrue(present > absent, 'Metacharacter name present twice should score higher than absent');
});

// --- Edge cases ---

test('Empty name: guarded, no crash', () => {
    const result = reviewWithCore(NORMAL_CORE_ABSENT, '');
    assertInRange(result.scores.recognition, 1, 10, 'Recognition score out of range');
});

test('Non-string name: guarded, no crash', () => {
    const result = reviewWithCore(NORMAL_CORE_ABSENT, null);
    assertInRange(result.scores.recognition, 1, 10, 'Recognition score out of range');
});

// --- Summary ---

console.log('\n=== TEST SUMMARY ===');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total: ${passed + failed}`);

if (failed > 0) {
    process.exit(1);
}
