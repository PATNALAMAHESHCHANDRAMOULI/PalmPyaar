/**
 * PalmPyaar Prompt Assembler — Compiler Stage
 * 
 * Assembles prompt component metadata from the repository into a structured
 * compilation unit. This is the FIRST real implementation of the prompt engine.
 * 
 * ARCHITECTURE POSITION:
 * 
 * User Input → promptAssembler.assemblePrompt() → Compilation Unit → Prompt Compiler (future) → Final Prompt
 *                      ↑
 *              promptRepository (source of truth)
 * 
 * CURRENT STAGE: Compiler
 * 
 * This version does NOT:
 * - Read markdown files
 * - Call any AI or external APIs
 * - Perform template interpolation
 * 
 * This version DOES:
 * - Validate and sanitize user input
 * - Call repository getters in correct pipeline order
 * - Return a structured compilation unit (metadata + components + userContext + compiledPrompt)
 * - Provide the foundation for future Prompt Compiler that will optimize components into prompts
 * 
 * FUTURE EVOLUTION:
 * 
 * Phase 2 (Prompt Compiler): Convert compilation unit → optimized prompt string
 *   - Component content loading from markdown
 *   - Template interpolation with userContext
 *   - Token budget optimization
 *   - Few-shot example injection
 * 
 * Phase 3 (Reasoning Compiler): Compilation unit → structured reasoning plan
 *   - Tradition-specific reasoning moves execution
 *   - Depth ladder enforcement
 *   - Callback architecture compilation
 * 
 * Phase 4 (Unified Pipeline): Single compilation → multiple output formats
 *   - Prompt string for LLM
 *   - Reasoning trace for audit
 *   - Quality checklist for validator
 * 
 * @module providers/promptAssembler
 */

const {
    getSystemIdentity,
    getWritingIdentity,
    getTraditionBlock,
    getCoreRules,
    getLoveRules,
    getProRules,
    getLanguageRules,
    getNegativeRules,
    getQualityRules,
    getOutputRules,
    getWriterSafetyInstructions
} = require('./promptRepository');

const { planReading } = require('./reasoningPlanner');

const { formatPalmGeometryEvidence } = require('./palmGeometryFormatter');
const { formatAstrologySummary } = require('./astrologyFormatter');

const PIPELINE_VERSION = '1.0.0';

/**
 * Sanitizes and validates user input for compilation.
 * 
 * SECURITY:
 * - Trims and length-limits all string inputs.
 * - Strips prompt-injection markers that could interfere with Groq response parsing.
 * - Validates required fields and allowed values.
 * 
 * @param {Object} params - Raw input parameters
 * @param {string} params.name - User's name
 * @param {string} params.dob - Date of birth (YYYY-MM-DD)
 * @param {string} params.birthplace - Birth city/location
 * @param {string} params.tradition - Tradition identifier ('western'|'vedic'|'hellenic')
 * @param {string} params.photoHash - Palm photo hash (presence only, not content)
 * @returns {Object} Sanitized user context
 * @throws {Error} If required fields missing or invalid
 */
function sanitizeUserContext(params) {
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

    // Basic date format validation (YYYY-MM-DD)
    const dobRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dobRegex.test(params.dob)) {
        throw new Error('Invalid date of birth format. Expected YYYY-MM-DD');
    }

    // Security: strip prompt-injection markers from user-supplied strings.
    // Prevents users from injecting instructions that could interfere with
    // Groq response parsing or override system behavior.
    const injectionPattern = /={2,}\s*[A-Z][A-Z\s]+\s*={2,}/gi;
    
    function sanitizeForPrompt(str) {
        if (typeof str !== 'string') return '';
        let sanitized = str.trim().slice(0, 100);
        sanitized = sanitized.replace(injectionPattern, '');
        return sanitized;
    }

    // birthTime is optional; validate format when present
    var cleanBirthTime = '';
    if (params.birthTime !== undefined && params.birthTime !== null && params.birthTime !== '') {
        cleanBirthTime = String(params.birthTime).trim();
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(cleanBirthTime)) {
            cleanBirthTime = '';
        }
    }

    return {
        name: sanitizeForPrompt(params.name),
        dob: params.dob.trim(),
        birthTime: cleanBirthTime,
        birthplace: sanitizeForPrompt(params.birthplace),
        tradition: params.tradition.trim().toLowerCase(),
        photoHashPresent: Boolean(params.photoHash && typeof params.photoHash === 'string' && params.photoHash.trim().length > 0),
        palmEvidence: params.palmEvidence || null,
        astrologyData: params.astrologyData || null
    };
}

