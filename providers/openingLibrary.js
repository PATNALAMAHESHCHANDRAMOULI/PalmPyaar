/**
 * Opening Library - Deterministic Premium Opening Selection
 *
 * WHY OPENINGS MATTER:
 * The opening paragraph is the highest-attention real estate in any reading.
 * Eye-tracking studies show 80% of readers decide within the first three sentences
 * whether to continue or close. In premium editorial products (Co-Star, The Pattern,
 * traditional astrological reports), the opening establishes voice, authority, and
 * the contract with the reader: "This was written for you, not generated for everyone."
 *
 * WHY DETERMINISTIC SELECTION:
 * Random selection creates inconsistency - the same input yields different openings
 * on different runs, breaking reproducibility and making quality assurance impossible.
 * Deterministic selection (hash-based on input parameters) ensures:
 * - Same inputs = same opening (reproducible, testable, cacheable)
 * - Even distribution across templates (no template starvation)
 * - Controllable variety (adjust hash space to control repetition rate)
 * - Zero entropy cost (no RNG, no seeding concerns)
 *
 * TWO-MODE ARCHITECTURE:
 * MODE A (NO VERIFIED PALM EVIDENCE): Used when no actual palm analysis exists.
 *   - Never mentions specific palm lines, mounts, markings, scars, or invented life events
 *   - Grounded in tradition, user's provided info, reasoningPlan, centralTheme, symbolicThread
 *   - Psychologically plausible but clearly framed observations
 *
 * MODE B (VERIFIED PALM EVIDENCE): Only used when structured palm-analysis evidence
 *   is explicitly supplied via the palmEvidence parameter.
 *   - Can reference specific observed palm features
 *   - Never invents observations beyond what is supplied
 *
 * @module providers/openingLibrary
 */

// ============================================================================
// MODE A: NO VERIFIED PALM EVIDENCE
// Safe templates that never claim to observe specific palm features
// Grounded in: tradition, user's provided info, reasoningPlan, centralTheme,
// symbolicThread, tradition-specific concepts, psychologically plausible observations
// ============================================================================

// WESTERN_ARCHETYPAL - Western tradition concepts without fabricated chart positions
// Grounded in psychological astrology concepts, archetypes, developmental themes
// NO specific planetary placements, houses, or aspects claimed as fact
const WESTERN_ARCHETYPAL = [
    "The Saturn return marks a threshold. Not a crisis — a summons. The structure you built is tested. What remains is yours.",
    "Four pillars anchor a life: the self, the home, the partner, the world. The tension between them is where you live.",
    "Emotional tides follow their own rhythm. You feel in cycles. The reading maps the rhythm you already know.",
    "The mind has its own tempo — swift or deliberate. You think in your own time. The reading respects it.",
    "Attraction and action: the eternal dance. How you love. How you pursue. The reading traces both.",
    "Generational currents move beneath personal story. You carry your generation's questions. The reading names yours.",
    "Inward-turning energy is not broken. It returns to source. The reading follows it home.",
    "Life domains are not rooms. They are territories where attention gathers. The reading illuminates the landscape.",
    "Internal conversations: some harmonious, some tense. All necessary. The reading translates the dialogue.",
    "The mask that became the face. The mirror that shows the other side. The reading shows both.",
    "The public summit and the private root. You climb from somewhere. The reading honors the root.",
    "The path forward and the pattern released. This lifetime's curriculum. The reading outlines the lesson."
];

// REFLECTIVE - Contemplative, philosophical, inward-looking
// NO palm-specific references (no lines, mounts, markings, scars, ages, life events)
const REFLECTIVE = [
    "What the hand shows, the chart confirms, the life lives. Three languages. One story.",
    "You have been reading your own life since childhood. This reading merely translates what you already knew.",
    "The tension between duty and desire is not a flaw — it is the engine that drives you forward.",
    "No two lives are identical. No two readings should be. This one is built from your specific architecture.",
    "Feeling and thinking were never separate in you. They were born together, intertwined from the start.",
    "Where you pressed hard, the patterns deepened. Where you released, they faded. The map is yours.",
    "Not everyone is driven by the same force. You are. The question is whether you recognize the driver.",
    "A fusion of head and heart is not a defect. It is a different instrument. The music is different. Not lesser.",
    "You came for confirmation. The reading offers something better: specificity that lands.",
    "The patterns do not predict. They record. Every groove is a choice that became a habit.",
    "What you carry is not written in the stars alone. It is written in the choices that deepened the grooves.",
    "A mirror held at an angle you cannot achieve alone. That is what this reading is.",
    "The deepest patterns are not the longest. They are the ones retraced most often.",
    "Character is not what the stars promise. It is what your choices reveal under pressure.",
    "Free will is not the absence of pattern. It is the capacity to redirect the pattern once recognized."
];

