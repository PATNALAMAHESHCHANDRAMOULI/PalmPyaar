/**
 * PalmPyaar Reasoning Planner — Narrative Architecture Stage
 * 
 * This module creates a structured narrative plan for a palmistry reading.
 * It NEVER writes the reading. It NEVER calls AI. It NEVER generates prose.
 * 
 * ARCHITECTURE POSITION:
 * 
 * User Input → reasoningPlanner.planReading() → Narrative Plan → Prompt Assembler → Compiled Prompt → LLM → Reading
 * 
 * WHY PLANNING EXISTS:
 * 
 * Without a plan, LLM generation is a random walk. The model improvises structure,
 * forgets callbacks, loses the symbolic thread, and produces generic horoscope text.
 * 
 * A narrative plan provides:
 * - Central coherence: one theme, three chapters, one emotional destination
 * - Callback architecture: seeds planted in CORE, transformed in LOVE, resolved in PRO
 * - Tradition fidelity: Western reads as psychological, Vedic as karmic, Hellenic as constitutional
 * - Quality guardrails: depth ladder enforced, emotional progression mapped, closing strategy chosen
 * - Deterministic reproducibility: same input → same plan → consistent quality
 * 
 * WHY WRITING HAPPENS LATER:
 * 
 * Planning and writing are different cognitive modes. Planning is architectural —
 * it decides WHAT happens and WHY. Writing is executional — it decides HOW it sounds.
 * 
 * Separating them allows:
 * - The planner to be pure logic (testable, auditable, tradition-aware)
 * - The writer (LLM) to focus entirely on prose craft within guardrails
 * - The prompt assembler to inject the plan as structured context
 * - Future validators to check output against plan (did callbacks land? did thread resolve?)
 * 
 * WHY CALLBACKS IMPROVE QUALITY:
 * 
 * Callbacks are the structural memory of a reading. Without them, three sections
 * are three independent essays. With them, they are one story in three movements.
 * 
 * CORE plants: contradiction, symbolic image, tension, question
 * LOVE transforms: contradiction deepens in relationship, image returns altered, tension becomes relational
 * PRO resolves: contradiction integrates, image completes, tension becomes direction
 * 
 * This creates the "recognition → reflection → integration" arc that makes readings
 * feel personally written rather than assembled.
 * 
 * WHY EMOTIONAL DESTINATION MATTERS:
 * 
 * Every reading must arrive somewhere. Not "and they lived happily ever after" —
 * but a specific emotional resonance: quiet understanding, hard-won clarity,
 * tender acceptance, focused determination, peaceful sovereignty.
 * 
 * The emotional destination determines:
 * - The closing strategy (resonant image, returned opening, quiet question, etc.)
 * - The PRO section's tone (hope calibrated to realism, calm without complacency)
 * - The callback resolutions (do they land softly or sharply?)
 * - The final sentence's weight (lingers or lifts?)
 * 
 * @module providers/reasoningPlanner
 */

const PLANNER_VERSION = '1.0.0';

const { getOpening } = require('./openingLibrary');

/**
 * Tradition-specific planning defaults.
 * Each tradition has a distinct psychological/karmic/constitutional lens.
 */
