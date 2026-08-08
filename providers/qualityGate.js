/**
 * Quality Gate - Final Validation Layer for PalmPyaar Readings
 *
 * WHY THIS EXISTS:
 * The Quality Gate is the final deterministic checkpoint before a reading reaches the user.
 * It ensures that only readings meeting strict quality thresholds are delivered, regardless
 * of how many AI rewrite cycles have occurred. This prevents low-quality output from
 * slipping through due to model hallucination, prompt drift, or edge cases.
 *
 * WHY REWRITE LIMITS MATTER:
 * Unlimited rewrites create three critical problems:
 * 1. Cost explosion - Each rewrite consumes additional API tokens and latency
 * 2. Quality degradation - Models can "over-optimize" into generic, soulless text
 * 3. Infinite loops - Edge cases where the model never satisfies criteria
 * A hard limit of 3 rewrites balances quality improvement with operational safety.
 *
 * WHY DETERMINISTIC VALIDATION AFTER REWRITING:
 * AI reviews are probabilistic - they can miss structural issues or hallucinate scores.
 * Deterministic checks (structure, HTML validity, section presence) are 100% reliable
 * and catch issues AI reviewers cannot consistently detect. Running these AFTER rewriting
 * ensures the final output is structurally sound before the gate makes its accept/reject
 * decision based on the deterministic overall score.
 *
 * @module providers/qualityGate
 */

/**
 * Validates HTML structure - checks for basic well-formedness
 * @param {string} html - HTML string to validate
 * @returns {boolean} - True if HTML appears well-formed
 */
function isValidHTML(html) {
    if (!html || typeof html !== 'string') return false;
    if (html.trim().length === 0) return false;

    // Basic checks: no unclosed tags that would break rendering
    // Count opening vs closing tags for common elements
    const tagsToCheck = ['p', 'div', 'span', 'strong', 'em', 'blockquote', 'h3', 'h4'];
    for (const tag of tagsToCheck) {
        const openRegex = new RegExp(`<${tag}[^>]*>`, 'gi');
        const closeRegex = new RegExp(`</${tag}>`, 'gi');
        const opens = (html.match(openRegex) || []).length;
        const closes = (html.match(closeRegex) || []).length;
        if (opens !== closes) return false;
    }

    // Must not contain script tags (XSS prevention)
    if (/<script\b/gi.test(html)) return false;

    return true;
}

/**
 * Checks if AI review contains an OVERALL VERDICT section
 * @param {Object} aiReview - The AI review object
 * @returns {boolean} - True if OVERALL VERDICT exists
 */
function hasOverallVerdict(aiReview) {
    if (!aiReview || typeof aiReview !== 'object') return false;
    if (!aiReview.overallVerdict && !aiReview.overall_verdict) return false;
    const verdict = aiReview.overallVerdict || aiReview.overall_verdict;
    return typeof verdict === 'string' && verdict.trim().length > 0;
}

/**
 * Validates deterministic review structure
 * @param {Object} deterministicReview - The deterministic review object
 * @returns {boolean} - True if valid
 */
function isValidDeterministicReview(deterministicReview) {
    if (!deterministicReview || typeof deterministicReview !== 'object') return false;
    if (typeof deterministicReview.overallScore !== 'number') return false;
    if (deterministicReview.overallScore < 0 || deterministicReview.overallScore > 10) return false;
    return true;
}

/**
 * Validates rewrite count
 * @param {number} rewriteCount - Number of rewrites performed
 * @returns {boolean} - True if valid
 */
function isValidRewriteCount(rewriteCount) {
    return Number.isInteger(rewriteCount) && rewriteCount >= 0;
}

/**
 * Validates all three reading sections exist and are non-empty
 * @param {Object} reading - The rewritten reading object
 * @returns {Object} - { valid: boolean, missing: string[], empty: string[] }
 */
function validateReadingSections(reading) {
    const requiredSections = ['core', 'love', 'pro'];
    const missing = [];
    const empty = [];

    for (const section of requiredSections) {
        if (!reading || !reading[section]) {
            missing.push(section.toUpperCase());
        } else if (typeof reading[section] !== 'string' || reading[section].trim().length === 0) {
            empty.push(section.toUpperCase());
        }
    }

    return {
        valid: missing.length === 0 && empty.length === 0,
        missing,
        empty
    };
}

/**
 * Validates HTML in all reading sections
 * @param {Object} reading - The rewritten reading object
 * @returns {Object} - { valid: boolean, invalidSections: string[] }
 */
function validateReadingHTML(reading) {
    const sections = ['core', 'love', 'pro'];
    const invalidSections = [];

    for (const section of sections) {
        if (reading[section] && !isValidHTML(reading[section])) {
            invalidSections.push(section.toUpperCase());
        }
    }

    return {
        valid: invalidSections.length === 0,
        invalidSections
    };
}

