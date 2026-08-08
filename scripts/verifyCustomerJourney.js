/**
 * Verification script for the DIRECT UPI customer journey.
 * Simulates the real flow through the actual serverless handlers:
 *   Landing -> details -> checkout -> UPI payment intent -> "I've paid" (UTR)
 *   -> owner confirmation (admin) -> reading generation -> AI review -> result -> reveal
 * Also checks the front-end contract (element IDs, fetch paths) statically.
 * Prints PASS/FAIL per step and exits non-zero on any failure.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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

function assertEqual(actual, expected, msg) {
    if (actual !== expected) throw new Error(`${msg}: expected "${expected}", got "${actual}"`);
}

const SECRET = 'phase5-secret-key';
const ADMIN_SECRET = 'phase5-admin-key';
const UPI_ID = 'palm@pyaar';
const ROOT = path.join(__dirname, '..');

function setEnv(env) {
    for (const [k, v] of Object.entries(env)) process.env[k] = v;
}

function makeRes() {
    const res = {
        _json: null,
        _location: null,
        statusCode: 0,
        setHeader() {},
        status(code) { res.statusCode = code; return res; },
        json(obj) { res._json = obj; return res; },
        writeHead(code, headers) { res.statusCode = code; res._location = headers && headers.Location; return res; },
        end() { return res; }
    };
    return res;
}

const req = (method, query, body, headers) => ({
    method,
    query: query || {},
    body,
    headers: headers || { host: 'example.com', 'x-forwarded-host': 'example.com', 'x-forwarded-proto': 'https' }
});

(async () => {
    const createPayment = require('../api/create-payment');
    const verifyPayment = require('../api/verify-payment');
    const adminConfirmPayment = require('../api/admin-confirm-payment');
    const generateReading = require('../api/generate-reading');

    // -------- STEP 1: Landing page exists and wires checkout --------
    await check('STEP 1: index.html exists, has reading-form + unlock-btn + checkout.js', () => {
        const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        assertTrue(html.includes('js/checkout.js'), 'checkout.js script tag');
        assertTrue(html.includes('id="reading-form"'), 'reading-form');
        assertTrue(html.includes('id="unlock-btn"'), 'unlock-btn');
        assertTrue(html.includes('id="payment-panel"'), 'payment-panel');
        assertTrue(html.includes('id="payment-deeplink-btn"'), 'payment deep-link button');
        assertTrue(html.includes('id="payment-utr-form"'), 'UTR form');
        assertTrue(/id="name"|name="name"/.test(html), 'name input');
        assertTrue(/id="dob"|name="dob"/.test(html), 'dob input');
        assertTrue(/id="birthplace"|name="birthplace"/.test(html), 'birthplace input');
        assertTrue(/name="tradition"/.test(html), 'tradition input');
    });

    // -------- STEP 2: checkout posts valid payload; server returns UPI intent --------
    const CUSTOMER = { name: 'Aarav Mehta', dob: '1988-11-04', birthplace: 'Jaipur', tradition: 'vedic', photoHash: '' };
    setEnv({ NODE_ENV: 'production', TOKEN_SECRET: SECRET, ADMIN_CONFIRM_SECRET: ADMIN_SECRET, PAYMENT_UPI_ID: UPI_ID });
    let orderId;
    await check('STEP 2: create-payment returns a UPI payment intent (no redirect)', async () => {
        const res = makeRes();
        await createPayment(req('POST', {}, CUSTOMER), res);
        assertEqual(res.statusCode, 200, 'status');
        assertTrue(res._json.success === true, 'success flag');
        assertTrue(res._json.payment && res._json.payment.deepLink.startsWith('upi://pay?'), 'UPI deep link');
        orderId = res._json.payment.orderId;
        assertTrue(res._json.payment.deepLink.includes(`tid=${orderId}`), 'deep link tid = orderId');
        assertTrue(res._json.paymentUrl === undefined, 'no gateway paymentUrl');
    });

    // -------- STEP 3: customer pays in their UPI app and submits the UTR --------
    await check('STEP 3: verify-payment acknowledges UTR claim but does NOT grant', async () => {
        const res = makeRes();
        await verifyPayment(req('POST', {}, { orderId, utr: '6A3B2C9D1EF0' }), res);
        assertEqual(res.statusCode, 200, 'status');
        assertTrue(res._json.submitted === true, 'submitted flag');
        assertTrue(res._json.token === undefined, 'no token issued');
        assertTrue(res._json.resultUrl === undefined, 'no resultUrl');
    });

    // -------- STEP 4: owner confirms in their UPI app and mints the token --------
    let resultUrl;
    await check('STEP 4: admin-confirm-payment (owner) returns result.html with token', async () => {
        const res = makeRes();
        await adminConfirmPayment(req('POST', {}, { ...CUSTOMER, orderId }, { 'x-admin-secret': ADMIN_SECRET }), res);
        assertEqual(res.statusCode, 200, 'status');
        assertTrue(res._json.confirmed === true, 'confirmed flag');
        resultUrl = res._json.resultUrl;
        assertTrue(resultUrl.startsWith('/result.html?'), 'result.html URL');
        assertTrue(resultUrl.includes('token='), 'HMAC token present');
    });

    // -------- STEP 5: result page -> generate-reading with the token --------
    await check('STEP 5: generate-reading verifies token and returns full reading', async () => {
        const q = new URL('https://example.com' + resultUrl).searchParams;
        const res = makeRes();
        await generateReading(req('GET', {
            name: q.get('name'), dob: q.get('dob'), birthplace: q.get('birthplace'),
            tradition: q.get('tradition'), photoHash: q.get('photoHash'),
            orderId: q.get('orderId'), token: q.get('token')
        }), res);
        assertEqual(res.statusCode, 200, 'status');
        assertTrue(res._json.reading.core && res._json.reading.core.length > 100, 'core non-empty');
        assertTrue(res._json.reading.love && res._json.reading.love.length > 100, 'love non-empty');
        assertTrue(res._json.reading.pro && res._json.reading.pro.length > 100, 'pro non-empty');
    });

    // -------- STEP 6: AI review path executes deterministically --------
    await check('STEP 6: deterministic review + AI review/rewrite prompts run for the reading', async () => {
        const { runPipeline } = require('../providers/readingPipeline');
        const { reviewReading } = require('../providers/reviewEngine');
        const { buildReviewPrompt } = require('../providers/reviewerPromptBuilder');
        const { buildRewritePrompt } = require('../providers/rewritePromptBuilder');
        const pipeline = await runPipeline({ ...CUSTOMER });
        const userContext = { name: CUSTOMER.name, dob: CUSTOMER.dob, birthplace: CUSTOMER.birthplace, tradition: CUSTOMER.tradition, photoHashPresent: false };
        const tpl = require('../providers/templateProvider');
        const reading = await tpl.generateReading(CUSTOMER);
        const review = reviewReading({ reading, reasoningPlan: pipeline.reasoningPlan, tradition: CUSTOMER.tradition, userContext });
        const reviewPrompt = buildReviewPrompt({ reading, reasoningPlan: pipeline.reasoningPlan, tradition: CUSTOMER.tradition, reviewReport: review, userContext });
        const rewritePrompt = buildRewritePrompt({ draft: reading, reasoningPlan: pipeline.reasoningPlan, review: { deterministic: review, ai: { strengths: ['s'], weaknesses: ['w'], rewriteAdvice: ['CORE Problem: p | Improvement: i'], overallVerdict: 'v' } }, userContext, tradition: CUSTOMER.tradition });
        assertTrue(reviewPrompt.length > 1000, 'review prompt builds');
        assertTrue(rewritePrompt.length > 100, 'rewrite prompt builds');
        assertTrue(typeof review.overallScore === 'number', 'review score computed');
    });

    // -------- STEP 7: result.html reveals reading (contract check) --------
    await check('STEP 7: result.html + reveal.js contract (IDs + fetch path)', () => {
        const resultHtml = fs.readFileSync(path.join(ROOT, 'result.html'), 'utf8');
        const revealJs = fs.readFileSync(path.join(ROOT, 'js', 'reveal.js'), 'utf8');
        assertTrue(resultHtml.includes('js/reveal.js'), 'reveal.js script tag');
        for (const id of ['section-core', 'section-love', 'section-pro', 'reading-user-name', 'reveal-loading', 'reveal-content', 'reveal-denied']) {
            assertTrue(resultHtml.includes(`id="${id}"`), `result.html missing #${id}`);
        }
        assertTrue(revealJs.includes(`'/api/generate-reading'`), 'reveal fetches /api/generate-reading');
        assertTrue(revealJs.includes('section-core') && revealJs.includes('section-love') && revealJs.includes('section-pro'), 'reveal renders sections');
    });

    // -------- STEP 8: access control — wrong token on the result page is denied --------
    await check('STEP 8: tampered token is denied (access control holds)', async () => {
        setEnv({ NODE_ENV: 'production', TOKEN_SECRET: SECRET });
        const q = new URL('https://example.com' + resultUrl).searchParams;
        const res = makeRes();
        await generateReading(req('GET', {
            name: q.get('name'), dob: q.get('dob'), birthplace: q.get('birthplace'),
            tradition: q.get('tradition'), photoHash: q.get('photoHash'),
            orderId: q.get('orderId'), token: q.get('token') + 'dead'
        }), res);
        assertEqual(res.statusCode, 403, 'status');
    });

    console.log('\n=== DIRECT UPI CUSTOMER JOURNEY SUMMARY ===');
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log(`Total: ${passed + failed}`);
    if (failed > 0) process.exit(1);
    console.log('CUSTOMER JOURNEY: ALL CHECKS PASSED');
})().catch((err) => {
    console.error('Customer journey verification crashed:', err);
    process.exit(1);
});
