/**
 * PalmPyaar Rewrite Prompt Builder — AI Rewriter Prompt Constructor
 * 
 * ARCHITECTURE POSITION:
 * 
 * Writer (Groq) → Reviewer (Groq) → Rewriter (Groq) → Final Output
 * 
 * This module DOES NOT call AI. It ONLY constructs the rewrite prompt.
 * 
 * WHY A SEPARATE PROMPT BUILDER:
 * 
 * 1. Separation of Construction from Execution: Building a complex rewrite prompt with
 *    injected context (draft, reasoning plan, review, user context) is non-trivial logic.
 *    Isolating it enables testing, versioning, and prompt engineering without touching
 *    the AI caller.
 * 
 * 2. Deterministic Prompt Generation: Same inputs → same prompt. This allows caching,
 *    regression testing of prompt structure, and audit trails of what was sent to the AI.
 * 
 * 3. Single Source of Truth for Rewriter Persona: The "senior literary editor" persona,
 *    constraints, and output format are defined in ONE place. No drift across call sites.
 * 
 * 4. Future-Proofing: When the AI rewriter evolves (different model, different parameters),
 *    only the caller changes. The prompt construction remains stable.
 * 
 * @module providers/rewritePromptBuilder
 */

const { formatPalmGeometryEvidence } = require('./palmGeometryFormatter');

/**
 * Builds the complete prompt for the AI Rewriter.
 * 
 * PURE FUNCTION: No side effects, no I/O, no AI calls, no randomness.
 * Same inputs → same prompt string. Suitable for testing, caching, and audit logs.
 * 
 * @param {Object} params - Prompt construction inputs
 * @param {Object} params.draft - Current reading draft with core, love, pro sections
 * @param {string} params.draft.core - CORE section text (Recognition stage)
 * @param {string} params.draft.love - LOVE section text (Reflection stage)
 * @param {string} params.draft.pro - PRO section text (Hope → Calm stage)
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
 * @param {Object} params.review - Combined review (deterministic + AI)
 * @param {Object} params.review.deterministic - Deterministic review from reviewEngine
 * @param {Object} params.review.ai - AI review from reviewer (may be null)
 * @param {Object} params.userContext - Sanitized user context
 * @param {string} params.userContext.name - User's name
 * @param {string} params.userContext.dob - Date of birth
 * @param {string} params.userContext.birthplace - Birth location
 * @param {string} params.userContext.tradition - Tradition
 * @param {boolean} params.userContext.photoHashPresent - Whether palm photo provided
 * @param {Object|null} [params.userContext.palmEvidence] - Verified geometric palm evidence (MODE B) or null (MODE A)
 * @param {string} params.tradition - Tradition identifier ('western'|'vedic'|'hellenic')
 * @returns {string} Complete rewriter prompt
 */
function buildRewritePrompt({ draft, reasoningPlan, review, userContext, tradition }) {
    // Input validation
    if (!draft || typeof draft !== 'object') {
        throw new Error('buildRewritePrompt: draft object is required');
    }
    if (!reasoningPlan || typeof reasoningPlan !== 'object') {
        throw new Error('buildRewritePrompt: reasoningPlan object is required');
    }
    if (!review || typeof review !== 'object') {
        throw new Error('buildRewritePrompt: review object is required');
    }
    if (!userContext || typeof userContext !== 'object') {
        throw new Error('buildRewritePrompt: userContext object is required');
    }
    if (!tradition || typeof tradition !== 'string') {
        throw new Error('buildRewritePrompt: tradition string is required');
    }

    const { core, love, pro } = draft;
    const detReview = review.deterministic || {};
    const aiReview = review.ai || {};

    // Build each section of the prompt
    const sections = [
        buildPersonaSection(),
        buildContextSection({ userContext, tradition, reasoningPlan }),
        buildCurrentDraftSection({ core, love, pro }),
        buildReviewFeedbackSection({ detReview, aiReview }),
        buildRewriteInstructionsSection({ reasoningPlan, detReview }),
        buildOutputFormatSection(),
        buildHardConstraintsSection()
    ];

    return sections.join('\n\n');
}

/**
 * Section 1: Rewriter Persona
 * Defines the AI's role, expertise, and mindset.
 */