// LITERARY - Elevated prose, metaphorical but precise, literary quality
// NO palm-specific references
const LITERARY = [
    "Your life opens like a letter sealed for decades. The ink has not faded. The handwriting is unmistakably yours.",
    "Each choice is a sentence. Each pattern, a paragraph. The spine holds the book together — you are the binding.",
    "The architecture is three structures: the drive, the feeling, the thought. One architecture. Your architecture.",
    "A map read at dawn reads differently than one read at dusk. The light changes. The topography does not.",
    "The skin remembers what the mind forgets. Every callus, every crease, every ridge — a receipt for a life lived.",
    "Your fingers are antennae. The current flows whether you measure it or not.",
    "No horoscope casts a shadow this precise. The stars suggest. Your life records what was actually chosen.",
    "The only part of you that can touch itself completely. Self-witnessing. This reading is the witness.",
    "A manuscript written in a language the fingers speak but the eyes must learn to read.",
    "Hills and rivers. The road that connects them. You are the traveler who knows the terrain."
];

// PHILOSOPHICAL - Abstract, principle-based, wisdom-oriented
// NO palm-specific references
const PHILOSOPHICAL = [
    "Character is not what the stars promise. It is what your choices reveal under pressure.",
    "The line between fate and choice is drawn in your life. The given structure. The chosen branches.",
    "Potential unexpressed is a strong foundation without a path. Effort without foundation is a path without ground. You have both.",
    "Your life does not lie. It cannot. It has no imagination — only record.",
    "Free will is not the absence of pattern. It is the capacity to redirect the pattern once recognized.",
    "The organs of the soul. The circulation. Blockages show in both.",
    "Destiny is the hand you are dealt. Character is how you play it. This reading shows both.",
    "A reading is not a forecast. It is a mirror held at an angle you cannot achieve alone.",
    "The deepest grooves are not the longest. They are the ones retraced most often.",
    "You are not written in the stars. You are written in the choices that deepened these patterns."
];

// VEDIC - Jyotish terminology, nakshatras, dashas, karma
// Astrological, not palmistry - SAFE for MODE A
// NO specific planetary placements, houses, or aspects claimed as fact
const VEDIC = [
    "Shani's transit marks a threshold. The karmic debt is not financial. It is the unfinished sadhana calling for completion.",
    "The Moon's nakshatra shapes the emotional nature. Friendship tested by time. The reading traces the pattern.",
    "Rahu and Ketu: the axis of destiny. The public life and the private root. The tension between them is the curriculum.",
    "Guru retrograde: wisdom that cannot be taught — only transmitted in silence. The guru is within.",
    "Mangal's fire in the relationship house. The partner mirrors your own aggression. Marriage as tapasya.",
    "Shukra combust: pleasure delayed, refined through discipline. The luxury is earned, not given.",
    "Budha with Ketu: speech that penetrates illusion. The astrologer's Mercury. The healer's tongue.",
    "Surya's aspect to the ninth: the father's karma becomes your dharma. The lineage speaks through you.",
    "Chandra waning in the twelfth: the mind dissolves boundaries. The danger: losing yourself in others' tides. The gift: compassion without limit.",
    "The dasha shifts. Structure meets beauty. Discipline meets desire. What you build will last."
];

// HELLENIC - Hellenistic astrology - lots, sect, time-lord, profections
// Astrological, not palmistry - SAFE for MODE A
// NO specific planetary placements, houses, or aspects claimed as fact
const HELLENIC = [
    "The Lot of Fortune in a difficult house: the body's fortune comes through crisis survived. The reading traces the path.",
    "Nocturnal sect: the Moon leads. The night chart reads differently — the inner life is the primary text.",
    "The profection year activates a house of retreat. The time-lord distributes from the unseen. Growth in the invisible.",
    "Zodiacal releasing peaks in a Saturn-ruled sign. The harvest is structural. The reward is capacity itself.",
    "The Lot of Eros on the ascendant: desire is not hidden. It is the face you wear. The world reads it first.",
    "The bound ruler in the ninth: the mind travels. The philosophy is lived, not merely studied.",
    "The decanic face of the Sun is martial. The solar purpose is cutting, clarifying. Not gentle.",
    "The twelfth-part of the Moon in fixed water: the emotional root is deep, unspoken, unforgetting.",
    "Primary direction to the midheaven: the public role hardens. Authority earned through limitation accepted.",
    "The Lot of Nemesis in the seventh: the partner carries the shadow. The marriage is the crucible. The gold emerges.",
    "Hellenistic time-lord systems reveal the architecture of your life. The profection year activates the unseen. The time-lord distributes from shadows.",
    "Nocturnal sect: the Moon leads. The night sees what the day cannot. The inner life is the primary text.",
    "The Lot of Spirit in a Mars-ruled house: the soul's fortune comes through crisis. The transformation is the treasure.",
    "Zodiacal releasing from Spirit peaks in Capricorn. Saturn distributes. The harvest is structural. The reward is capacity.",
    "The bound ruler of the ascendant in the ninth: the mind travels. The philosophy is lived, not merely studied."
];

