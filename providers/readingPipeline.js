/**
 * PalmPyaar Reading Pipeline — Orchestration Layer
 * 
 * ARCHITECTURE POSITION:
 * 
 * API Handler → Reading Pipeline → (Stages 1-7) → Final Reading
 * 
 * This module is the SINGLE orchestration point for the entire reading generation workflow.
 * It coordinates stages but does NOT execute AI calls, prompt generation, or rewriting.
 * 
 * WHY ORCHESTRATION IS SEPARATE:
 * 
 * 1. Single Source of Truth for Workflow: The pipeline definition — what stages exist,
 *    their order, their dependencies, their success/failure handling — lives in ONE place.
 *    No scattered logic across API handlers, no implicit ordering in function calls.
 * 
 * 2. Observability & Debugging: Every pipeline run produces a structured trace
 *    (pipelineStages array) showing exactly what executed, when, and with what status.
 *    This enables logging, monitoring, and post-mortem analysis without code changes.
 * 
 * 3. Testability: The orchestrator can be tested with mock stages. Stage implementations
 *    can be tested in isolation. The workflow logic is decoupled from stage logic.
 * 
 * 4. Retry & Recovery Belong Here: Transient failures (network, rate limits, timeouts)
 *    are orchestration concerns, not stage concerns. The pipeline can implement
 *    exponential backoff, circuit breakers, and stage-level retries without polluting
 *    stage code with infrastructure logic.
 * 
 * WHY FUTURE STAGES REMAIN ISOLATED:
 * 
 * - Stage 3 (Writer): AI generation. Swappable provider (Groq, OpenAI, local, template).
 * - Stage 4 (Deterministic Review): Pure function. No AI. Fast. Always runs.
 * - Stage 5 (AI Review): Optional quality gate. Can be enabled/disabled per tier.
 * - Stage 6 (Rewrite): Conditional execution. Only runs if review fails.
 * - Stage 7 (Final Validation): HTML structure, marker validation, quality gate.
 * 
 * Each stage is a pure function with defined input/output. The orchestrator merely
 * sequences them. This allows:
 *   * A/B testing different writers
 *   * Swapping review models
 *   * Skipping AI review for speed tier
 *   * Running deterministic review in parallel with AI generation
 *   * Replacing any stage without touching others
 * 
 * WHY THIS ARCHITECTURE ALLOWS SWAPPING AI PROVIDERS:
 * 
 * The Writer stage (Stage 3) is an abstraction: `generateReading(params) → {core, love, pro}`.
 * Any provider implementing this interface plugs in. The orchestrator doesn't know or care
 * if it's Groq, OpenAI, Anthropic, a local model, or a template fallback. The same
 * pipeline runs regardless. Provider selection is a configuration decision, not a code change.
 * 
 * WHY RETRIES BELONG HERE:
 * 
 * - Stages should be idempotent pure functions where possible
 * - Retry policy (attempts, backoff, which errors are retryable) is a workflow concern
 * - Different stages may need different retry strategies (AI calls vs deterministic)
 * - Circuit breaker state is pipeline-level, not stage-level
 * - Dead letter / fallback logic (e.g., template fallback on AI failure) is orchestration
 * 
 * @module providers/readingPipeline
 */

const { planReading } = require('./reasoningPlanner');
const { assemblePrompt } = require('./promptAssembler');

const PIPELINE_VERSION = '1.0.0';

/**
 * Defines the complete 7-stage pipeline structure.
 * Stages 3-7 are declared but not yet implemented (status: 'pending').
 */
const PIPELINE_STAGES = [
    { stage: 'reasoning', name: 'Reasoning Planner', implemented: true },
    { stage: 'assembly', name: 'Prompt Assembly', implemented: true },
    { stage: 'writer', name: 'AI Writer', implemented: false },
    { stage: 'deterministicReview', name: 'Deterministic Review', implemented: false },
    { stage: 'aiReview', name: 'AI Review', implemented: false },
    { stage: 'rewrite', name: 'Rewrite Loop', implemented: false },
    { stage: 'finalValidation', name: 'Final Validation', implemented: false }
];

/**
 * Executes the reading pipeline up to the current implementation boundary.
 * 
 * CURRENT IMPLEMENTATION: Stages 1-2 only (Reasoning → Assembly).
 * Returns a pipeline object ready for the Writer stage.
 * 
 * PURE ORCHESTRATION: No AI calls, no prompt generation, no rewriting,
 * no markdown loading, no filesystem access. Only coordinates stage execution.
 * 
 * @param {Object} params - Pipeline input parameters
 * @param {string} params.name - User's name
 * @param {string} params.dob - Date of birth (YYYY-MM-DD)
 * @param {string} params.birthplace - Birth city/location
 * @param {string} params.tradition - Tradition: 'western' | 'vedic' | 'hellenic'
 * @param {string} [params.photoHash] - Palm photo hash (optional)
 * @param {Object} [params.options] - Pipeline options
 * @param {boolean} [params.options.skipReasoning=false] - Skip reasoning (use defaults)
 * @param {boolean} [params.options.skipAssembly=false] - Skip assembly (return plan only)
 * @returns {Promise<Object>} Pipeline result
 * @property {Object} metadata - Pipeline execution metadata
 * @property {string} metadata.pipelineVersion - Version of this pipeline
 * @property {string} metadata.startedAt - ISO timestamp when pipeline started
 * @property {string} metadata.completedAt - ISO timestamp when pipeline completed
 * @property {number} metadata.durationMs - Total execution time in milliseconds
 * @property {Object} reasoningPlan - Structured narrative plan from Stage 1
 * @property {string} compiledPrompt - Production prompt from Stage 2
 * @property {Object[]} pipelineStages - Status of all 7 stages
 * @property {string} pipelineStages[].stage - Stage identifier
 * @property {string} pipelineStages[].name - Human-readable stage name
 * @property {string} pipelineStages[].status - 'completed' | 'pending' | 'failed' | 'skipped'
 * @property {number} [pipelineStages[].durationMs] - Stage execution time
 * @property {string} [pipelineStages[].error] - Error message if failed
 * @property {string} nextStage - Next stage to execute ('writer')
 * @property {string} status - Pipeline status ('ready' | 'completed' | 'failed')
 */
