/**
 * PalmPyaar Reviewer Prompt Builder — AI Critique Prompt Constructor
 * 
 * ARCHITECTURE POSITION:
 * 
 * Review Engine (deterministic) → Reviewer Prompt Builder → AI Reviewer (future) → Rewrite Loop (Phase 9)
 * 
 * This module DOES NOT call AI. It ONLY constructs the review prompt.
 * 
 * WHY A SEPARATE PROMPT BUILDER:
 * 
 * 1. Separation of Construction from Execution: Building a complex, multi-part prompt with
 *    injected context (reasoning plan, deterministic review, user context, reading) is
 *    non-trivial logic. Isolating it enables testing, versioning, and prompt engineering
 *    without touching the AI caller.
 * 
 * 2. Deterministic Prompt Generation: Same inputs → same prompt. This allows caching,
 *    regression testing of prompt structure, and audit trails of what was sent to the AI.
 * 
 * 3. Single Source of Truth for Reviewer Persona: The "senior literary editor" persona,
 *    constraints, and output format are defined in ONE place. No drift across call sites.
 * 
 * 4. Future-Proofing: When the AI reviewer evolves (different model, different parameters),
 *    only the caller changes. The prompt construction remains stable.
 * 
 * @module providers/reviewerPromptBuilder
 */

/**
 * Builds the complete prompt for the AI Reviewer.
 * 
 * PURE FUNCTION: No side effects, no I/O, no AI calls, no randomness.
 * Same inputs → same prompt string. Suitable for testing, caching, and audit logs.
 * 
 * @param {Object} params - Prompt construction inputs
 * @param {Object} params.reading - Generated reading with core, love, pro sections
 * @param {string} params.reading.core - CORE section text (Recognition stage)
 * @param {string} params.reading.love - LOVE section text (Reflection stage)
 * @param {string} params.reading.pro - PRO section text (Hope → Calm stage)
 * @param {Object} params.reasoningPlan - Structured plan from reasoningPlanner
 * @param {string} params.reasoningPlan.centralTheme - Central narrative theme
 * @param {string[]} params.reasoningPlan.supportingThemes - Supporting themes
 * @param {string} params.reasoningPlan.emotionalDestination - Target emotional state
 * @param {string} params.reasoningPlan.symbolicThread - Symbolic motif
 * @param {string} params.reasoningPlan.coreFocus - CORE section focus
 * @param {string} params.reasoningPlan.loveFocus - LOVE section focus
 * @param {string} params.reasoningPlan.proFocus - PRO section focus
 * @param {string} params.reasoningPlan.openingMood - Opening mood
 * @param {string} params.reasoningPlan.closingMood - Closing mood
 * @param {Object} params.reasoningPlan.callbackStrategy - Callback architecture
 * @param {string} params.reasoningPlan.narrativeFlow - Narrative flow pattern
 * @param {string} params.reasoningPlan.literaryStyle - Literary style descriptor
 * @param {string} params.reasoningPlan.traditionLens - Tradition interpretive lens
 * @param {string} params.tradition - Tradition identifier ('western'|'vedic'|'hellenic')
 * @param {Object} params.reviewReport - Deterministic review from reviewEngine
 * @param {number} params.reviewReport.overallScore - Overall quality score (1-10)
 * @param {Object} params.reviewReport.scores - Individual category scores
 * @param {string[]} params.reviewReport.strengths - Identified strengths
 * @param {string[]} params.reviewReport.weaknesses - Identified weaknesses
 * @param {Object[]} params.reviewReport.rewriteTargets - Actionable rewrite directives
 * @param {boolean} params.reviewReport.passed - Whether reading passed quality gate
 * @param {string} params.reviewReport.reviewSummary - One-paragraph summary
 * @param {Object} params.userContext - Sanitized user context
 * @param {string} params.userContext.name - User's name
 * @param {string} params.userContext.dob - Date of birth
 * @param {string} params.userContext.birthplace - Birth location
 * @param {string} params.userContext.tradition - Tradition
 * @param {boolean} params.userContext.photoHashPresent - Whether palm photo provided
 * @returns {string} Complete reviewer prompt
 */