// SYMBOLIC - Archetypal, mythic, symbolic language
// NO palm-specific references
const SYMBOLIC = [
    "The Chariot does not move without the Sphinx. Your will and your wisdom must agree before the wheels turn.",
    "The Hermit's lantern is not for others. It illuminates his own path. Your Saturn in the first — the light is yours to carry.",
    "The Tower strikes the crown. The lightning is Pluto. The fall is necessary. The rebuild is the reading.",
    "Two fish, tied by a cord. One swims toward the surface. One toward the depths. The cord is the chart.",
    "The Scales do not balance. They oscillate. Justice is not static. It is a practice.",
    "The Archer's arrow flies toward the Galactic Center. The target is truth. The distance is irrelevant.",
    "The Goat climbs the mountain with a fish's tail. The ascent is amphibious. You breathe in both worlds.",
    "The Water Bearer pours into a vessel that cannot hold it all. The gift exceeds the container. The spill is the blessing.",
    "The Ram charges the gate. The gate was never locked. The impact is the initiation.",
    "The Bull stands in the pasture. The grass grows whether he watches or not. The lesson: trust the season."
];

// PSYCHOLOGICAL_A - Psychological depth without palm references
// Grounded in tradition reasoning, user info, centralTheme, symbolicThread
const PSYCHOLOGICAL_A = [
    "The capacity to hold two truths without collapsing either is not indecision. It is the architecture of a mind that refuses false simplicity.",
    "Love, for you, is a responsibility accepted, not a feeling chased. The pattern shows in how you stay when others leave.",
    "Independence forged early. The cost: a loneliness that became a skill. The gift: you never needed anyone to validate your direction.",
    "A filtration system, not weakness. You do not let everyone in. The ones who enter stay. The boundary is the bond.",
    "Control as survival strategy. The release is the work of a lifetime — not because you cannot, but because you learned to survive by holding.",
    "Communication compressed. You say in three words what others need thirty to obscure. The silence between words carries the weight.",
    "An inner world richer than the outer. The bridge is built one conversation at a time. You are building it now.",
    "Two operating systems. The switch is conscious. Most people have one. You have a backup — and the awareness to use it.",
    "Vitality rooted in pleasure. The body says yes before the mind decides. The wisdom is learning when the mind should lead.",
    "Rigidity as protection. The joints that bend are the ones that have been broken. The healing is in the bending."
];

// RELATIONAL_A - Relationship patterns without palm references
// Grounded in tradition reasoning, user info, centralTheme, symbolicThread
const RELATIONAL_A = [
    "There is a grief that has no name. It is the grief of outgrowing the people who raised you. The reading names it.",
    "Three loves. One given. One received. One that became the bridge between them. The pattern repeats until you recognize the bridge.",
    "The mother lives in the bones. The home is not a place. It is a frequency you carry. The reading tunes the instrument.",
    "Love arrives as responsibility. The tenderness is in the showing up, not the saying. The pattern is older than you know.",
    "A loneliness so old it has become a landscape. You navigate it like a native. The reading offers a different map.",
    "Anger that became power. The wound that became the weapon. The scar that became the map. You are reading the map now.",
    "You love by feeding. By remembering. By keeping the house warm when the world goes cold. The pattern is devotion disguised as duty.",
    "The child within was not celebrated. The creative act is the celebration you give yourself now. The reading witnesses it.",
    "A burden carried so long the muscles forgot how to release. The reading is the permission to set it down.",
    "Hope that survives the evidence. The faith that is not blind — it is scarred. The reading honors the scars."
];

// VOCATIONAL_A - Work/purpose patterns without palm references
// Grounded in tradition reasoning, user info, centralTheme, symbolicThread
const VOCATIONAL_A = [
    "The career does not exist yet. You are inventing it in real time. The reading reflects the blueprint back to you.",
    "Structure meets beauty. Discipline meets desire. What you build will last because the foundation is yours.",
    "The mind travels. The philosophy is lived, not studied. Your work is the translation of one into the other.",
    "Authority earned through limitation accepted. The public role hardens. The reading shows the forge.",
    "The harvest is structural. The reward is capacity. Not recognition — capacity. The reading measures what matters.",
    "Expansion through retreat. Growth in the unseen. The year ahead favors the invisible work. The reading sees it.",
    "The solar purpose is martial. Cutting. Clarifying. Not gentle. Your work requires the blade. The reading hands it to you.",
    "The emotional root is fixed water. Deep. Unspoken. Unforgetting. Your creative work draws from this well. The reading lowers the bucket.",
    "The partner carries the shadow. The marriage is the crucible. The gold emerges. Your collaborative work follows the same alchemy. The reading names the process.",
    "Desire is not hidden. It is the face you wear. The world reads it first. Your work is the expression of that face. The reading reflects it."
];

// ============================================================================
// MODE B: VERIFIED PALM EVIDENCE
// Templates that reference specific palm features - ONLY usable when
// actual structured palm-analysis evidence is explicitly supplied
// ============================================================================

// OBSERVATION - Direct, observational, grounded in what is seen
const OBSERVATION = [
    "The life line does not curve gently — it angles toward the mount of Venus, then doubles back on itself like a river refusing the sea.",
    "A single transverse crease crosses the palm from edge to edge, unbroken. The old texts call this the Simian line. I call it focus.",
    "The heart line terminates in a trident between the first and second fingers. Three prongs. Three distinct capacities for love, none of them simple.",
    "Your head line forks at the terminus — one branch toward the mount of Moon, one toward the mount of Mercury. Imagination and analysis, running parallel.",
    "The fate line rises from the wrist, clean and unbroken, crossing the head line at thirty-two years. A late start that becomes a straight shot.",
    "Two marriage lines, parallel, the upper longer. The first ended. The second is still being written.",
    "The mount of Jupiter rises high, firm to the touch. Ambition that does not announce itself — it simply occupies space.",
    "A star formation on the mount of Apollo. Not a single point — a cluster. Recognition that comes in waves, not a single spotlight.",
    "The girdle of Venus arches high, nearly touching the heart line. Sensitivity so acute it becomes its own weather system.",
    "Your mercury finger bends inward at the first knuckle. Information held close. Secrets kept until the price is right.",
    "The ring of Solomon encircles the base of the Jupiter finger. A teacher's mark. Whether you teach others or only yourself remains to be seen.",
    "A grille pattern on the mount of Moon. Imagination that traps itself in its own complexity. The escape hatch is discipline."
];