async function runPipeline(params, options = {}) {
    const startedAt = new Date().toISOString();
    const startTime = Date.now();
    
    const { skipReasoning = false, skipAssembly = false } = options;
    
    // Initialize pipeline stages tracking
    const pipelineStages = PIPELINE_STAGES.map(s => ({
        stage: s.stage,
        name: s.name,
        status: 'pending'
    }));

    let reasoningPlan = null;
    let compiledPrompt = null;
    let status = 'ready';
    let error = null;

    try {
        // ==========================================
        // STAGE 1: Reasoning Planner
        // ==========================================
        const stage1Start = Date.now();
        pipelineStages[0].status = 'running';
        
        if (!skipReasoning) {
            reasoningPlan = planReading(params);
            pipelineStages[0].status = 'completed';
        } else {
            // Generate minimal default plan if skipped
            reasoningPlan = generateDefaultPlan(params);
            pipelineStages[0].status = 'skipped';
        }
        pipelineStages[0].durationMs = Date.now() - stage1Start;

        // ==========================================
        // STAGE 2: Prompt Assembly
        // ==========================================
        const stage2Start = Date.now();
        pipelineStages[1].status = 'running';
        
        if (!skipAssembly) {
            const assemblyResult = await assemblePrompt(params);
            compiledPrompt = assemblyResult.compiledPrompt;
            // Merge reasoning plan from assembly (should match Stage 1)
            reasoningPlan = assemblyResult.reasoningPlan || reasoningPlan;
            pipelineStages[1].status = 'completed';
        } else {
            pipelineStages[1].status = 'skipped';
        }
        pipelineStages[1].durationMs = Date.now() - stage2Start;

        // Remaining stages stay as 'pending'
        status = 'ready';

    } catch (err) {
        // Mark current stage as failed
        const currentStageIndex = pipelineStages.findIndex(s => s.status === 'running');
        if (currentStageIndex >= 0) {
            pipelineStages[currentStageIndex].status = 'failed';
            pipelineStages[currentStageIndex].error = err.message;
        }
        status = 'failed';
        error = err.message;
    }

    const completedAt = new Date().toISOString();
    const durationMs = Date.now() - startTime;

    // Build result object
    const result = {
        metadata: {
            pipelineVersion: PIPELINE_VERSION,
            startedAt,
            completedAt,
            durationMs
        },
        reasoningPlan,
        compiledPrompt,
        pipelineStages,
        nextStage: 'writer',
        status
    };

    // Include error if failed
    if (error) {
        result.error = error;
    }

    return result;
}

/**
 * Generates a minimal default reasoning plan when reasoning is skipped.
 * Used for testing or fallback scenarios.
 */
function generateDefaultPlan(params) {
    return {
        centralTheme: 'Self-discovery through celestial reflection',
        supportingThemes: ['Identity', 'Purpose', 'Connection'],
        emotionalDestination: 'Quiet confidence',
        symbolicThread: 'Mirror',
        coreFocus: 'Recognition of innate nature',
        loveFocus: 'Relational patterns and heart wisdom',
        proFocus: 'Vocational calling and practical wisdom',
        openingMood: 'Curiosity',
        closingMood: 'Empowerment',
        callbackStrategy: {
            coreToLove: 'The self you meet in CORE',
            loveToPro: 'The heart you know in LOVE',
            proToCore: 'The path that returns you to yourself'
        },
        narrativeFlow: 'Spiral deepening',
        literaryStyle: 'Poetic directness',
        traditionLens: params.tradition
    };
}

/**
 * Pipeline stage execution helper for future stages.
 * Provides consistent timing, error handling, and status tracking.
 * 
 * @param {Object} pipelineStages - The pipelineStages array
 * @param {number} stageIndex - Index of stage to execute
 * @param {Function} stageFn - Async function executing the stage
 * @returns {Promise<Object>} Stage result
 */
async function executeStage(pipelineStages, stageIndex, stageFn) {
    const stageStart = Date.now();
    pipelineStages[stageIndex].status = 'running';
    
    try {
        const result = await stageFn();
        pipelineStages[stageIndex].status = 'completed';
        pipelineStages[stageIndex].durationMs = Date.now() - stageStart;
        return { success: true, result };
    } catch (err) {
        pipelineStages[stageIndex].status = 'failed';
        pipelineStages[stageIndex].durationMs = Date.now() - stageStart;
        pipelineStages[stageIndex].error = err.message;
        return { success: false, error: err.message };
    }
}

/**
 * Determines if pipeline should continue to next stage.
 * 
 * @param {Object[]} pipelineStages - Current pipeline stages
 * @param {number} currentIndex - Index of just-completed stage
 * @returns {boolean} True if should continue
 */
function shouldContinue(pipelineStages, currentIndex) {
    if (currentIndex >= pipelineStages.length - 1) return false;
    const currentStage = pipelineStages[currentIndex];
    return currentStage.status === 'completed';
}

module.exports = {
    runPipeline,
    // Internal helpers exported for testing
    PIPELINE_STAGES,
    PIPELINE_VERSION,
    executeStage,
    shouldContinue,
    generateDefaultPlan
};