function buildReviewPrompt({ reading, reasoningPlan, tradition, reviewReport, userContext }) {
    // Input validation
    if (!reading || typeof reading !== 'object') {
        throw new Error('buildReviewPrompt: reading object is required');
    }
    if (!reasoningPlan || typeof reasoningPlan !== 'object') {
        throw new Error('buildReviewPrompt: reasoningPlan object is required');
    }
    if (!tradition || typeof tradition !== 'string') {
        throw new Error('buildReviewPrompt: tradition string is required');
    }
    if (!reviewReport || typeof reviewReport !== 'object') {
        throw new Error('buildReviewPrompt: reviewReport object is required');
    }
    if (!userContext || typeof userContext !== 'object') {
        throw new Error('buildReviewPrompt: userContext object is required');
    }

    const { core, love, pro } = reading;

    // Build each section of the prompt
    const sections = [
        buildPersonaSection(),
        buildContextSection({ userContext, tradition, reasoningPlan }),
        buildReadingSection({ core, love, pro }),
        buildReasoningPlanSection(reasoningPlan),
        buildDeterministicReviewSection(reviewReport),
        buildEvaluationCriteriaSection(tradition),
        buildOutputFormatSection(),
        buildConstraintsSection()
    ];

    return sections.join('\n\n');
}

/**
 * Section 1: Reviewer Persona
 * Defines the AI's role, expertise, and mindset.
 */
function buildPersonaSection() {
    return `You are a senior literary editor with 20+ years of experience reviewing premium astrology writing.

You have edited for the world's most respected astrological publications. You know the difference between writing that merely informs and writing that transforms. You understand that premium astrology writing is not prediction — it is recognition. It holds a mirror to the soul using the language of the stars.

Your standards are exacting. You do not praise lightly. You do not criticize vaguely. Every observation you make is grounded in craft: rhythm, imagery, voice, structure, emotional truth.

You are NOT a co-writer. You are a critic. Your job is to evaluate, not to rewrite.`;
}

/**
 * Section 2: Context
 * User context, tradition, and the reading's intended purpose.
 */
function buildContextSection({ userContext, tradition, reasoningPlan }) {
    const traditionDisplay = tradition.charAt(0).toUpperCase() + tradition.slice(1);
    
    return `===== CONTEXT =====

USER
- Name: ${userContext.name}
- Date of Birth: ${userContext.dob}
- Birthplace: ${userContext.birthplace}
- Tradition: ${traditionDisplay}
- Palm Photo Provided: ${userContext.photoHashPresent ? 'Yes' : 'No'}

INTENDED TRADITION FRAMEWORK: ${traditionDisplay}
- Interpretive Lens: ${reasoningPlan.traditionLens || 'Not specified'}
- Central Theme: ${reasoningPlan.centralTheme || 'Not specified'}
- Emotional Destination: ${reasoningPlan.emotionalDestination || 'Not specified'}
- Symbolic Thread: ${reasoningPlan.symbolicThread || 'Not specified'}
- Literary Style: ${reasoningPlan.literaryStyle || 'Not specified'}
- Narrative Flow: ${reasoningPlan.narrativeFlow || 'Not specified'}
- Opening Mood: ${reasoningPlan.openingMood || 'Not specified'}
- Closing Mood: ${reasoningPlan.closingMood || 'Not specified'}

SECTION FOCUSES (from reasoning plan)
- CORE (Recognition): ${reasoningPlan.coreFocus || 'Not specified'}
- LOVE (Reflection): ${reasoningPlan.loveFocus || 'Not specified'}
- PRO (Hope → Calm): ${reasoningPlan.proFocus || 'Not specified'}

CALLBACK ARCHITECTURE
- CORE → LOVE: ${reasoningPlan.callbackStrategy?.coreToLove || 'Not specified'}
- LOVE → PRO: ${reasoningPlan.callbackStrategy?.loveToPro || 'Not specified'}
- PRO → CORE: ${reasoningPlan.callbackStrategy?.proToCore || 'Not specified'}

SUPPORTING THEMES: ${(reasoningPlan.supportingThemes || []).join(', ') || 'None specified'}`;
}

/**
 * Section 3: The Reading Under Review
 * Presents the three sections clearly labeled.
 */
