/**
 * Temporary Phase 2 verification script.
 * Exercises the production reading path that runs BEFORE any network call:
 *   reasoningPlanner -> promptAssembler (runPipeline)
 *   -> deterministic review (reviewEngine)
 *   -> AI review prompt (reviewerPromptBuilder)
 *   -> AI rewrite prompt (rewritePromptBuilder)
 *   -> template fallback (templateProvider via groqProvider)
 *   -> generate-reading token/auth (HMAC verification)
 * Prints PASS/FAIL per check and exits non-zero on any failure.
 */

process.env.TOKEN_SECRET = 'phase2-test-secret-abc123';
delete process.env.DEV_BYPASS;
process.env.NODE_ENV = 'production';

let passed = 0;
let failed = 0;

async function check(name, fn) {
    try {
        await fn();
        console.log(`PASS: ${name}`);
        passed++;
    } catch (err) {
        console.log(`FAIL: ${name} -> ${err.message}`);
        failed++;
    }
}

function assertTrue(cond, msg) {
    if (!cond) throw new Error(msg);
}

function makeReqRes(method, query, body) {
    const res = {
        _json: null,
        statusCode: 0,
        setHeader() {},
        status(code) { res.statusCode = code; return res; },
        json(obj) { res._json = obj; return res; },
        writeHead(code) { res.statusCode = code; return res; },
        end() { return res; }
    };
    return [{ method, query: query || {}, body }, res];
}