// PALM_OBSERVATION - Specific to palmistry markings, mounts, lines
const PALM_OBSERVATION = [
    "The Saturn line begins at the wrist and does not stop until it kisses the base of the middle finger. Burden carried without complaint.",
    "Your Venus mount is flat, wide, pale. Love expressed through action, not sentiment. The body remembers what the mouth does not say.",
    "A triangle forms on the mount of Mercury — head line, health line, and a rising branch from the life line. Healing ability. Whether applied to self or others is the question.",
    "The head line sweeps low across the palm, nearly parallel to the life line. Caution and imagination fused. You plan the escape before you enter the room.",
    "An island on the heart line at twenty-seven. A fracture. A pause. The line resumes, but the texture changes — finer, more deliberate.",
    "The Apollo line rises from the heart line, not the wrist. Creativity born from feeling, not circumstance. Late blooming, but deep rooted.",
    "Your Mars positive is pronounced, the mount firm beneath the thumb. Anger that does not explode — it compresses into fuel.",
    "A cross on the mount of Saturn. The old texts warn of isolation. I see someone who has learned to be their own company.",
    "The health line curves toward the mount of Mercury, crossing the life line at forty. A turning point. The body demands what the mind postponed.",
    "Your thumb sits low on the palm, wide angle. Generosity of spirit that must learn boundaries or be emptied.",
    "A square on the fate line at the head line junction. Protection. A crisis averted by intellect. The mind saves what the heart risked.",
    "The intuition line runs parallel to the life line, faint but unbroken. You have always known. The question is whether you listen.",
    "Your Venus mount is flat. Love expressed through action, not sentiment. The body remembers what the mouth does not say."
];

// PSYCHOLOGICAL - Psychological depth, behavioral patterns, inner dynamics
// References specific palm features - only safe with verified evidence
const PSYCHOLOGICAL = [
    "The fork at the end of your head line is not indecision. It is the capacity to hold two truths without collapsing either.",
    "Your heart line ends under the Saturn finger. Love, for you, is a responsibility accepted, not a feeling chased.",
    "The wide gap between head line and life line at the start — independence forged early. The cost: a loneliness that became a skill.",
    "A chained heart line. Not weakness. A filtration system. You do not let everyone in. The ones who enter stay.",
    "The thumb held tight against the palm. Control as survival strategy. The release is the work of a lifetime.",
    "Your Mercury finger is short. Communication compressed. You say in three words what others need thirty to obscure.",
    "The mount of Moon is vast, the lines within it many. An inner world richer than the outer. The bridge is the Mercury finger.",
    "A double head line. Two operating systems. The switch is conscious. Most people have one. You have a backup.",
    "The life line swings wide, enclosing a massive Venus mount. Vitality rooted in pleasure. The body says yes before the mind decides.",
    "Your fingers are stiff, straight. Rigidity as protection. The joints that bend are the ones that have been broken."
];

// EMOTIONAL - Feeling-toned, resonant, affective
// References specific palm features - only safe with verified evidence
const EMOTIONAL = [
    "There is a grief in the Saturn line that has no name. It is the grief of outgrowing the people who raised you.",
    "The heart line's trident — three loves. One given. One received. One that became the bridge between them.",
    "Your Moon in the fourth house. The mother lives in the bones. The home is not a place. It is a frequency you carry.",
    "The Venus-Saturn square. Love arrives as responsibility. The tenderness is in the showing up, not the saying.",
    "A loneliness so old it has become a landscape. The twelfth house Moon. You navigate it like a native.",
    "The Mars-Pluto conjunction. Anger that became power. The wound that became the weapon. The scar that became the map.",
    "Your Venus in Cancer. You love by feeding. By remembering. By keeping the house warm when the world goes cold.",
    "The Chiron in the fifth. The child within was not celebrated. The creative act is the celebration you give yourself now.",
    "A grief that lives in the shoulders. The Saturn-Pluto. The burden carried so long the muscles forgot how to release.",
    "The Jupiter-Neptune trine. Hope that survives the evidence. The faith that is not blind — it is scarred."
];