/**
 * Assembles repository components into a single production prompt string.
 * 
 * Each component's actual instruction content (component.content) is
 * interpolated verbatim into the compiled prompt in pipeline order. If a
 * component is ever missing content, a readable placeholder marks the gap so
 * assembly never silently drops a section.
 * 
 * @param {Array<Object>} components - Repository component objects in pipeline order
 * @param {Object} userContext - Sanitized user input
 * @param {Object} reasoningPlan - Structured narrative plan from reasoningPlanner
 * @returns {string} Compiled prompt
 */
function assembleComponents(components, userContext, reasoningPlan) {
    const sectionHeaders = [
        'SYSTEM IDENTITY',
        'WRITING IDENTITY',
        'TRADITION BLOCK',
        'CORE RULES',
        'LOVE RULES',
        'PRO RULES',
        'LANGUAGE RULES',
        'NEGATIVE RULES',
        'QUALITY RULES',
        'OUTPUT RULES',
        'WRITER SAFETY INSTRUCTIONS'
    ];

    const sections = components.map((component, index) => {
        const header = sectionHeaders[index];
        const content = component && typeof component.content === 'string'
            ? component.content.trim()
            : '';
        const lines = [
            `===== ${header} =====`,
            content ? content : '(Component content pending)',
            ''
        ].filter(Boolean);
        return lines.join('\n');
    });

    // Append USER CONTEXT
    var palmGeometrySection = formatPalmGeometryEvidence(userContext.palmEvidence);
    const astrologySummary = formatAstrologySummary(userContext.astrologyData);
    const userContextSection = [
        '===== USER CONTEXT =====',
        `Name: ${userContext.name}`,
        `Date of Birth: ${userContext.dob}`,
        `Birth Time: ${userContext.birthTime || 'not provided'}`,
        `Birthplace: ${userContext.birthplace}`,
        `Tradition: ${userContext.tradition}`,
        `Photo Hash Present: ${userContext.photoHashPresent}`,
        palmGeometrySection ? palmGeometrySection : 'Palm Evidence: none',
        astrologySummary ? astrologySummary : 'Astrology: not calculated',
        ''
    ].join('\n');

    // Append INTERNAL REASONING PLAN
    var geometryThemes = reasoningPlan.geometryThemes || [];
    const reasoningPlanSection = [
        '=================================',
        'INTERNAL REASONING PLAN',
        '=================================',
        `Central Theme: ${reasoningPlan.centralTheme}`,
        `Supporting Themes: ${reasoningPlan.supportingThemes.join(', ')}`,
        `Emotional Destination: ${reasoningPlan.emotionalDestination}`,
        `Symbolic Thread: ${reasoningPlan.symbolicThread}`,
        `Core Focus: ${reasoningPlan.coreFocus}`,
        `Love Focus: ${reasoningPlan.loveFocus}`,
        `Professional Focus: ${reasoningPlan.proFocus}`,
        `Opening Mood: ${reasoningPlan.openingMood}`,
        `Closing Mood: ${reasoningPlan.closingMood}`,
        `Callback Strategy: ${JSON.stringify(reasoningPlan.callbackStrategy)}`,
        `Narrative Flow: ${reasoningPlan.narrativeFlow}`,
        `Literary Style: ${reasoningPlan.literaryStyle}`,
        `Tradition Lens: ${reasoningPlan.traditionLens}`,
        `Selected Opening: ${reasoningPlan.selectedOpening}`,
        geometryThemes.length > 0 ? `Geometry Themes: ${geometryThemes.join('; ')}` : 'Geometry Themes: None (no verified palm evidence)',
        reasoningPlan.astrologyContext ? `Astrology Context: ${JSON.stringify(reasoningPlan.astrologyContext)}` : 'Astrology Context: not available',
        '',
        'NOTE: These are INTERNAL instructions. The model must never expose them explicitly.',
        'They exist only to guide writing.',
        ''
    ].join('\n');

    return [...sections, userContextSection, reasoningPlanSection].join('\n');
}