(async () => {
    const { runPipeline } = require('../providers/readingPipeline');
    const { reviewReading } = require('../providers/reviewEngine');
    const { buildReviewPrompt } = require('../providers/reviewerPromptBuilder');
    const { buildRewritePrompt } = require('../providers/rewritePromptBuilder');
    const groqProvider = require('../providers/groqProvider');
    const templateProvider = require('../providers/templateProvider');
    const generateReadingHandler = require('../api/generate-reading');
    const crypto = require('crypto');

    const TRADITIONS = ['western', 'vedic', 'hellenic'];
    const params = {
        name: 'Ananya Sharma',
        dob: '1990-06-15',
        birthplace: 'Pune',
        tradition: 'western'
    };

    // ---- 1. Pipeline: reasoning + assembly for all traditions ----
    await check('Pipeline: reasoning + assembly for all traditions', async () => {
        for (const tradition of TRADITIONS) {
            const p = { ...params, tradition };
            const pipeline = await runPipeline(p);
            assertTrue(pipeline.status === 'ready', `status not ready for ${tradition}: ${pipeline.status}`);
            const rp = pipeline.reasoningPlan;
            const requiredPlanFields = [
                'centralTheme', 'supportingThemes', 'emotionalDestination', 'symbolicThread',
                'coreFocus', 'loveFocus', 'proFocus', 'openingMood', 'closingMood',
                'callbackStrategy', 'narrativeFlow', 'literaryStyle', 'traditionLens', 'selectedOpening'
            ];
            for (const f of requiredPlanFields) {
                assertTrue(rp && rp[f] !== undefined && rp[f] !== null && rp[f] !== '', `${f} missing for ${tradition}`);
            }
            assertTrue(pipeline.compiledPrompt && pipeline.compiledPrompt.length > 300, `compiledPrompt too short for ${tradition}`);
            assertTrue(pipeline.pipelineStages[0].status === 'completed', `reasoning stage not completed for ${tradition}`);
            assertTrue(pipeline.pipelineStages[1].status === 'completed', `assembly stage not completed for ${tradition}`);
        }
    });

    // ---- 2. Deterministic review on template reading ----
    const templateReading = await templateProvider.generateReading(params);
    let review;
    await check('Deterministic review produces valid 9-score report', async () => {
        review = reviewReading({
            reading: templateReading,
            reasoningPlan: (await runPipeline(params)).reasoningPlan,
            tradition: 'western',
            userContext: { name: params.name, dob: params.dob, birthplace: params.birthplace, tradition: 'western', photoHashPresent: false }
        });
        const expectedScoreKeys = ['recognition', 'traditionAuthenticity', 'literaryQuality', 'emotionalDepth', 'originality', 'coherence', 'humanFeel', 'premiumExperience', 'overall'];
        for (const k of expectedScoreKeys) {
            assertTrue(typeof review.scores[k] === 'number' && review.scores[k] >= 1 && review.scores[k] <= 10, `score ${k} invalid`);
        }
        assertTrue(typeof review.overallScore === 'number', 'overallScore not a number');
        assertTrue(typeof review.reviewSummary === 'string' && review.reviewSummary.length > 0, 'reviewSummary empty');
        assertTrue(typeof review.passed === 'boolean', 'passed not boolean');
    });

    // ---- 3. AI review prompt builds without crashing (all traditions) ----
    await check('AI review prompt builds (all traditions)', async () => {
        for (const tradition of TRADITIONS) {
            const pipeline = await runPipeline({ ...params, tradition });
            const prompt = buildReviewPrompt({
                reading: templateReading,
                reasoningPlan: pipeline.reasoningPlan,
                tradition,
                reviewReport: review,
                userContext: { name: params.name, dob: params.dob, birthplace: params.birthplace, tradition, photoHashPresent: false }
            });
            assertTrue(prompt.length > 1000, `review prompt too short for ${tradition}`);
            assertTrue(prompt.includes(`${tradition} framework`), `review prompt missing ${tradition} framework`);
        }
    });

    // ---- 4. AI rewrite prompt builds without crashing ----
    await check('AI rewrite prompt builds', async () => {
        const pipelineWest = await runPipeline(params);
        const rewritePrompt = buildRewritePrompt({
            draft: templateReading,
            reasoningPlan: pipelineWest.reasoningPlan,
            review: { deterministic: review, ai: { strengths: ['x'], weaknesses: ['y'], rewriteAdvice: ['CORE Problem: p | Improvement: i'], overallVerdict: 'verdict' } },
            userContext: { name: params.name, dob: params.dob, birthplace: params.birthplace, tradition: 'western', photoHashPresent: false },
            tradition: 'western'
        });
        assertTrue(rewritePrompt && rewritePrompt.length > 100, 'rewrite prompt too short');
    });

    // ---- 5. groqProvider graceful fallback without API key ----
    await check('groqProvider falls back to template without API key', async () => {
        delete process.env.GROQ_API_KEY;
        const fallbackReading = await groqProvider.generateReading(params);
        assertTrue(fallbackReading && fallbackReading.core && fallbackReading.love && fallbackReading.pro, 'fallback reading missing sections');
    });

    // ---- 6. generate-reading token/auth path ----
    const name = 'Ananya Sharma', dob = '1990-06-15', birthplace = 'Pune', tradition = 'western', orderId = 'PPA1B2C3D4E';
    const rawPayload = [name, dob, birthplace, tradition, '', '', orderId].join(':');
    const goodToken = crypto.createHmac('sha256', process.env.TOKEN_SECRET).update(rawPayload).digest('hex');

    await check('generate-reading: missing token -> 403', async () => {
        const [req1, res1] = makeReqRes('GET', { name, dob, birthplace, tradition, orderId });
        await generateReadingHandler(req1, res1);
        assertTrue(res1.statusCode === 403, `expected 403, got ${res1.statusCode}`);
    });

    await check('generate-reading: invalid token -> 403', async () => {
        const [req2, res2] = makeReqRes('GET', { name, dob, birthplace, tradition, orderId, token: 'deadbeef' });
        await generateReadingHandler(req2, res2);
        assertTrue(res2.statusCode === 403, `expected 403, got ${res2.statusCode}`);
    });

    await check('generate-reading: valid token -> 200 with reading', async () => {
        const [req3, res3] = makeReqRes('GET', { name, dob, birthplace, tradition, orderId, token: goodToken });
        await generateReadingHandler(req3, res3);
        assertTrue(res3.statusCode === 200, `expected 200, got ${res3.statusCode}`);
        assertTrue(res3._json && res3._json.success === true, 'success flag missing');
        assertTrue(res3._json.reading && res3._json.reading.core && res3._json.reading.love && res3._json.reading.pro, 'reading missing sections');
    });

    await check('generate-reading: missing TOKEN_SECRET -> 500', async () => {
        delete process.env.TOKEN_SECRET;
        const [req4, res4] = makeReqRes('GET', { name, dob, birthplace, tradition, orderId, token: goodToken });
        await generateReadingHandler(req4, res4);
        assertTrue(res4.statusCode === 500, `expected 500, got ${res4.statusCode}`);
        process.env.TOKEN_SECRET = 'phase2-test-secret-abc123';
    });

    console.log('\n=== PHASE 2 SUMMARY ===');
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log(`Total: ${passed + failed}`);
    if (failed > 0) process.exit(1);
    console.log('PHASE 2: ALL CHECKS PASSED');
})().catch((err) => {
    console.error('Phase 2 verification crashed:', err);
    process.exit(1);
});