/**
 * Evaluates the Quality Gate for a rewritten reading.
 *
 * @param {Object} params - Evaluation parameters
 * @param {Object} params.deterministicReview - Deterministic review result with overallScore
 * @param {Object} params.aiReview - AI review result (must contain OVERALL VERDICT)
 * @param {Object} params.rewrittenReading - The rewritten reading { core, love, pro }
 * @param {number} params.rewriteCount - Number of rewrite cycles completed (0 = first pass)
 * @returns {Object} Quality gate decision
 * @returns {boolean} returns.accepted - Whether the reading passes the gate
 * @returns {"accept"|"rewrite"|"reject"} returns.decision - Gate decision
 * @returns {number} returns.overallScore - Deterministic overall score (0-10)
 * @returns {string[]} returns.reasons - Human-readable reasons for the decision
 * @returns {string} returns.nextAction - What should happen next
 * @returns {boolean} returns.maxRewritesReached - Whether rewrite limit (3) has been hit
 */
function evaluateQualityGate({ deterministicReview, aiReview, rewrittenReading, rewriteCount }) {
    const reasons = [];
    const MAX_REWRITES = 3;
    const ACCEPT_THRESHOLD = 9.0;
    const REJECT_THRESHOLD = 8.5;

    // Input validation
    if (!isValidRewriteCount(rewriteCount)) {
        return {
            accepted: false,
            decision: 'reject',
            overallScore: 0,
            reasons: ['Invalid rewrite count: must be a non-negative integer'],
            nextAction: 'reject',
            maxRewritesReached: false
        };
    }

    if (!isValidDeterministicReview(deterministicReview)) {
        return {
            accepted: false,
            decision: 'reject',
            overallScore: 0,
            reasons: ['Deterministic review missing or invalid: overallScore (0-10) required'],
            nextAction: 'reject',
            maxRewritesReached: rewriteCount >= MAX_REWRITES
        };
    }

    if (!hasOverallVerdict(aiReview)) {
        return {
            accepted: false,
            decision: 'reject',
            overallScore: deterministicReview.overallScore,
            reasons: ['AI review missing OVERALL VERDICT'],
            nextAction: 'reject',
            maxRewritesReached: rewriteCount >= MAX_REWRITES
        };
    }

    // Validate reading structure
    const sectionValidation = validateReadingSections(rewrittenReading);
    if (!sectionValidation.valid) {
        if (sectionValidation.missing.length > 0) {
            reasons.push(`Missing required sections: ${sectionValidation.missing.join(', ')}`);
        }
        if (sectionValidation.empty.length > 0) {
            reasons.push(`Empty sections: ${sectionValidation.empty.join(', ')}`);
        }
        return {
            accepted: false,
            decision: 'reject',
            overallScore: deterministicReview.overallScore,
            reasons,
            nextAction: 'reject',
            maxRewritesReached: rewriteCount >= MAX_REWRITES
        };
    }

    // Validate HTML well-formedness
    const htmlValidation = validateReadingHTML(rewrittenReading);
    if (!htmlValidation.valid) {
        reasons.push(`Malformed HTML in sections: ${htmlValidation.invalidSections.join(', ')}`);
        return {
            accepted: false,
            decision: 'reject',
            overallScore: deterministicReview.overallScore,
            reasons,
            nextAction: 'reject',
            maxRewritesReached: rewriteCount >= MAX_REWRITES
        };
    }

    const score = deterministicReview.overallScore;
    const maxRewritesReached = rewriteCount >= MAX_REWRITES;

    // Decision logic
    if (score >= ACCEPT_THRESHOLD) {
        return {
            accepted: true,
            decision: 'accept',
            overallScore: score,
            reasons: [`Deterministic score ${score.toFixed(1)} meets acceptance threshold (>= ${ACCEPT_THRESHOLD})`],
            nextAction: 'deliver',
            maxRewritesReached
        };
    }

    if (maxRewritesReached && score < REJECT_THRESHOLD) {
        return {
            accepted: false,
            decision: 'reject',
            overallScore: score,
            reasons: [
                `Maximum rewrites (${MAX_REWRITES}) reached`,
                `Final score ${score.toFixed(1)} below rejection threshold (< ${REJECT_THRESHOLD})`
            ],
            nextAction: 'reject',
            maxRewritesReached: true
        };
    }

    // Request another rewrite
    return {
        accepted: false,
        decision: 'rewrite',
        overallScore: score,
        reasons: [
            `Score ${score.toFixed(1)} below acceptance threshold (>= ${ACCEPT_THRESHOLD})`,
            `Rewrite ${rewriteCount + 1} of ${MAX_REWRITES} requested`
        ],
        nextAction: 'rewrite',
        maxRewritesReached
    };
}

module.exports = { evaluateQualityGate };