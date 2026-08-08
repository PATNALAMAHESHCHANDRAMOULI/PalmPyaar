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

const PIPELINE_VERSION = '1.0.0';

/**
 * Sanitizes and validates user input for compilation.
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

    return {
        name: params.name.trim(),
        dob: params.dob.trim(),
        birthplace: params.birthplace.trim(),
        tradition: params.tradition,
        photoHashPresent: Boolean(params.photoHash && typeof params.photoHash === 'string' && params.photoHash.trim().length > 0)
    };
}

/**
 * Assembles repository components into a single production prompt string.
 * 
 * Since repository currently returns placeholder metadata (content: null),
 * this creates readable placeholder sections for each component.
 * 
 * FUTURE: When repository loads actual content from markdown,
 * this function will interpolate component.content with userContext.
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
        const lines = [
            `===== ${header} =====`,
            `Source: ${component.sourceDocument}`,
            `Version: ${component.version}`,
            `Description: ${component.description}`,
            component.futureSource ? `Future: ${component.futureSource}` : '',
            ''
        ].filter(Boolean);
        return lines.join('\n');
    });

    // Append USER CONTEXT
    const userContextSection = [
        '===== USER CONTEXT =====',
        `Name: ${userContext.name}`,
        `Date of Birth: ${userContext.dob}`,
        `Birthplace: ${userContext.birthplace}`,
        `Tradition: ${userContext.tradition}`,
        `Photo Hash Present: ${userContext.photoHashPresent}`,
        ''
    ].join('\n');

    // Append INTERNAL REASONING PLAN
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
 * @returns {Promise<Object>} Compilation unit
 * @property {Object} metadata - Pipeline metadata
 * @property {string} metadata.pipelineVersion - Version of this assembly pipeline
 * @property {string} metadata.assembledAt - ISO timestamp of assembly
 * @property {string} metadata.tradition - Target tradition
 * @property {number} metadata.componentCount - Number of components assembled (always 10)
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