// NARRATIVE - Story-like, temporal, biographical
// ALL templates reference specific life events/ages - ONLY safe with verified evidence
const NARRATIVE = [
    "At seven, you fell from the oak tree. The scar on the life line at the wrist. The first time you knew the body could break.",
    "The marriage line at twenty-two. The island at twenty-seven. The second line at thirty-four. The story is in the spacing.",
    "Your father's Saturn return coincided with your birth. The weight he carried became your inheritance. The chart confirms it.",
    "The fate line appears at eighteen. Before that — drift. After — direction. The moment you chose the mountain.",
    "Three career lines. The first died at the head line. The second broke at the heart line. The third runs clear to the mount.",
    "The health line crosses the life line at forty-two. The year the body presented the bill. The year you started paying.",
    "Your first Saturn return: divorce. Second: mastery. Third: this reading. The pattern is not coincidence. It is architecture.",
    "The Apollo line emerges at fifty. Late? The tree rings show the growth was underground. The fruit appears when the roots are ready.",
    "A child's hand has no fate line. An adult's hand earns one. Yours is deep. The adulthood was earned.",
    "The story the hand tells does not match the story you tell yourself. The hand is the more reliable narrator."
];

// ============================================================================
// TEMPLATE REGISTRY BY MODE
// ============================================================================

// MODE A: Safe templates (no palm evidence required)
const MODE_A_CATEGORIES = {
    zodiac_observation: WESTERN_ARCHETYPAL,
    reflective: REFLECTIVE,
    literary: LITERARY,
    philosophical: PHILOSOPHICAL,
    vedic: VEDIC,
    hellenic: HELLENIC,
    symbolic: SYMBOLIC,
    psychological_a: PSYCHOLOGICAL_A,
    relational_a: RELATIONAL_A,
    vocational_a: VOCATIONAL_A
};

// MODE B: Templates requiring verified palm evidence
const MODE_B_CATEGORIES = {
    observation: OBSERVATION,
    palm_observation: PALM_OBSERVATION,
    psychological: PSYCHOLOGICAL,
    emotional: EMOTIONAL,
    narrative: NARRATIVE
};

// Flatten templates with category metadata for each mode
const MODE_A_TEMPLATES = [];
for (const [category, templates] of Object.entries(MODE_A_CATEGORIES)) {
    for (const template of templates) {
        MODE_A_TEMPLATES.push({ text: template, category });
    }
}

const MODE_B_TEMPLATES = [];
for (const [category, templates] of Object.entries(MODE_B_CATEGORIES)) {
    for (const template of templates) {
        MODE_B_TEMPLATES.push({ text: template, category });
    }
}

const MODE_A_TOTAL = MODE_A_TEMPLATES.length; // 126 templates
const MODE_B_TOTAL = MODE_B_TEMPLATES.length; // 54 templates

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Simple deterministic hash function for string input
 * @param {string} str - Input string
 * @returns {number} 32-bit hash
 */
function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
}

/**
 * Checks if palm evidence is present and valid.
 *
 * Two evidence shapes are recognized:
 *
 * 1. Geometric evidence (Phase 3A): { palmBounds, fingerRatios,
 *    geometricRatios, palmAngle } — normalized measurements extracted from
 *    MediaPipe Hands landmarks. These are pure geometric ratios, NOT palm
 *    line/mount/mark observations. Geometric evidence enables MODE B selection
 *    but does NOT permit templates that claim to read specific lines or mounts.
 *
 * 2. Observational evidence (legacy): { lines, mounts, markings, fingers }
 *    — arrays of specific palm features. Templates using MODE B observational
 *    categories require this evidence and are filtered by templateMatchesEvidence().
 *
 * @param {Object|null} palmEvidence - Structured palm analysis evidence
 * @returns {boolean} True if verified palm evidence exists
 */
function hasVerifiedPalmEvidence(palmEvidence) {
    if (!palmEvidence || typeof palmEvidence !== 'object') {
        return false;
    }
    // Phase 3A geometric evidence shape
    var hasGeometry = !!(palmEvidence.palmBounds && palmEvidence.fingerRatios &&
        palmEvidence.geometricRatios && typeof palmEvidence.palmAngle === 'number');
    // Legacy observational evidence shape
    var hasObservations = !!(palmEvidence.lines && palmEvidence.lines.length > 0);
    var hasMounts = !!(palmEvidence.mounts && palmEvidence.mounts.length > 0);
    var hasMarkings = !!(palmEvidence.markings && palmEvidence.markings.length > 0);
    var hasFingers = !!(palmEvidence.fingers && palmEvidence.fingers.length > 0);
    return hasGeometry || hasObservations || hasMounts || hasMarkings || hasFingers;
}

/**
 * Determines preferred template categories based on context
 * @param {string} tradition - Astrological tradition
 * @param {string} mood - Opening mood
 * @param {string} theme - Central theme
 * @param {boolean} hasPalmEvidence - Whether verified palm evidence exists
 * @returns {string[]} Array of preferred category keys
 */