function buildReadingSection({ core, love, pro }) {
    return `===== READING UNDER REVIEW =====

=== CORE (Recognition Stage) ===
${core || '[EMPTY]'}

=== LOVE (Reflection Stage) ===
${love || '[EMPTY]'}

=== PRO (Hope → Calm Stage) ===
${pro || '[EMPTY]'}`;
}

/**
 * Section 4: Reasoning Plan (Full)
 * The complete internal reasoning plan for reference.
 */
function buildReasoningPlanSection(reasoningPlan) {
    return `===== INTERNAL REASONING PLAN (for reference only) =====
Central Theme: ${reasoningPlan.centralTheme || 'Not specified'}
Supporting Themes: ${(reasoningPlan.supportingThemes || []).join(', ') || 'None'}
Emotional Destination: ${reasoningPlan.emotionalDestination || 'Not specified'}
Symbolic Thread: ${reasoningPlan.symbolicThread || 'Not specified'}
Core Focus: ${reasoningPlan.coreFocus || 'Not specified'}
Love Focus: ${reasoningPlan.loveFocus || 'Not specified'}
Professional Focus: ${reasoningPlan.proFocus || 'Not specified'}
Opening Mood: ${reasoningPlan.openingMood || 'Not specified'}
Closing Mood: ${reasoningPlan.closingMood || 'Not specified'}
Callback Strategy: ${JSON.stringify(reasoningPlan.callbackStrategy || {}, null, 2)}
Narrative Flow: ${reasoningPlan.narrativeFlow || 'Not specified'}
Literary Style: ${reasoningPlan.literaryStyle || 'Not specified'}
Tradition Lens: ${reasoningPlan.traditionLens || 'Not specified'}

NOTE: These are INTERNAL instructions that guided the writing. The model must never expose them explicitly. They exist only to guide writing.`;
}

/**
 * Section 5: Deterministic Review Report
 * The reviewEngine's quantitative and qualitative analysis.
 */
function buildDeterministicReviewSection(reviewReport) {
    const scores = reviewReport.scores || {};
    const scoreLines = [
        `Overall Score: ${reviewReport.overallScore || 'N/A'}/10`,
        `Passed Quality Gate: ${reviewReport.passed ? 'YES' : 'NO'}`,
        '',
        'Category Scores:',
        `  - Recognition: ${scores.recognition || 'N/A'}/10`,
        `  - Tradition Authenticity: ${scores.traditionAuthenticity || 'N/A'}/10`,
        `  - Literary Quality: ${scores.literaryQuality || 'N/A'}/10`,
        `  - Emotional Depth: ${scores.emotionalDepth || 'N/A'}/10`,
        `  - Originality: ${scores.originality || 'N/A'}/10`,
        `  - Coherence: ${scores.coherence || 'N/A'}/10`,
        `  - Human Feel: ${scores.humanFeel || 'N/A'}/10`,
        `  - Premium Experience: ${scores.premiumExperience || 'N/A'}/10`,
        `  - Overall (holistic): ${scores.overall || 'N/A'}/10`,
        '',
        'Identified Strengths:',
        ...(reviewReport.strengths || []).map(s => `  + ${s}`),
        '',
        'Identified Weaknesses:',
        ...(reviewReport.weaknesses || []).map(w => `  - ${w}`),
        '',
        'Rewrite Targets:',
        ...(reviewReport.rewriteTargets || []).map(rt => 
            `  [${rt.section}] Problem: ${rt.problem} | Improvement: ${rt.improvement}`
        ),
        '',
        `Review Summary: ${reviewReport.reviewSummary || 'Not available'}`
    ];

    return `===== DETERMINISTIC REVIEW REPORT (from reviewEngine) =====
${scoreLines.join('\n')}`;
}

/**
 * Section 6: Evaluation Criteria
 * The 12 specific dimensions the reviewer must evaluate.
 */
