/**
 * Humanity Detector - Deterministic AI Writing Pattern Detection
 *
 * WHY THIS EXISTS:
 * AI-generated text exhibits statistical regularities that human writing naturally avoids.
 * Large language models optimize for probability, producing text with:
 * - Uniform sentence/paragraph lengths (low burstiness)
 * - Repetitive transition words (however, moreover, furthermore)
 * - Formulaic openings ("You are...", "Your energy...", "In this reading...")
 * - Excessive hedging ("may", "might", "could", "tends to")
 * - Therapy/corporate speak ("journey", "embrace", "navigate", "align")
 * - Generic mystical filler ("cosmic dance", "celestial tapestry", "universe whispers")
 *
 * WHY DETERMINISTIC DETECTION MATTERS:
 * Probabilistic AI classifiers are themselves black boxes - they can be fooled,
 * drift over time, and require retraining. Deterministic rules are:
 * - 100% reproducible (same input = same output)
 * - Auditable (every flag has a clear, explainable cause)
 * - Zero latency (no API calls, no model inference)
 * - Free to run at scale
 *
 * HOW THIS IMPROVES PALMPYAAR QUALITY:
 * The detector runs after each rewrite cycle. If AI patterns are detected,
 * the rewrite prompt is adjusted to explicitly avoid those patterns.
 * This creates a negative feedback loop that pushes output toward human-like
 * variability, specificity, and voice - the hallmarks of premium editorial content.
 *
 * @module providers/humanityDetector
 */

// Transition words that AI overuses
const AI_TRANSITIONS = [
    'however', 'moreover', 'furthermore', 'therefore', 'meanwhile',
    'in addition', 'additionally', 'consequently', 'nevertheless',
    'nonetheless', 'accordingly', 'subsequently', 'hence', 'thus'
];

// Formulaic second-person openings AI favors
const AI_OPENINGS = [
    'you are', 'you often', 'you may', 'you might', 'you could',
    'your nature', 'your energy', 'your path', 'your journey',
    'your soul', 'your spirit', 'your heart', 'your mind'
];

// Therapy/corporate language markers
const THERAPY_CORPORATE = [
    'journey', 'embrace', 'navigate', 'align', 'resonate', 'manifest',
    'transform', 'evolve', 'growth', 'healing', 'empower', 'authentic',
    'vulnerability', 'mindfulness', 'intentional', 'holistic', 'wellness',
    'self-discovery', 'inner work', 'holding space', 'show up', 'lean in'
];

// Generic mystical/horoscope filler
const MYSTICAL_CLICHES = [
    'cosmic dance', 'celestial tapestry', 'universe whispers', 'stars align',
    'divine timing', 'soul contract', 'karmic lesson', 'spiritual awakening',
    'higher self', 'universal energy', 'cosmic blueprint', 'destiny unfolds',
    'the universe has a plan', 'trust the process', 'everything happens for a reason',
    'mercury retrograde', 'full moon energy', 'new beginnings', 'closure'
];

// AI hedging phrases
const HEDGING_PHRASES = [
    'tends to', 'may indicate', 'could suggest', 'might reflect',
    'often signifies', 'typically represents', 'generally points to',
    'is associated with', 'can symbolize', 'may represent'
];

// Repeated symbolism/metaphors AI recycles
const RECYCLED_SYMBOLISM = [
    'tapestry', 'canvas', 'mirror', 'compass', 'anchor', 'beacon',
    'lighthouse', 'bridge', 'doorway', 'threshold', 'crossroads',
    'path', 'journey', 'river', 'ocean', 'mountain', 'horizon',
    'dawn', 'twilight', 'seasons', 'cycles', 'ebbs and flows'
];

/**
 * Strips HTML tags from text
 * @param {string} html - HTML string
 * @returns {string} Plain text
 */