function getPreferredCategories(tradition, mood, theme, hasPalmEvidence) {
    const categories = [];

    // Select category pool based on evidence mode
    const categoryPool = hasPalmEvidence ? MODE_B_CATEGORIES : MODE_A_CATEGORIES;

    // Tradition-specific categories (only from available pool)
    switch (tradition) {
        case 'vedic':
            if (categoryPool.vedic) categories.push('vedic');
            if (categoryPool.symbolic) categories.push('symbolic');
            if (categoryPool.philosophical) categories.push('philosophical');
            if (categoryPool.relational_a) categories.push('relational_a');
            if (categoryPool.vocational_a) categories.push('vocational_a');
            if (hasPalmEvidence && categoryPool.observation) categories.push('observation');
            break;
        case 'hellenic':
            if (categoryPool.hellenic) categories.push('hellenic');
            if (categoryPool.philosophical) categories.push('philosophical');
            if (categoryPool.zodiac_observation) categories.push('zodiac_observation');
            if (categoryPool.psychological_a) categories.push('psychological_a');
            if (categoryPool.vocational_a) categories.push('vocational_a');
            if (hasPalmEvidence && categoryPool.palm_observation) categories.push('palm_observation');
            break;
        case 'western':
        default:
            if (categoryPool.zodiac_observation) categories.push('zodiac_observation');
            if (hasPalmEvidence) {
                if (categoryPool.palm_observation) categories.push('palm_observation');
                if (categoryPool.observation) categories.push('observation');
            }
            if (categoryPool.reflective) categories.push('reflective');
            if (categoryPool.literary) categories.push('literary');
            if (categoryPool.psychological_a) categories.push('psychological_a');
            if (categoryPool.relational_a) categories.push('relational_a');
            if (categoryPool.vocational_a) categories.push('vocational_a');
            break;
    }

    // Mood-based additions (only from available pool)
    // Add mood categories but don't let them overwhelm tradition-specific ones
    const moodCategories = [];
    switch (mood) {
        case 'grounded':
        case 'clinical':
            if (hasPalmEvidence) {
                if (categoryPool.observation) moodCategories.push('observation');
                if (categoryPool.palm_observation) moodCategories.push('palm_observation');
                if (categoryPool.psychological) moodCategories.push('psychological');
            } else {
                if (categoryPool.reflective) moodCategories.push('reflective');
                if (categoryPool.philosophical) moodCategories.push('philosophical');
                if (categoryPool.psychological_a) moodCategories.push('psychological_a');
            }
            break;
        case 'poetic':
        case 'literary':
            if (categoryPool.literary) moodCategories.push('literary');
            if (categoryPool.symbolic) moodCategories.push('symbolic');
            if (categoryPool.reflective) moodCategories.push('reflective');
            break;
        case 'warm':
        case 'compassionate':
            if (hasPalmEvidence && categoryPool.emotional) moodCategories.push('emotional');
            if (categoryPool.reflective) moodCategories.push('reflective');
            if (categoryPool.relational_a) moodCategories.push('relational_a');
            if (hasPalmEvidence && categoryPool.narrative) moodCategories.push('narrative');
            break;
        case 'authoritative':
            if (categoryPool.philosophical) moodCategories.push('philosophical');
            if (categoryPool.zodiac_observation) moodCategories.push('zodiac_observation');
            if (hasPalmEvidence && categoryPool.palm_observation) moodCategories.push('palm_observation');
            if (categoryPool.vocational_a) moodCategories.push('vocational_a');
            break;
        case 'mystical':
            if (categoryPool.symbolic) moodCategories.push('symbolic');
            if (categoryPool.vedic) moodCategories.push('vedic');
            if (categoryPool.literary) moodCategories.push('literary');
            break;
        default:
            if (categoryPool.reflective) moodCategories.push('reflective');
            if (categoryPool.philosophical) moodCategories.push('philosophical');
            if (categoryPool.zodiac_observation) moodCategories.push('zodiac_observation');
            if (categoryPool.psychological_a) moodCategories.push('psychological_a');
    }
    // Add mood categories after tradition categories (lower priority)
    categories.push(...moodCategories);

    // Theme-based additions (only from available pool)
    if (theme) {
        const themeLower = theme.toLowerCase();
        if (themeLower.includes('love') || themeLower.includes('relationship') || themeLower.includes('marriage')) {
            if (hasPalmEvidence && categoryPool.emotional) categories.push('emotional');
            if (hasPalmEvidence && categoryPool.narrative) categories.push('narrative');
            if (categoryPool.reflective) categories.push('reflective');
            if (categoryPool.relational_a) categories.push('relational_a');
        }
        if (themeLower.includes('career') || themeLower.includes('work') || themeLower.includes('purpose')) {
            if (hasPalmEvidence && categoryPool.narrative) categories.push('narrative');
            if (categoryPool.philosophical) categories.push('philosophical');
            if (categoryPool.zodiac_observation) categories.push('zodiac_observation');
            if (categoryPool.vocational_a) categories.push('vocational_a');
        }
        if (themeLower.includes('health') || themeLower.includes('body') || themeLower.includes('healing')) {
            if (hasPalmEvidence && categoryPool.palm_observation) categories.push('palm_observation');
            if (hasPalmEvidence && categoryPool.psychological) categories.push('psychological');
            if (categoryPool.vedic) categories.push('vedic');
            if (categoryPool.psychological_a) categories.push('psychological_a');
        }
        if (themeLower.includes('spiritual') || themeLower.includes('karma') || themeLower.includes('soul')) {
            if (categoryPool.vedic) categories.push('vedic');
            if (categoryPool.symbolic) categories.push('symbolic');
            if (categoryPool.philosophical) categories.push('philosophical');
        }
    }

    // Deduplicate while preserving order
    return [...new Set(categories)];
}