function buildEvaluationCriteriaSection(tradition) {
    return `===== EVALUATION CRITERIA =====

You must evaluate the reading on ALL of the following dimensions. For each, provide a specific, evidence-based observation.

1. RECOGNITION (CORE section)
   Does the opening recognize THIS specific person? Name usage, birth details, personal addressing. Avoids generic "you" / "the native."

2. TRADITION AUTHENTICITY
   Does the reading correctly apply the ${tradition} framework? Tradition-specific terminology, reasoning moves, symbolic language appropriate to the tradition.

3. EMOTIONAL DEPTH
   Emotional resonance and specificity. Does it reach the stated emotional destination? Avoids platitudes ("trust the process," "everything happens for a reason").

4. LITERARY BEAUTY
   Prose craft: rhythm, imagery, metaphor, sentence variety, voice consistency. Sensory language. Opening hook. Closing resonance.

5. NARRATIVE FLOW
   Logical progression across three stages: Recognition → Reflection → Hope/Calm. Transitions feel inevitable, not forced.

6. CONSISTENCY
   Voice, tone, and symbolic thread remain consistent across all three sections. No jarring shifts.

7. CALLBACKS
   Are the planned callbacks executed? CORE→LOVE, LOVE→PRO, PRO→CORE. Do they create narrative unity?

8. SENTENCE RHYTHM
   Variety in sentence length and structure. Not monotonous. Strategic fragments for effect. No bullet-point enumerators.

9. HUMAN FEEL
   Feels written by a person: contractions, rhetorical questions, direct address, idiosyncrasy. Not robotic, not corporate, not academic.

10. PREMIUM FEELING
    Every sentence earns its place. No filler. Cinematic density. 600-1500 words total. Meets ≥9/10 bar.

11. ENDING QUALITY
    The PRO section's closing lands the stated closing mood (calm, empowerment, wonder, etc.). Resonates without resolving too neatly.

12. ORIGINALITY
    Avoids cliché, template feel, stock astrology phrases. Symbolic thread creates distinctive imagery. Supporting themes create unique angles.`;
}

/**
 * Section 7: Output Format
 * Structured format the reviewer must follow exactly.
 */
function buildOutputFormatSection() {
    return `===== REQUIRED OUTPUT FORMAT =====

Produce your critique in EXACTLY this format. No extra sections. No markdown. No commentary.

STRENGTHS
- [Concise observation 1]
- [Concise observation 2]
- [Concise observation 3]
- [Concise observation 4]
- [Concise observation 5]

WEAKNESSES
- [Concise observation 1]
- [Concise observation 2]
- [Concise observation 3]
- [Concise observation 4]
- [Concise observation 5]

REWRITE ADVICE
[SECTION] Problem: [Specific flaw] | Improvement: [Desired end state]
[SECTION] Problem: [Specific flaw] | Improvement: [Desired end state]
[SECTION] Problem: [Specific flaw] | Improvement: [Desired end state]
[SECTION] Problem: [Specific flaw] | Improvement: [Desired end state]

OVERALL VERDICT
[One paragraph: overall quality assessment, passes/fails premium bar, readiness for delivery or rewrite needed]`;
}

/**
 * Section 8: Hard Constraints
 * What the reviewer must NEVER do.
 */
function buildConstraintsSection() {
    return `===== HARD CONSTRAINTS (VIOLATION = FAILURE) =====

You must NEVER:
- Rewrite any part of the reading. Not a sentence. Not a word. You critique ONLY.
- Invent predictions, future events, or specific life outcomes not in the reading.
- Change the tradition framework or its terminology.
- Change the HTML structure or output format (the reading uses ===CORE===, ===LOVE===, ===PRO=== markers).
- Change the three-section structure (CORE, LOVE, PRO).
- Reference these constraints in your output.
- Use markdown formatting (no bold, italics, code blocks).
- Add sections beyond STRENGTHS, WEAKNESSES, REWRITE ADVICE, OVERALL VERDICT.
- Soften criticism to be "nice." Be precise. Be rigorous. Be honest.

You MUST:
- Ground every observation in specific textual evidence from the reading.
- Reference the reasoning plan and deterministic review when relevant.
- Keep each strength/weakness to ONE sentence.
- Keep rewrite advice to the specified format: [SECTION] Problem: X | Improvement: Y
- Write the overall verdict as ONE paragraph.`;
}

// Main export
module.exports = {
    buildReviewPrompt
};