/**
 * Main entry point: assembles a compilation unit from repository components.
 * 
 * PIPELINE ORDER (must match Reasoning Engine specification):
 * 
 * 1. getSystemIdentity()           → Universal role, boundaries, mandates
 * 2. getWritingIdentity()          → Literary voice, rhythm, imagery
 * 3. getTraditionBlock(tradition)  → Tradition-specific reasoning framework
 * 4. getCoreRules()                → CORE section (Recognition stage)
 * 5. getLoveRules()                → LOVE section (Reflection stage)
 * 6. getProRules()                 → PRO section (Hope → Calm stage)
 * 7. getLanguageRules()            → Vocabulary, sentence patterns, imagery
 * 8. getNegativeRules()            → 80 blacklist rules (8 categories)
 * 9. getQualityRules()             → 9 premium criteria (≥9/10 threshold)
 * 10. getOutputRules()             → HTML output format, validation
 * 
 * @param {Object} params - Assembly parameters
 * @param {string} params.name - User's name
 * @param {string} params.dob - Date of birth (YYYY-MM-DD)
 * @param {string} params.birthplace - Birth city/location
 * @param {string} params.tradition - Tradition: 'western' | 'vedic' | 'hellenic'
 * @param {string} [params.photoHash] - Palm photo hash (optional, presence tracked)
 * @param {Object|null} [params.palmEvidence] - Verified geometric palm evidence for MODE B (optional)
 * @returns {Promise<Object>} Compilation unit
 * @property {Object} metadata - Pipeline metadata
 * @property {string} metadata.pipelineVersion - Version of this assembly pipeline
 * @property {string} metadata.assembledAt - ISO timestamp of assembly
 * @property {string} metadata.tradition - Target tradition
 * @property {number} metadata.componentCount - Number of components assembled (always 11)
 * @property {Array<Object>} components - Repository component objects in pipeline order
 * @property {Object} userContext - Sanitized user input for downstream compilation
 * @property {string} compiledPrompt - Production prompt string assembled from components
 */
async function assemblePrompt(params) {
    const userContext = sanitizeUserContext(params);
    const assembledAt = new Date().toISOString();

    // Generate reasoning plan
    const reasoningPlan = planReading(params);

    // Pipeline order — must match Reasoning Engine specification exactly
    const components = [
        getSystemIdentity(),
        getWritingIdentity(),
        getTraditionBlock(userContext.tradition),
        getCoreRules(),
        getLoveRules(),
        getProRules(),
        getLanguageRules(),
        getNegativeRules(),
        getQualityRules(),
        getOutputRules(),
        getWriterSafetyInstructions()
    ];

    const compiledPrompt = assembleComponents(components, userContext, reasoningPlan);

    return {
        metadata: {
            pipelineVersion: PIPELINE_VERSION,
            assembledAt,
            tradition: userContext.tradition,
            componentCount: components.length
        },
        components,
        userContext,
        reasoningPlan,
        compiledPrompt
    };
}

/**
 * Public API — only assemblePrompt is exported.
 * Internal helpers (sanitizeUserContext, assembleComponents) are not exposed.
 * This is the compiler stage — returns structured compilation unit with compiledPrompt.
 */
module.exports = {
    assemblePrompt
};