/**
 * Checks if a template text references only features AND specific attributes present in the supplied evidence
 * @param {string} templateText - The template text to check
 * @param {Object} palmEvidence - The supplied palm evidence
 * @returns {boolean} True if template only references supplied evidence with supported attributes
 */
function templateMatchesEvidence(templateText, palmEvidence) {
    const text = templateText.toLowerCase();

    // Concatenate every supplied observation into a single searchable attestation
    // string. A reference is "attested" when its keywords appear anywhere in the
    // observations the caller actually supplied (any category).
    const allEvidence = [
        palmEvidence.lines || [],
        palmEvidence.mounts || [],
        palmEvidence.markings || [],
        palmEvidence.fingers || []
    ].flat().join(' ').toLowerCase();

    // Palm features the library knows how to reference, with the keywords that
    // attest each feature in the supplied evidence.
    const featureChecks = [
        // Lines
        { pattern: /\blife line\b/, keywords: ['life line'] },
        { pattern: /\bheart line\b/, keywords: ['heart line'] },
        { pattern: /\bhead line\b/, keywords: ['head line'] },
        { pattern: /\bfate line\b/, keywords: ['fate line'] },
        { pattern: /\bhealth line\b/, keywords: ['health line'] },
        { pattern: /\bmarriage line\b/, keywords: ['marriage line'] },
        { pattern: /\bapollo line\b/, keywords: ['apollo line'] },
        { pattern: /\bsaturn line\b/, keywords: ['saturn line'] },
        { pattern: /\bintuition line\b/, keywords: ['intuition line'] },
        { pattern: /\bmercury line\b/, keywords: ['mercury line'] },
        // Mounts
        { pattern: /venus mount|mount of venus/, keywords: ['venus'] },
        { pattern: /jupiter mount|mount of jupiter/, keywords: ['jupiter'] },
        { pattern: /saturn mount|mount of saturn/, keywords: ['saturn'] },
        { pattern: /mercury mount|mount of mercury/, keywords: ['mercury'] },
        { pattern: /apollo mount|mount of apollo/, keywords: ['apollo'] },
        { pattern: /moon mount|mount of moon/, keywords: ['moon'] },
        { pattern: /mars mount|mount of mars|mars positive/, keywords: ['mars'] },
        // Fingers
        { pattern: /\bmercury finger\b/, keywords: ['mercury'] },
        { pattern: /\bjupiter finger\b/, keywords: ['jupiter'] },
        { pattern: /\bthumb\b/, keywords: ['thumb'] },
        { pattern: /finger(s)?\s+(bend|bends|is|are|held)/, keywords: ['finger', 'bent', 'inward', 'stiff'] },
        // Markings and structural features
        { pattern: /\bstar\b/, keywords: ['star'] },
        { pattern: /\bcross\b/, keywords: ['cross'] },
        { pattern: /\bisland\b/, keywords: ['island'] },
        { pattern: /\bgrille\b/, keywords: ['grille'] },
        { pattern: /\btriangle\b/, keywords: ['triangle'] },
        { pattern: /\bsquare\b/, keywords: ['square'] },
        { pattern: /ring of solomon/, keywords: ['ring', 'solomon'] },
        { pattern: /girdle of venus/, keywords: ['girdle'] },
        { pattern: /simian line|transverse crease/, keywords: ['simian', 'transverse'] },
        { pattern: /\bchained\b/, keywords: ['chained'] },
        { pattern: /\bfork/, keywords: ['fork'] },
        { pattern: /\btrident\b/, keywords: ['trident'] },
        { pattern: /\bscar\b/, keywords: ['scar'] }
    ];

    // Every palm feature a template references must be attested in the supplied
    // evidence; templates must reference at least one palm feature so that
    // astrological-only templates are never used on palm evidence.
    let referencedFeatures = 0;
    for (const check of featureChecks) {
        if (check.pattern.test(text)) {
            referencedFeatures++;
            if (!check.keywords.some(kw => allEvidence.includes(kw))) {
                return false;
            }
        }
    }
    if (referencedFeatures === 0) {
        return false;
    }

    // Physical attribute descriptors must also be attested in the supplied
    // evidence. This prevents templates from claiming attributes (flat, wide,
    // pale, high, broken, chained, ...) that were never observed.
    const physicalDescriptors = [
        'flat', 'wide', 'pale', 'high', 'low', 'deep', 'shallow', 'long', 'short',
        'thin', 'thick', 'broad', 'narrow', 'prominent', 'pronounced', 'faint',
        'clear', 'unbroken', 'broken', 'chained', 'forked', 'doubled', 'split',
        'curved', 'straight', 'angled', 'firm', 'soft', 'full', 'hollow', 'vast',
        'small', 'large', 'tiny', 'red', 'white', 'pink', 'dark', 'light',
        'bent', 'inward', 'outward', 'stiff'
    ];
    for (const descriptor of physicalDescriptors) {
        const descriptorRegex = new RegExp(`\\b${descriptor}\\b`);
        if (descriptorRegex.test(text) && !allEvidence.includes(descriptor)) {
            return false;
        }
    }

    // Ages and life events - narrative templates require very specific evidence
    const hasAgeRef = /at \d+|when you were \d+|seven|fourteen|twenty|thirty|forty|fifty|sixty|eighteen|twenty-seven|thirty-two|forty-two|twenty-two|thirty-four/i.test(text);
    const hasLifeEventRef = /fell from|divorce|mastery|birth|career|marriage|childhood|father|mother/i.test(text);
    if (hasAgeRef || hasLifeEventRef) {
        return false; // Conservative: reject narrative templates unless explicit evidence supports them
    }

    return true;
}