const TRADITION_DEFAULTS = {
    western: {
        lens: 'psychological',
        coreFocus: 'identity and inner dialogue',
        loveFocus: 'relational patterns and projection',
        proFocus: 'growth edge and vocational expression',
        openingMood: 'curious recognition',
        closingMood: 'integrated self-knowledge',
        depthLevel: 'psychological depth',
        callbackStrategy: 'defense-to-growth transformation',
        narrativeFlow: 'surface pattern → underlying mechanism → core recognition → relational implication → developmental direction',
        literaryStyle: 'analytical warmth, precise metaphor, earned insight',
        centralThemes: ['identity', 'growth', 'inner dialogue', 'shadow', 'development'],
        supportingThemePool: ['contradiction', 'defense', 'archetype', 'developmental arc', 'internal dialogue', 'growth edge', 'recognition', 'integration']
    },
    vedic: {
        lens: 'karmic',
        coreFocus: 'dharma indicators and karmic imprints',
        loveFocus: 'karmic relationships and ancestral patterns',
        proFocus: 'current curriculum and remedial alignment',
        openingMood: 'reverent witnessing',
        closingMood: 'aligned purpose',
        depthLevel: 'karmic context',
        callbackStrategy: 'samskara-to-upaya transformation',
        narrativeFlow: 'inherited pattern → ancestral debt → current lesson → relational karma → remedial action → evolutionary purpose',
        literaryStyle: 'timeless gravity, ritual precision, compassionate authority',
        centralThemes: ['karma', 'dharma', 'purpose', 'lessons', 'timing'],
        supportingThemePool: ['samskara', 'ancestral inheritance', 'dasha timing', 'upaya', 'varna', 'svadharma', 'ripening', 'evolution']
    },
    hellenic: {
        lens: 'constitutional',
        coreFocus: 'temperament and planetary condition',
        loveFocus: 'sect-based relational dynamics',
        proFocus: 'virtue excellence and time-lord chapters',
        openingMood: 'clear-eyed assessment',
        closingMood: 'constitutional sovereignty',
        depthLevel: 'constitutional clarity',
        callbackStrategy: 'condition-to-excellence transformation',
        narrativeFlow: 'sect determination → temperament balance → planetary condition → relational sect dynamics → time-lord chapter → virtuous flourishing',
        literaryStyle: 'architectural clarity, reasoned elegance, measured authority',
        centralThemes: ['virtue', 'temperament', 'balance', 'character', 'reason'],
        supportingThemePool: ['sect', 'bonification', 'maltreatment', 'angularity', 'phase', 'profection', 'releasing', 'arete']
    }
};

/**
 * Deterministic hash function for consistent planning from string input.
 * Used to select opening/closing strategies, theme variations without randomness.
 * 
 * @param {string} str - Input string
 * @returns {number} 32-bit hash
 */
function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash);
}

/**
 * Selects an item from an array deterministically based on a seed.
 * 
 * @param {Array} arr - Array to select from
 * @param {number} seed - Numeric seed
 * @returns {*} Selected item
 */
function deterministicSelect(arr, seed) {
    return arr[seed % arr.length];
}

/**
 * Generates a unique seed from user input for deterministic planning.
 * 
 * @param {Object} params - User parameters
 * @returns {number} Deterministic seed
 */
function generateSeed(params) {
    const combined = `${params.name}|${params.dob}|${params.birthplace}|${params.tradition}|${params.photoHash || ''}`;
    return hashString(combined);
}

/**
 * Plans the central theme — the reading's gravitational center.
 * 
 * @param {Object} tradition - Tradition defaults
 * @param {number} seed - Deterministic seed
 * @returns {string} Central theme
 */
function planCentralTheme(tradition, seed) {
    const themes = tradition.centralThemes;
    return deterministicSelect(themes, seed);
}

/**
 * Plans 2-3 supporting themes that orbit the central theme.
 * 
 * @param {Object} tradition - Tradition defaults
 * @param {number} seed - Deterministic seed
 * @returns {Array<string>} Supporting themes
 */
function planSupportingThemes(tradition, seed) {
    const pool = tradition.supportingThemePool;
    const count = 2 + (seed % 2); // 2 or 3 themes
    const selected = [];
    let localSeed = seed;
    
    for (let i = 0; i < count; i++) {
        localSeed = hashString(localSeed.toString() + i);
        const theme = deterministicSelect(pool, localSeed);
        if (!selected.includes(theme)) {
            selected.push(theme);
        }
    }
    
    return selected;
}

/**
 * Plans the emotional destination — where the reading arrives.
 * 
 * @param {Object} tradition - Tradition defaults
 * @param {string} traditionKey - Tradition key ('western'|'vedic'|'hellenic')
 * @param {number} seed - Deterministic seed
 * @returns {string} Emotional destination
 */