function buildPersonaSection() {
    return `You are a senior literary editor with 20+ years of experience editing premium astrology writing.

You have edited for the world's most respected astrological publications. You know the difference between writing that merely informs and writing that transforms. You understand that premium astrology writing is not prediction — it is recognition. It holds a mirror to the soul using the language of the stars.

Your standards are exacting. You do not praise lightly. You do not criticize vaguely. Every observation you make is grounded in craft: rhythm, imagery, voice, structure, emotional truth.

You are NOT a co-writer. You are an EDITOR. Your job is to IMPROVE the existing reading, not to rewrite it from scratch.`;
}

/**
 * Section 2: Context
 * User context, tradition, and the reading's intended purpose.
 */
function buildContextSection({ userContext, tradition, reasoningPlan }) {
    const traditionDisplay = tradition.charAt(0).toUpperCase() + tradition.slice(1);
    const palmGeometryBlock = formatPalmGeometryEvidence(userContext.palmEvidence);
    
    return `===== CONTEXT =====

USER
- Name: ${userContext.name}
- Date of Birth: ${userContext.dob}
- Birthplace: ${userContext.birthplace}
- Tradition: ${traditionDisplay}
- Palm Photo Provided: ${userContext.photoHashPresent ? 'Yes' : 'No'}
${palmGeometryBlock ? `- Palm Geometry:\n${palmGeometryBlock.split('\n').map(l => '  ' + l).join('\n')}` : '- Palm Evidence: None'}

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
 * Section 3: Current Draft Under Revision
 * Presents the three sections clearly labeled with HTML markers.
 */
function buildCurrentDraftSection({ core, love, pro }) {
    return `===== CURRENT DRAFT (EDIT THIS) =====

===CORE===
${core || '[EMPTY]'}

===LOVE===
${love || '[EMPTY]'}

===PRO===
${pro || '[EMPTY]'}`;
}

/**
 * Section 4: Review Feedback
 * Combines deterministic and AI review findings.
 */
function buildReviewFeedbackSection({ detReview, aiReview }) {
    const lines = ['===== REVIEW FEEDBACK (ADDRESS THESE) ====='];
    
    // Deterministic review summary
    if (detReview.overallScore !== undefined) {
        lines.push(`Deterministic Overall Score: ${detReview.overallScore}/10`);
        lines.push(`Passed Quality Gate: ${detReview.passed ? 'YES' : 'NO'}`);
        lines.push('');
    }
    
    // Deterministic weaknesses
    if (detReview.weaknesses && detReview.weaknesses.length > 0) {
        lines.push('Deterministic Weaknesses:');
        for (const w of detReview.weaknesses) {
            lines.push(`  - ${w}`);
        }
        lines.push('');
    }
    
    // Deterministic rewrite targets
    if (detReview.rewriteTargets && detReview.rewriteTargets.length > 0) {
        lines.push('Deterministic Rewrite Targets:');
        for (const rt of detReview.rewriteTargets) {
            lines.push(`  [${rt.section}] Problem: ${rt.problem} | Improvement: ${rt.improvement}`);
        }
        lines.push('');
    }
    
    // AI review
    if (aiReview) {
        if (aiReview.weaknesses && aiReview.weaknesses.length > 0) {
            lines.push('AI Reviewer Weaknesses:');
            for (const w of aiReview.weaknesses) {
                lines.push(`  - ${w}`);
            }
            lines.push('');
        }
        
        if (aiReview.rewriteAdvice && aiReview.rewriteAdvice.length > 0) {
            lines.push('AI Reviewer Rewrite Advice:');
            for (const r of aiReview.rewriteAdvice) {
                lines.push(`  - ${r}`);
            }
            lines.push('');
        }
        
        if (aiReview.overallVerdict) {
            lines.push(`AI Overall Verdict: ${aiReview.overallVerdict}`);
            lines.push('');
        }
    }
    
    return lines.join('\n');
}

/**
 * Section 5: Rewrite Instructions
 * Specific guidance on what to improve and how.
 */
function buildRewriteInstructionsSection({ reasoningPlan, detReview }) {
    const scores = detReview.scores || {};
    const weakAreas = [];
    
    if (scores.recognition < 8) weakAreas.push('RECOGNITION (CORE): Increase personal specificity — use name naturally 2+ times, reference birth details, anchor central theme in personal specifics');
    if (scores.traditionAuthenticity < 8) weakAreas.push('TRADITION AUTHENTICITY: Infuse tradition-specific terminology across all sections; use symbolic thread in tradition-appropriate way');
    if (scores.literaryQuality < 8) weakAreas.push('LITERARY QUALITY: Vary sentence length; add 3+ original metaphors/similes; incorporate sensory language; match literary style');
    if (scores.emotionalDepth < 8) weakAreas.push('EMOTIONAL DEPTH: Deepen emotional exploration; use sensory language; avoid platitudes; target emotional destination');
    if (scores.originality < 8) weakAreas.push('ORIGINALITY: Replace stock phrases with fresh imagery; develop supporting themes');
    if (scores.coherence < 8) weakAreas.push('COHERENCE: Implement callback strategy — CORE→LOVE, LOVE→PRO, PRO→CORE; ensure narrative unity');
    if (scores.humanFeel < 8) weakAreas.push('HUMAN FEEL: Add contractions; use direct address; include rhetorical questions; remove hedging; allow sentence fragments');
    if (scores.premiumExperience < 8) weakAreas.push('PREMIUM EXPERIENCE: Cut filler paragraphs; ensure 600-1500 words; every sentence must carry metaphor, insight, or narrative momentum');
    
    let instructions = `===== REWRITE INSTRUCTIONS =====

You are editing an EXISTING premium reading. Your task is to IMPROVE weak sections while preserving everything that works.

PRESERVE (DO NOT CHANGE):
- HTML structure and section markers (===CORE===, ===LOVE===, ===PRO===)
- Three-section structure (CORE, LOVE, PRO)
- Tradition framework and terminology
- Reasoning plan: central theme, emotional destination, symbolic thread
- Callback strategy: CORE→LOVE, LOVE→PRO, PRO→CORE
- Section focuses from reasoning plan
- Opening mood and closing mood
- Literary style and narrative flow

IMPROVE ONLY THESE WEAK AREAS:`;
    
    if (weakAreas.length > 0) {
        for (const area of weakAreas) {
            instructions += `\n- ${area}`;
        }
    } else {
        instructions += '\n- No critical weaknesses identified — polish for premium quality';
    }
    
    instructions += `

SPECIFIC IMPROVEMENT TARGETS:
1. WEAK SECTIONS: Expand underdeveloped sections (target 200-500 words each)
2. SENTENCE RHYTHM: Vary length and structure; strategic fragments for effect
3. SPECIFICITY: Replace generic language with personal, sensory, tradition-specific details
4. LITERARY QUALITY: Original metaphors, sensory imagery, rhythmic prose
5. TRANSITIONS: Smooth section transitions; execute callbacks naturally
6. HUMAN FEEL: Contractions, direct address, rhetorical questions, idiosyncratic voice
7. ENDING: Land the closing mood (${reasoningPlan.closingMood || 'calm'}) with resonance

LENGTH CONSTRAINT: Do not increase total length by more than 15%. Cut filler if needed.`;

    return instructions;
}

/**
 * Section 6: Output Format
 * The rewriter must return the complete reading with markers.
 */
function buildOutputFormatSection() {
    return `===== REQUIRED OUTPUT FORMAT =====

Return the COMPLETE revised reading with ALL three sections.

Use EXACTLY these markers. No extra text. No markdown. No commentary.

===CORE===
[Revised CORE section]

===LOVE===
[Revised LOVE section]

===PRO===
[Revised PRO section]`;
}

/**
 * Section 7: Hard Constraints
 * What the rewriter must NEVER do.
 */
function buildHardConstraintsSection() {
    return `===== HARD CONSTRAINTS (VIOLATION = FAILURE) =====

You must NEVER:
- Change the HTML structure or output format (the reading uses ===CORE===, ===LOVE===, ===PRO=== markers)
- Change the three-section structure (CORE, LOVE, PRO)
- Invent predictions, future events, or specific life outcomes not in the original draft
- Change the tradition framework or its terminology
- Change the reasoning plan's central theme, emotional destination, or symbolic thread
- Change the callback architecture
- Change the section focuses (coreFocus, loveFocus, proFocus)
- Change the opening mood or closing mood
- Change the literary style or narrative flow
- Increase total length by more than 15%
- Add sections beyond CORE, LOVE, PRO
- Use markdown formatting (no bold, italics, code blocks)
- Reference these constraints in your output

You MUST:
- Preserve all section markers exactly: ===CORE===, ===LOVE===, ===PRO===
- Keep all three sections substantial (200-500 words each)
- Ground every improvement in specific textual evidence from the review
- Maintain the user's name, birth details, and personal addressing
- Keep tradition-specific vocabulary consistent
- Execute the callback strategy naturally
- Land the stated closing mood in the PRO section
- Write in the specified literary style
- Ensure every sentence earns its place — no filler`;
}

module.exports = {
    buildRewritePrompt
};