function stripHTML(html) {
    return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Splits text into sentences
 * @param {string} text - Plain text
 * @returns {string[]} Array of sentences
 */
function splitSentences(text) {
    // Simple sentence splitter - handles . ! ? followed by space + capital
    return text
        .split(/(?<=[.!?])\s+(?=[A-Z])/)
        .map(s => s.trim())
        .filter(s => s.length > 0);
}

/**
 * Splits text into paragraphs
 * @param {string} text - Plain text (with \n\n or <p> markers)
 * @returns {string[]} Array of paragraphs
 */
function splitParagraphs(text) {
    return text
        .split(/\n\s*\n|<p[^>]*>|<\/p>/gi)
        .map(p => p.trim())
        .filter(p => p.length > 0);
}

/**
 * Counts occurrences of phrases (case-insensitive)
 * @param {string} text - Text to search
 * @param {string[]} phrases - Phrases to count
 * @returns {Object} Counts per phrase
 */
function countPhrases(text, phrases) {
    const lower = text.toLowerCase();
    const counts = {};
    for (const phrase of phrases) {
        const regex = new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        counts[phrase] = (lower.match(regex) || []).length;
    }
    return counts;
}

/**
 * Analyzes paragraph opening patterns
 * @param {string[]} paragraphs - Array of paragraph texts
 * @returns {Object} Analysis results
 */
function analyzeParagraphOpenings(paragraphs) {
    const openings = paragraphs.map(p => {
        const words = p.trim().split(/\s+/).slice(0, 4).join(' ').toLowerCase();
        return words.replace(/[^a-z\s]/g, '');
    });

    const counts = {};
    for (const opening of openings) {
        counts[opening] = (counts[opening] || 0) + 1;
    }

    const repeated = Object.entries(counts)
        .filter(([, count]) => count > 1)
        .map(([opening, count]) => ({ opening, count }));

    return {
        totalParagraphs: paragraphs.length,
        uniqueOpenings: Object.keys(counts).length,
        repeatedOpenings: repeated.length,
        details: repeated
    };
}

/**
 * Analyzes sentence opening patterns
 * @param {string[]} sentences - Array of sentences
 * @returns {Object} Analysis results
 */
function analyzeSentenceOpenings(sentences) {
    const openings = sentences.map(s => {
        const words = s.trim().split(/\s+/).slice(0, 3).join(' ').toLowerCase();
        return words.replace(/[^a-z\s]/g, '');
    });

    const counts = {};
    for (const opening of openings) {
        counts[opening] = (counts[opening] || 0) + 1;
    }

    const repeated = Object.entries(counts)
        .filter(([, count]) => count > 1)
        .map(([opening, count]) => ({ opening, count }));

    return {
        totalSentences: sentences.length,
        uniqueOpenings: Object.keys(counts).length,
        repeatedOpenings: repeated.length,
        details: repeated
    };
}

/**
 * Analyzes sentence length rhythm (burstiness)
 * @param {string[]} sentences - Array of sentences
 * @returns {Object} Rhythm metrics
 */
function analyzeSentenceRhythm(sentences) {
    const lengths = sentences.map(s => s.split(/\s+/).length);
    if (lengths.length === 0) return { average: 0, variance: 0, rhythmScore: 0 };

    const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    const variance = lengths.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / lengths.length;
    const stdDev = Math.sqrt(variance);

    // Coefficient of variation - higher = more human-like burstiness
    const cv = avg > 0 ? stdDev / avg : 0;

    // Score: 0-10, higher = more human-like
    // Human writing typically has CV > 0.4, AI often < 0.3
    const rhythmScore = Math.min(10, Math.max(0, cv * 20));

    return {
        averageSentenceLength: Math.round(avg * 10) / 10,
        sentenceLengthVariance: Math.round(variance * 10) / 10,
        coefficientOfVariation: Math.round(cv * 100) / 100,
        rhythmScore: Math.round(rhythmScore * 10) / 10
    };
}

/**
 * Analyzes paragraph length rhythm
 * @param {string[]} paragraphs - Array of paragraphs
 * @returns {Object} Rhythm metrics
 */
function analyzeParagraphRhythm(paragraphs) {
    const lengths = paragraphs.map(p => p.split(/\s+/).length);
    if (lengths.length === 0) return { average: 0, variance: 0, rhythmScore: 0 };

    const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    const variance = lengths.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / lengths.length;
    const stdDev = Math.sqrt(variance);
    const cv = avg > 0 ? stdDev / avg : 0;

    const rhythmScore = Math.min(10, Math.max(0, cv * 15));

    return {
        averageParagraphLength: Math.round(avg * 10) / 10,
        paragraphLengthVariance: Math.round(variance * 10) / 10,
        coefficientOfVariation: Math.round(cv * 100) / 100,
        rhythmScore: Math.round(rhythmScore * 10) / 10
    };
}

/**
 * Calculates vocabulary variety (type-token ratio)
 * @param {string} text - Full text
 * @returns {Object} Variety metrics
 */
function analyzeVocabularyVariety(text) {
    const words = text.toLowerCase()
        .replace(/[^a-z\s']/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2);

    if (words.length === 0) return { uniqueWords: 0, totalWords: 0, typeTokenRatio: 0, varietyScore: 0 };

    const unique = new Set(words);
    const ttr = unique.size / words.length;

    // Score: 0-10, higher = more variety
    // Human writing typically TTR > 0.5, AI often lower
    const varietyScore = Math.min(10, Math.max(0, ttr * 18));

    return {
        uniqueWords: unique.size,
        totalWords: words.length,
        typeTokenRatio: Math.round(ttr * 1000) / 1000,
        varietyScore: Math.round(varietyScore * 10) / 10
    };
}

/**
 * Analyzes adjective density
 * @param {string} text - Full text
 * @returns {Object} Adjective metrics
 */
function analyzeAdjectiveDensity(text) {
    // Simple heuristic: words ending in -ive, -ous, -ful, -al, -ic, -able, -ible, -ent, -ant
    // plus common adjectives
    const adjectiveEndings = ['ive', 'ous', 'ful', 'al', 'ic', 'able', 'ible', 'ent', 'ant', 'less', 'ish'];
    const words = text.toLowerCase().replace(/[^a-z\s']/g, ' ').split(/\s+/).filter(w => w.length > 3);

    let adjectiveCount = 0;
    for (const word of words) {
        for (const ending of adjectiveEndings) {
            if (word.endsWith(ending) && word.length > ending.length + 2) {
                adjectiveCount++;
                break;
            }
        }
    }

    const density = words.length > 0 ? adjectiveCount / words.length : 0;
    // Score: 0-10, lower density = more human (AI tends to over-adjectivize)
    // Optimal around 0.05-0.08, AI often > 0.12
    const densityScore = density <= 0.08 ? 10 : Math.max(0, 10 - (density - 0.08) * 100);

    return {
        adjectiveCount,
        totalWords: words.length,
        adjectiveDensity: Math.round(density * 1000) / 1000,
        densityScore: Math.round(densityScore * 10) / 10
    };
}

/**
 * Estimates passive voice usage
 * @param {string[]} sentences - Array of sentences
 * @returns {Object} Passive voice metrics
 */
function analyzePassiveVoice(sentences) {
    let passiveCount = 0;
    const passivePatterns = [
        /\b(was|were|been|being|is|are|am)\s+\w+ed\b/gi,
        /\b(was|were|been|being|is|are|am)\s+\w+en\b/gi
    ];

    for (const sentence of sentences) {
        for (const pattern of passivePatterns) {
            if (pattern.test(sentence)) {
                passiveCount++;
                break;
            }
        }
    }

    const rate = sentences.length > 0 ? passiveCount / sentences.length : 0;
    // Score: 0-10, lower passive = more human
    const passiveScore = Math.max(0, 10 - rate * 50);

    return {
        passiveCount,
        totalSentences: sentences.length,
        passiveRate: Math.round(rate * 1000) / 1000,
        passiveScore: Math.round(passiveScore * 10) / 10
    };
}

/**
 * Counts commas per sentence
 * @param {string[]} sentences - Array of sentences
 * @returns {Object} Comma metrics
 */
function analyzeCommaUsage(sentences) {
    let totalCommas = 0;
    for (const sentence of sentences) {
        totalCommas += (sentence.match(/,/g) || []).length;
    }

    const avgCommas = sentences.length > 0 ? totalCommas / sentences.length : 0;
    // Score: 0-10, moderate commas = human, too many = AI
    const commaScore = avgCommas <= 2 ? 10 : Math.max(0, 10 - (avgCommas - 2) * 2);

    return {
        totalCommas,
        averageCommasPerSentence: Math.round(avgCommas * 10) / 10,
        commaScore: Math.round(commaScore * 10) / 10
    };
}

/**
 * Main analysis function
 * @param {Object} params - Analysis parameters
 * @param {Object} params.reading - Reading object with core, love, pro sections (HTML)
 * @param {string} params.tradition - Tradition (western, vedic, hellenic)
 * @param {Object} params.reasoningPlan - Reasoning plan (unused but kept for interface)
 * @returns {Object} Humanity analysis results
 */
function analyzeHumanity({ reading, tradition, reasoningPlan }) {
    const issues = [];
    const allText = [
        stripHTML(reading.core || ''),
        stripHTML(reading.love || ''),
        stripHTML(reading.pro || '')
    ].join(' ');

    const paragraphs = splitParagraphs(allText);
    const sentences = splitSentences(allText);

    // 1. Repeated paragraph openings
    const paraOpenings = analyzeParagraphOpenings(paragraphs);
    if (paraOpenings.repeatedOpenings > 0) {
        issues.push({
            type: 'repeated_paragraph_openings',
            severity: paraOpenings.repeatedOpenings > 2 ? 'high' : 'medium',
            description: `${paraOpenings.repeatedOpenings} paragraph opening pattern(s) repeated`,
            section: 'all',
            details: paraOpenings.details
        });
    }

    // 2. Repeated sentence openings
    const sentOpenings = analyzeSentenceOpenings(sentences);
    if (sentOpenings.repeatedOpenings > 2) {
        issues.push({
            type: 'repeated_sentence_openings',
            severity: sentOpenings.repeatedOpenings > 5 ? 'high' : 'medium',
            description: `${sentOpenings.repeatedOpenings} sentence opening pattern(s) repeated`,
            section: 'all',
            details: sentOpenings.details
        });
    }

    // 3. AI transition words
    const transitionCounts = countPhrases(allText, AI_TRANSITIONS);
    const totalTransitions = Object.values(transitionCounts).reduce((a, b) => a + b, 0);
    const transitionRate = sentences.length > 0 ? totalTransitions / sentences.length : 0;
    if (transitionRate > 0.15) {
        issues.push({
            type: 'excessive_transitions',
            severity: transitionRate > 0.3 ? 'high' : 'medium',
            description: `High transition word density (${Math.round(transitionRate * 100)}% of sentences)`,
            section: 'all',
            details: transitionCounts
        });
    }

    // 4. AI openings (you are, your energy, etc.)
    const openingCounts = countPhrases(allText, AI_OPENINGS);
    const totalOpenings = Object.values(openingCounts).reduce((a, b) => a + b, 0);
    if (totalOpenings > 3) {
        issues.push({
            type: 'formulaic_second_person',
            severity: totalOpenings > 6 ? 'high' : 'medium',
            description: `${totalOpenings} formulaic second-person openings detected`,
            section: 'all',
            details: openingCounts
        });
    }

    // 5. Therapy/corporate language
    const therapyCounts = countPhrases(allText, THERAPY_CORPORATE);
    const totalTherapy = Object.values(therapyCounts).reduce((a, b) => a + b, 0);
    if (totalTherapy > 2) {
        issues.push({
            type: 'therapy_corporate_language',
            severity: totalTherapy > 5 ? 'high' : 'medium',
            description: `${totalTherapy} therapy/corporate buzzwords detected`,
            section: 'all',
            details: therapyCounts
        });
    }

    // 6. Mystical clichés
    const clicheCounts = countPhrases(allText, MYSTICAL_CLICHES);
    const totalCliches = Object.values(clicheCounts).reduce((a, b) => a + b, 0);
    if (totalCliches > 0) {
        issues.push({
            type: 'mystical_cliches',
            severity: totalCliches > 2 ? 'high' : 'medium',
            description: `${totalCliches} generic mystical/horoscope phrases detected`,
            section: 'all',
            details: clicheCounts
        });
    }

    // 7. AI hedging
    const hedgingCounts = countPhrases(allText, HEDGING_PHRASES);
    const totalHedging = Object.values(hedgingCounts).reduce((a, b) => a + b, 0);
    if (totalHedging > 2) {
        issues.push({
            type: 'excessive_hedging',
            severity: totalHedging > 5 ? 'high' : 'medium',
            description: `${totalHedging} hedging phrases detected`,
            section: 'all',
            details: hedgingCounts
        });
    }

    // 8. Recycled symbolism
    const symbolCounts = countPhrases(allText, RECYCLED_SYMBOLISM);
    const totalSymbols = Object.values(symbolCounts).reduce((a, b) => a + b, 0);
    if (totalSymbols > 4) {
        issues.push({
            type: 'recycled_symbolism',
            severity: totalSymbols > 8 ? 'high' : 'medium',
            description: `${totalSymbols} recycled metaphorical symbols detected`,
            section: 'all',
            details: symbolCounts
        });
    }

    // 9. Sentence rhythm analysis
    const sentenceRhythm = analyzeSentenceRhythm(sentences);
    if (sentenceRhythm.rhythmScore < 4) {
        issues.push({
            type: 'uniform_sentence_length',
            severity: sentenceRhythm.rhythmScore < 2 ? 'high' : 'medium',
            description: `Low sentence length variability (CV: ${sentenceRhythm.coefficientOfVariation})`,
            section: 'all'
        });
    }

    // 10. Paragraph rhythm analysis
    const paragraphRhythm = analyzeParagraphRhythm(paragraphs);
    if (paragraphRhythm.rhythmScore < 3 && paragraphs.length > 3) {
        issues.push({
            type: 'uniform_paragraph_length',
            severity: paragraphRhythm.rhythmScore < 1.5 ? 'high' : 'medium',
            description: `Low paragraph length variability (CV: ${paragraphRhythm.coefficientOfVariation})`,
            section: 'all'
        });
    }

    // 11. Vocabulary variety
    const vocabulary = analyzeVocabularyVariety(allText);
    if (vocabulary.varietyScore < 5) {
        issues.push({
            type: 'low_vocabulary_variety',
            severity: vocabulary.varietyScore < 3 ? 'high' : 'medium',
            description: `Low type-token ratio (${vocabulary.typeTokenRatio})`,
            section: 'all'
        });
    }

    // 12. Adjective density
    const adjectives = analyzeAdjectiveDensity(allText);
    if (adjectives.densityScore < 5) {
        issues.push({
            type: 'excessive_adjectives',
            severity: adjectives.densityScore < 3 ? 'high' : 'medium',
            description: `High adjective density (${adjectives.adjectiveDensity})`,
            section: 'all'
        });
    }

    // 13. Passive voice
    const passive = analyzePassiveVoice(sentences);
    if (passive.passiveScore < 5) {
        issues.push({
            type: 'excessive_passive_voice',
            severity: passive.passiveScore < 3 ? 'high' : 'medium',
            description: `High passive voice rate (${Math.round(passive.passiveRate * 100)}%)`,
            section: 'all'
        });
    }

    // 14. Comma usage
    const commas = analyzeCommaUsage(sentences);
    if (commas.commaScore < 5) {
        issues.push({
            type: 'excessive_commas',
            severity: commas.commaScore < 3 ? 'high' : 'medium',
            description: `High comma density (${commas.averageCommasPerSentence} per sentence)`,
            section: 'all'
        });
    }

    // Compute humanScore (0-10)
    // Start at 10, deduct for each issue
    let humanScore = 10;
    for (const issue of issues) {
        const deduction = issue.severity === 'high' ? 1.5 : issue.severity === 'medium' ? 0.8 : 0.3;
        humanScore -= deduction;
    }
    humanScore = Math.max(0, Math.min(10, Math.round(humanScore * 10) / 10));

    // Determine risk level
    const highCount = issues.filter(i => i.severity === 'high').length;
    const mediumCount = issues.filter(i => i.severity === 'medium').length;
    let riskLevel = 'low';
    if (highCount > 0 || mediumCount > 3) riskLevel = 'high';
    else if (mediumCount > 0 || issues.length > 2) riskLevel = 'medium';

    // Generate recommendations
    const recommendations = [];
    if (issues.some(i => i.type === 'repeated_paragraph_openings' || i.type === 'repeated_sentence_openings')) {
        recommendations.push('Vary paragraph and sentence openings; avoid formulaic starts');
    }
    if (issues.some(i => i.type === 'excessive_transitions')) {
        recommendations.push('Reduce transition words (however, moreover, furthermore); use implicit flow');
    }
    if (issues.some(i => i.type === 'formulaic_second_person')) {
        recommendations.push('Limit "you are/your energy" openings; use direct observation instead');
    }
    if (issues.some(i => i.type === 'therapy_corporate_language')) {
        recommendations.push('Replace therapy/corporate buzzwords with concrete, specific imagery');
    }
    if (issues.some(i => i.type === 'mystical_cliches')) {
        recommendations.push('Remove generic mystical phrases; ground insights in tradition-specific symbolism');
    }
    if (issues.some(i => i.type === 'excessive_hedging')) {
        recommendations.push('Reduce hedging (may, might, tends to); state interpretations with calibrated confidence');
    }
    if (issues.some(i => i.type === 'recycled_symbolism')) {
        recommendations.push('Diversify metaphorical vocabulary; avoid overused symbols (tapestry, journey, mirror)');
    }
    if (issues.some(i => i.type === 'uniform_sentence_length')) {
        recommendations.push('Vary sentence length dramatically; mix short punchy sentences with longer complex ones');
    }
    if (issues.some(i => i.type === 'uniform_paragraph_length')) {
        recommendations.push('Vary paragraph length; use single-sentence paragraphs for emphasis');
    }
    if (issues.some(i => i.type === 'low_vocabulary_variety')) {
        recommendations.push('Expand vocabulary; avoid repeating the same descriptive words');
    }
    if (issues.some(i => i.type === 'excessive_adjectives')) {
        recommendations.push('Cut adjective count; prefer strong verbs and precise nouns');
    }
    if (issues.some(i => i.type === 'excessive_passive_voice')) {
        recommendations.push('Convert passive to active voice; assign agency to planetary/archetypal forces');
    }
    if (issues.some(i => i.type === 'excessive_commas')) {
        recommendations.push('Break comma-heavy sentences; use periods, dashes, or semicolons for rhythm');
    }

    if (recommendations.length === 0) {
        recommendations.push('Writing shows strong human characteristics; maintain current voice');
    }

    return {
        humanScore,
        riskLevel,
        issues,
        metrics: {
            repeatedOpenings: paraOpenings.repeatedOpenings,
            repeatedTransitions: totalTransitions,
            sentenceRhythm: sentenceRhythm.rhythmScore,
            paragraphRhythm: paragraphRhythm.rhythmScore,
            averageSentenceLength: sentenceRhythm.averageSentenceLength,
            averageParagraphLength: paragraphRhythm.averageParagraphLength,
            vocabularyVariety: vocabulary.varietyScore,
            adjectiveDensity: adjectives.densityScore,
            passiveVoiceEstimate: passive.passiveScore,
            clicheCount: totalCliches
        },
        recommendations
    };
}

module.exports = { analyzeHumanity };