function planEmotionalDestination(tradition, traditionKey, seed) {
    const destinations = {
        western: [
            'quiet self-knowledge',
            'compassionate recognition of pattern',
            'hard-won clarity on growth edge',
            'tender acceptance of contradiction',
            'focused determination toward integration'
        ],
        vedic: [
            'aligned purpose',
            'peaceful surrender to curriculum',
            'reverent understanding of karmic thread',
            'calm acceptance of ancestral inheritance',
            'determined alignment with dharma'
        ],
        hellenic: [
            'constitutional sovereignty',
            'reasoned excellence in character',
            'balanced flourishing within nature',
            'clear-eyed mastery of temperament',
            'virtuous command of fortune'
        ]
    };
    
    return deterministicSelect(destinations[traditionKey], seed);
}

/**
 * Plans the symbolic thread — the central image that weaves through all sections.
 * 
 * @param {Object} tradition - Tradition defaults
 * @param {string} traditionKey - Tradition key ('western'|'vedic'|'hellenic')
 * @param {number} seed - Deterministic seed
 * @returns {string} Symbolic thread
 */
function planSymbolicThread(tradition, traditionKey, seed) {
    const threads = {
        western: [
            'a locked room with many keys',
            'a mirror that shows the back of your head',
            'a garden growing through cracked pavement',
            'a compass spinning near magnetic north',
            'a house with doors that open inward'
        ],
        vedic: [
            'a thread pulled through generations of beads',
            'a river returning to its source',
            'a seed containing the forest',
            'a lamp passed from hand to hand',
            'a mantra written in the lines of the palm'
        ],
        hellenic: [
            'a ship trimmed to the prevailing wind',
            'a statue emerging from the marble',
            'a scale finding its balance point',
            'a lyre tuned to its proper mode',
            'a column bearing its designed weight'
        ]
    };
    
    return deterministicSelect(threads[traditionKey], seed);
}

/**
 * Plans the callback strategy — how CORE seeds transform through LOVE to PRO.
 * 
 * @param {string} traditionKey - Tradition key ('western'|'vedic'|'hellenic')
 * @param {number} seed - Deterministic seed
 * @returns {Object} Callback strategy details
 */
function planCallbackStrategy(traditionKey, seed) {
    const strategies = {
        western: {
            coreToLove: 'Name the defense and its origin',
            loveToPro: 'Show the defense operating in intimacy',
            proToCore: 'Reveal the growth edge beyond the defense'
        },
        vedic: {
            coreToLove: 'Identify the samskara and its lineage',
            loveToPro: 'Trace the samskara in relational karma',
            proToCore: 'Offer the upaya for this curriculum'
        },
        hellenic: {
            coreToLove: 'Assess the planetary condition and sect',
            loveToPro: 'Map the condition to relational dynamics',
            proToCore: 'Chart the time-lord chapter toward arete'
        }
    };
    
    return strategies[traditionKey];
}

/**
 * Plans the opening mood and strategy.
 * 
 * @param {Object} tradition - Tradition defaults
 * @param {number} seed - Deterministic seed
 * @returns {Object} Opening plan
 */
function planOpening(tradition, seed) {
    const strategies = [
        'sensory_hook',      // Concrete image landing
        'contradiction_open', // Named paradox immediately
        'pattern_recognition', // Familiar pattern named freshly
        'question_invitation', // Direct question to the reader
        'image_immersion',   // Symbolic thread introduced
        'line_observation',  // Specific hand feature as gateway
        'temporal_framing'   // Developmental moment located
    ];
    
    return {
        mood: tradition.openingMood,
        strategy: deterministicSelect(strategies, seed)
    };
}

/**
 * Plans the closing mood and strategy.
 * 
 * @param {Object} tradition - Tradition defaults
 * @param {number} seed - Deterministic seed
 * @returns {Object} Closing plan
 */