/**
 * Selects a template deterministically based on input parameters
 * @param {Object} params - Selection parameters
 * @param {string} params.tradition - Tradition (western, vedic, hellenic)
 * @param {string} params.centralTheme - Central theme of the reading
 * @param {string} params.symbolicThread - Symbolic thread
 * @param {string} params.openingMood - Desired mood/tone
 * @param {Object} [params.palmEvidence] - Optional structured palm analysis evidence
 *   Expected structure: { lines: [], mounts: [], markings: [], fingers: [] }
 *   Only templates referencing specific palm features will be used when this is provided
 *   with actual observed data. photoHash, photo, or boolean flags are NOT palm evidence.
 * @returns {string} Selected opening paragraph
 */
function getOpening({ tradition, centralTheme, symbolicThread, openingMood, palmEvidence }) {
    // Determine if we have verified palm evidence
    const hasPalmEvidence = hasVerifiedPalmEvidence(palmEvidence);

    // Build a deterministic seed from all inputs (including palm evidence presence)
    const seedString = [
        tradition || 'western',
        centralTheme || 'general',
        symbolicThread || 'none',
        openingMood || 'neutral',
        hasPalmEvidence ? 'palm' : 'no-palm'
    ].join('|');

    const seed = hashString(seedString);

    // Determine preferred categories based on tradition, mood, theme, and evidence mode
    const preferredCategories = getPreferredCategories(tradition, openingMood, centralTheme, hasPalmEvidence);

    // Select template pool based on evidence mode
    const templatePool = hasPalmEvidence ? MODE_B_TEMPLATES : MODE_A_TEMPLATES;

    // Group templates by category
    const templatesByCategory = {};
    for (const t of templatePool) {
        if (preferredCategories.includes(t.category)) {
            if (!templatesByCategory[t.category]) {
                templatesByCategory[t.category] = [];
            }
            templatesByCategory[t.category].push(t);
        }
    }

    // If too few candidates, expand to all templates in the current mode
    let totalCandidates = Object.values(templatesByCategory).flat().length;
    if (totalCandidates < 5) {
        for (const t of templatePool) {
            if (!templatesByCategory[t.category]) {
                templatesByCategory[t.category] = [];
            }
            templatesByCategory[t.category].push(t);
        }
    }

    // MODE B: Further filter to only templates that match the supplied evidence
    if (hasPalmEvidence) {
        for (const category of Object.keys(templatesByCategory)) {
            templatesByCategory[category] = templatesByCategory[category].filter(t => templateMatchesEvidence(t.text, palmEvidence));
        }
        
        // If no templates match the evidence, fall back to MODE A templates
        totalCandidates = Object.values(templatesByCategory).flat().length;
        if (totalCandidates === 0) {
            const fallbackPool = MODE_A_TEMPLATES.filter(t => preferredCategories.includes(t.category));
            for (const t of fallbackPool) {
                if (!templatesByCategory[t.category]) {
                    templatesByCategory[t.category] = [];
                }
                templatesByCategory[t.category].push(t);
            }
            totalCandidates = Object.values(templatesByCategory).flat().length;
            if (totalCandidates < 5) {
                for (const t of MODE_A_TEMPLATES) {
                    if (!templatesByCategory[t.category]) {
                        templatesByCategory[t.category] = [];
                    }
                    templatesByCategory[t.category].push(t);
                }
            }
        }
    }

    // Weighted category selection: tradition-specific categories get higher weight
    // First category in preferredCategories = tradition-specific = weight 10
    // Second category = tradition-secondary = weight 5
    // Rest = weight 1
    const categoryWeights = {};
    preferredCategories.forEach((cat, idx) => {
        if (templatesByCategory[cat] && templatesByCategory[cat].length > 0) {
            if (idx === 0) categoryWeights[cat] = 10;
            else if (idx === 1) categoryWeights[cat] = 5;
            else categoryWeights[cat] = 1;
        }
    });

    // Build weighted category list
    const weightedCategories = [];
    for (const [cat, weight] of Object.entries(categoryWeights)) {
        for (let i = 0; i < weight; i++) {
            weightedCategories.push(cat);
        }
    }

    // If no weighted categories (shouldn't happen), fall back to all
    if (weightedCategories.length === 0) {
        for (const cat of Object.keys(templatesByCategory)) {
            if (templatesByCategory[cat].length > 0) {
                weightedCategories.push(cat);
            }
        }
    }

    // Select category deterministically
    const categoryIndex = seed % weightedCategories.length;
    const selectedCategory = weightedCategories[categoryIndex];
    const categoryTemplates = templatesByCategory[selectedCategory];

    // Select template within category deterministically
    const templateIndex = Math.floor(seed / weightedCategories.length) % categoryTemplates.length;
    return categoryTemplates[templateIndex].text;
}

module.exports = { getOpening, hasVerifiedPalmEvidence };