/**
 * verifyCustomerJourney.js — end-to-end customer journey verification for the
 * Razorpay checkout flow, walking the REAL serverless handlers end-to-end.
 *
 * NOTE: filename kept from the original direct-UPI flow; this file now walks:
 *   Landing page (static contract) -> hand photo required -> create-payment
 *   (Razorpay order) -> Razorpay Checkout success -> verify-razorpay (signature
 *   verified server-side) -> token mint -> result.html -> generate-reading.
 *
 * Also asserts tampered payments and forged tokens never unlock, and that a
 * repeat visit regenerates the same reading (stateless, deterministic).
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

const ROOT = path.join(__dirname, '..');
const SECRET = 'journey-secret';
const KEY_ID = 'rzp_test_journeyKey';
const KEY_SECRET = 'journey-key-secret';
const RZ_ORDER = 'order_JOURNEY1234567';
const RZ_PAYMENT = 'pay_JOURNEY1234567';

function makeRes() {
    const res = {
        _json: null,
        statusCode: 0,
        setHeader() {},
        status(code) { res.statusCode = code; return res; },
        json(obj) { res._json = obj; return res; },
        writeHead() { return res; },
        end() { return res; }
    };
    return res;
}

const req = (method, query, body, headers) => ({
    method,
    query: query || {},
    body,
    headers: headers || { host: 'example.com' }
});

const CUSTOMER = { name: 'Ishita Verma', dob: '1992-02-29', birthplace: 'Kochi', tradition: 'hellenic' };
const PHOTO = 'c'.repeat(64);

function readFile(rel) {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

const ENV_KEYS = ['NODE_ENV', 'DEV_BYPASS', 'TOKEN_SECRET', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET', 'PAYMENT_AMOUNT', 'AI_READING'];

async function withEnv(env, fn) {
    const saved = {};
    for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
    try {
        for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
        return await fn();
    } finally {
        for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    }
}

function installFetchMock(json, status = 200) {
    const original = global.fetch;
    global.fetch = async () => ({
        ok: status >= 200 && status < 300,
        status,
        json: async () => json
    });
    return function restore() { global.fetch = original; };
}

function rzSignature(orderId, paymentId) {
    return crypto.createHmac('sha256', KEY_SECRET).update(orderId + '|' + paymentId).digest('hex');
}

async function createPaidOrder() {
    const restore = installFetchMock({ id: RZ_ORDER });
    try {
        let payment = null;
        await withEnv({ NODE_ENV: 'production', TOKEN_SECRET: SECRET, RAZORPAY_KEY_ID: KEY_ID, RAZORPAY_KEY_SECRET: KEY_SECRET, PAYMENT_AMOUNT: '20' }, async () => {
            const res = makeRes();
            await require('../api/create-payment')(req('POST', {}, { ...CUSTOMER, photoHash: PHOTO }), res);
            if (res.statusCode !== 200) throw new Error('create-payment failed: ' + JSON.stringify(res._json));
            payment = res._json.payment;
        });
        return payment;
    } finally {
        restore();
    }
}

function verifyBody(payment, sig, overrides) {
    return {
        name: CUSTOMER.name,
        dob: CUSTOMER.dob,
        birthplace: CUSTOMER.birthplace,
        tradition: CUSTOMER.tradition,
        photoHash: PHOTO,
        orderId: payment.orderId,
        stateToken: payment.stateToken,
        razorpayOrderId: payment.razorpayOrderId,
        razorpayPaymentId: RZ_PAYMENT,
        razorpaySignature: sig,
        ...(overrides || {})
    };
}

async function verifyAndGetResultUrl(payment, overrides) {
    const sig = rzSignature(payment.razorpayOrderId, RZ_PAYMENT);
    const res = makeRes();
    await withEnv({ NODE_ENV: 'production', TOKEN_SECRET: SECRET, RAZORPAY_KEY_SECRET: KEY_SECRET }, async () => {
        await require('../api/verify-razorpay')(
            req('POST', {}, verifyBody(payment, sig, overrides)),
            res
        );
    });
    return res;
}

(async () => {
    const createPayment = require('../api/create-payment');
    const generateReading = require('../api/generate-reading');

    // ============================================================
    // STEP 1 — Landing page contract (static)
    // ============================================================

    await check('STEP 1: landing page collects details + requires the hand photo', () => {
        const html = readFile('index.html');
        assertTrue(html.includes('<form id="reading-form"'), 'reading form');
        assertTrue(/id="name"/.test(html), 'name input');
        assertTrue(/id="dob"/.test(html), 'dob input');
        assertTrue(/id="birthplace"/.test(html), 'birthplace input');
        assertTrue(/<input type="file" id="photo"[^>]*accept="image\/\*"[^>]*required/.test(html), 'photo input accept+required');
        assertTrue(html.includes('id="photo-status"'), 'photo status message');
        assertTrue(html.includes('A hand photo is required'), 'photo required copy');
        assertTrue(html.includes('id="unlock-btn"'), 'unlock button');
        assertTrue(html.includes('src="js/teaser.js"'), 'teaser.js wired');
        assertTrue(html.includes('src="js/checkout.js"'), 'checkout.js wired');
        assertTrue(!html.includes('payment-panel'), 'no legacy UPI panel');
        assertTrue(!html.includes('payment-utr'), 'no legacy UTR form');
    });

    await check('STEP 1: unlock button disabled until a hand photo is hashed', () => {
        const teaser = readFile('js/teaser.js');
        assertTrue(teaser.includes('currentPhotoHash'), 'teaser tracks photo hash');
        assertTrue(teaser.includes('updateUnlockState'), 'teaser updates unlock state');
        assertTrue(teaser.includes('unlock-btn'), 'teaser binds unlock button');
        assertTrue(teaser.includes('A hand photo is required'), 'teaser gates on photo');
    });

    await check('STEP 1: checkout wires to Razorpay Checkout', () => {
        const checkout = readFile('js/checkout.js');
        assertTrue(checkout.includes('/api/create-payment'), 'calls create-payment');
        assertTrue(checkout.includes('/api/verify-razorpay'), 'calls verify-razorpay');
        assertTrue(checkout.includes('https://checkout.razorpay.com/v1/checkout.js'), 'loads Razorpay Checkout script');
        assertTrue(checkout.includes('razorpay_order_id'), 'sends razorpay_order_id');
        assertTrue(checkout.includes('razorpay_payment_id'), 'sends razorpay_payment_id');
        assertTrue(checkout.includes('razorpay_signature'), 'sends razorpay_signature');
    });

    // ============================================================
    // STEP 2 — create-payment
    // ============================================================

    await check('STEP 2: create-payment returns a Razorpay order', async () => {
        const restore = installFetchMock({ id: RZ_ORDER });
        try {
            await withEnv({ NODE_ENV: 'production', TOKEN_SECRET: SECRET, RAZORPAY_KEY_ID: KEY_ID, RAZORPAY_KEY_SECRET: KEY_SECRET, PAYMENT_AMOUNT: '20' }, async () => {
                const res = makeRes();
                await createPayment(req('POST', {}, { ...CUSTOMER, photoHash: PHOTO }), res);
                assertEqual(res.statusCode, 200, 'status');
                assertEqual(res._json.payment.razorpayOrderId, RZ_ORDER, 'razorpay order id');
                assertEqual(res._json.payment.keyId, KEY_ID, 'keyId for Checkout');
                assertEqual(res._json.payment.amountPaise, 2000, 'amountPaise');
            });
        } finally {
            restore();
        }
    });

    await check('STEP 2: cannot create payment without a hand photo', async () => {
        await withEnv({ NODE_ENV: 'production', TOKEN_SECRET: SECRET, RAZORPAY_KEY_ID: KEY_ID, RAZORPAY_KEY_SECRET: KEY_SECRET }, async () => {
            const res = makeRes();
            await createPayment(req('POST', {}, CUSTOMER), res);
            assertEqual(res.statusCode, 400, 'status');
        });
    });

    // ============================================================
    // STEP 3 — Razorpay Checkout success -> verify-razorpay
    // ============================================================

    await check('STEP 3: verify-razorpay verifies signature and mints token', async () => {
        const payment = await createPaidOrder();
        const res = await verifyAndGetResultUrl(payment);
        assertEqual(res.statusCode, 200, 'status');
        assertTrue(res._json.verified === true, 'verified');
        const url = new URL('https://example.com' + res._json.resultUrl);
        assertEqual(url.pathname, '/result.html', 'redirects to result.html');
        assertEqual(url.searchParams.get('name'), CUSTOMER.name, 'name param');
        assertEqual(url.searchParams.get('photoHash'), PHOTO, 'photoHash param');
        assertEqual(url.searchParams.get('orderId'), payment.orderId, 'orderId param');
        assertTrue(/^[0-9a-f]{64}$/.test(url.searchParams.get('token')), '64-hex token');
    });

    await check('STEP 3: forged client success claim is rejected', async () => {
        const payment = await createPaidOrder();
        await withEnv({ NODE_ENV: 'production', TOKEN_SECRET: SECRET, RAZORPAY_KEY_SECRET: KEY_SECRET }, async () => {
            const res = makeRes();
            await require('../api/verify-razorpay')(
                req('POST', {}, verifyBody(payment, '0'.repeat(64))),
                res
            );
            assertEqual(res.statusCode, 403, 'forged signature rejected');
            assertTrue(res._json.resultUrl === undefined, 'no unlock URL');
        });
    });

    // ============================================================
    // STEP 4 — result.html loads the reading
    // ============================================================

    await check('STEP 4: result.html renders the reading after verified payment', async () => {
        const resultHtml = readFile('result.html');
        assertTrue(resultHtml.includes('src="js/reveal.js"'), 'reveal.js wired');
        assertTrue(resultHtml.includes('id="reveal-content"'), 'reveal content container');
        assertTrue(resultHtml.includes('id="reveal-denied"'), 'denied container');
        assertTrue(resultHtml.includes('id="reveal-loading"'), 'loading container');
        assertTrue(resultHtml.includes('id="section-core"'), 'core section');
        assertTrue(resultHtml.includes('id="section-love"'), 'love section');
        assertTrue(resultHtml.includes('id="section-pro"'), 'pro section');

        const payment = await createPaidOrder();
        const vres = await verifyAndGetResultUrl(payment);
        const q = new URL('https://example.com' + vres._json.resultUrl).searchParams;
        const res = makeRes();
        await withEnv({ NODE_ENV: 'production', TOKEN_SECRET: SECRET }, async () => {
            await generateReading(req('GET', {
                name: q.get('name'), dob: q.get('dob'), birthplace: q.get('birthplace'),
                tradition: q.get('tradition'), photoHash: q.get('photoHash'),
                orderId: q.get('orderId'), token: q.get('token')
            }), res);
        });
        assertEqual(res.statusCode, 200, 'generate-reading status');
        const reading = res._json.reading;
        assertTrue(reading && typeof reading === 'object', 'reading object');
        assertTrue(typeof reading.core === 'string' && reading.core.length > 0, 'core section non-empty');
        assertTrue(typeof reading.love === 'string' && reading.love.length > 0, 'love section non-empty');
        assertTrue(typeof reading.pro === 'string' && reading.pro.length > 0, 'pro section non-empty');
    });

    // ============================================================
    // STEP 5 — tamper resistance
    // ============================================================

    await check('STEP 5: forged token never unlocks the reading', async () => {
        const res = makeRes();
        await withEnv({ NODE_ENV: 'production', TOKEN_SECRET: SECRET }, async () => {
            await generateReading(req('GET', { ...CUSTOMER, photoHash: PHOTO, orderId: 'PPAA00000024', token: 'f'.repeat(64) }), res);
        });
        assertEqual(res.statusCode, 403, 'forged token rejected');
    });

    await check('STEP 5: tampered reading params invalidate the token', async () => {
        const payment = await createPaidOrder();
        const vres = await verifyAndGetResultUrl(payment);
        const q = new URL('https://example.com' + vres._json.resultUrl).searchParams;
        const res = makeRes();
        await withEnv({ NODE_ENV: 'production', TOKEN_SECRET: SECRET }, async () => {
            // Attacker changes the tradition value; token no longer matches.
            await generateReading(req('GET', {
                name: q.get('name'), dob: q.get('dob'), birthplace: q.get('birthplace'),
                tradition: 'hellenic_changed', photoHash: q.get('photoHash'),
                orderId: q.get('orderId'), token: q.get('token')
            }), res);
        });
        assertEqual(res.statusCode, 403, 'changed params -> token mismatch');
    });

    // ============================================================
    // STEP 6 — revisit / repeat visit (stateless)
    // ============================================================

    await check('STEP 6: repeat visit regenerates the same reading (deterministic)', async () => {
        const payment = await createPaidOrder();
        const vres = await verifyAndGetResultUrl(payment);
        const q = new URL('https://example.com' + vres._json.resultUrl).searchParams;
        const getReading = async () => {
            const res = makeRes();
            await withEnv({ NODE_ENV: 'production', TOKEN_SECRET: SECRET }, async () => {
                await generateReading(req('GET', {
                    name: q.get('name'), dob: q.get('dob'), birthplace: q.get('birthplace'),
                    tradition: q.get('tradition'), photoHash: q.get('photoHash'),
                    orderId: q.get('orderId'), token: q.get('token')
                }), res);
            });
            return res;
        };
        const r1 = await getReading();
        const r2 = await getReading();
        assertEqual(r1.statusCode, 200, 'first visit');
        assertEqual(r2.statusCode, 200, 'second visit');
        assertEqual(r2._json.reading.core, r1._json.reading.core, 'same core reading');
    });

    console.log('\n=== CUSTOMER JOURNEY SUMMARY ===');
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log(`Total: ${passed + failed}`);
    if (failed > 0) process.exit(1);
    console.log('CUSTOMER JOURNEY: ALL STEPS PASSED');
})().catch((err) => {
    console.error('Customer journey verification crashed:', err);
    process.exit(1);
});