function planClosing(tradition, seed) {
    const strategies = [
        'resonant_image',      // Symbolic thread returns transformed
        'returned_opening',    // Opening image/question revisited
        'quiet_question',      // Open question that lingers
        'earned_affirmation',  // Recognition without flattery
        'open_horizon',        // Direction indicated, not predicted
        'silent_witness'       // Final image stands without comment
    ];
    
    return {
        mood: tradition.closingMood,
        strategy: deterministicSelect(strategies, seed + 7) // Offset seed
    };
}

/**
 * Main entry point: creates a structured narrative plan for a reading.
 * 
 * This is PURE PLANNING. No prose generation. No AI calls. No prompts.
 * The plan becomes structured context for the prompt assembler.
 * 
 * @param {Object} params - User input parameters
 * @param {string} params.name - User's name
 * @param {string} params.dob - Date of birth (YYYY-MM-DD)
 * @param {string} params.birthplace - Birth city/location
 * @param {string} params.tradition - Tradition: 'western' | 'vedic' | 'hellenic'
 * @param {string} [params.photoHash] - Palm photo hash (presence tracked)
 * @returns {Object} Narrative plan
 * @property {string} centralTheme - Gravitational center of the reading
 * @property {Array<string>} supportingThemes - 2-3 orbiting themes
 * @property {string} emotionalDestination - Where the reading arrives emotionally
 * @property {string} symbolicThread - Central image weaving through all sections
 * @property {string} coreFocus - CORE section's specific focus
 * @property {string} loveFocus - LOVE section's specific focus
 * @property {string} proFocus - PRO section's specific focus
 * @property {string} openingMood - Emotional tone of opening
 * @property {string} closingMood - Emotional tone of closing
 * @property {string} depthLevel - Depth ladder target
 * @property {Object} callbackStrategy - How seeds transform CORE→LOVE→PRO
 * @property {string} narrativeFlow - One-sentence flow description
 * @property {string} literaryStyle - Prose style guidance
 * @property {string} traditionLens - Tradition's interpretive lens
 */
function planReading(params) {
    // Validate required fields
    const required = ['name', 'dob', 'birthplace', 'tradition'];
    for (const field of required) {
        if (!params[field] || typeof params[field] !== 'string' || !params[field].trim()) {
            throw new Error(`Missing or invalid required field: ${field}`);
        }
    }

    const validTraditions = ['western', 'vedic', 'hellenic'];
    if (!validTraditions.includes(params.tradition)) {
        throw new Error(`Invalid tradition: ${params.tradition}. Must be one of: ${validTraditions.join(', ')}`);
    }

    const tradition = TRADITION_DEFAULTS[params.tradition];
    const seed = generateSeed(params);

    // Plan all components
    const centralTheme = planCentralTheme(tradition, seed);
    const supportingThemes = planSupportingThemes(tradition, seed);
    const emotionalDestination = planEmotionalDestination(tradition, params.tradition, seed);
    const symbolicThread = planSymbolicThread(tradition, params.tradition, seed);
    const callbackStrategy = planCallbackStrategy(params.tradition, seed);
    const opening = planOpening(tradition, seed);
    const closing = planClosing(tradition, seed);

    // Select the opening paragraph from openingLibrary
    // Pass palmEvidence if available (for MODE B), otherwise MODE A is used
    const selectedOpening = getOpening({
        tradition: params.tradition,
        centralTheme,
        symbolicThread,
        openingMood: opening.mood,
        palmEvidence: params.palmEvidence // Optional - only for MODE B
    });

    return {
        centralTheme,
        supportingThemes,
        emotionalDestination,
        symbolicThread,
        coreFocus: tradition.coreFocus,
        loveFocus: tradition.loveFocus,
        proFocus: tradition.proFocus,
        openingMood: opening.mood,
        closingMood: closing.mood,
        depthLevel: tradition.depthLevel,
        callbackStrategy,
        narrativeFlow: tradition.narrativeFlow,
        literaryStyle: tradition.literaryStyle,
        traditionLens: tradition.lens,
        selectedOpening
    };
}

module.exports = {
    planReading
};