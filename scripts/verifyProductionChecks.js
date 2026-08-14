/**
 * verifyProductionChecks.js — production-oriented checks for the Razorpay flow.
 *
 * NOTE: filename kept from the original direct-UPI flow; this file now verifies
 * the Razorpay gateway. Asserts:
 *   1. create-payment: 405 on GET, 400 on missing/invalid fields, 500 on missing
 *      Razorpay credentials or invalid PAYMENT_AMOUNT, 200 with a real order
 *   2. verify-razorpay: 405/400/500 handling; valid signature -> token+resultUrl;
 *      forged signature -> 403, never grants
 *   3. generate-reading: token REQUIRED in production (even with DEV_BYPASS=true
 *      and NODE_ENV=production), DEV_BYPASS works ONLY in development, forged
 *      token -> 403; full round-trip verify-razorpay -> generate-reading
 *   4. razorpay-webhook: valid raw-body HMAC -> 200, forged/missing -> 401,
 *      missing secret -> 500, 405 on non-POST
 *   5. hygiene: secrets never logged or returned; old manual-confirmation
 *      endpoints gone; env contract documented
 * Prints PASS/FAIL and exits non-zero on any failure.
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
const SECRET = 'prod-secret';
const KEY_ID = 'rzp_test_prodKeyId';
const KEY_SECRET = 'prod-key-secret';
const WEBHOOK_SECRET = 'prod-wh-secret';

const RZ_ORDER = 'order_PROD12345678901';
const RZ_PAYMENT = 'pay_PROD12345678901';

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

function fileExists(rel) {
    return fs.existsSync(path.join(ROOT, rel));
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

// rzBody removed: verification request bodies are now built from a REAL
// created order (which carries the signed state token) via obtainPayment()/
// verifyBody() inside the runner below.

(async () => {
    const createPayment = require('../api/create-payment');
    const verifyRazorpay = require('../api/verify-razorpay');
    const razorpayWebhook = require('../api/razorpay-webhook');
    const generateReading = require('../api/generate-reading');

    async function obtainPayment(env) {
        const restore = installFetchMock({ id: RZ_ORDER });
        try {
            let payment = null;
            await withEnv({ NODE_ENV: 'production', TOKEN_SECRET: SECRET, RAZORPAY_KEY_ID: KEY_ID, RAZORPAY_KEY_SECRET: KEY_SECRET, ...(env || {}) }, async () => {
                const res = makeRes();
                await createPayment(req('POST', {}, { ...CUSTOMER, photoHash: PHOTO }), res);
                assertEqual(res.statusCode, 200, 'create-payment status while preparing order');
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

    function sigFor(payment, paymentId) {
        return rzSignature(payment.razorpayOrderId, paymentId || RZ_PAYMENT);
    }

    // ============================================================
    // 1. create-payment
    // ============================================================

    await check('create-payment: GET -> 405', async () => {
        await withEnv({ NODE_ENV: 'production', TOKEN_SECRET: SECRET, RAZORPAY_KEY_ID: KEY_ID, RAZORPAY_KEY_SECRET: KEY_SECRET }, async () => {
            const res = makeRes();
            await createPayment(req('GET'), res);
            assertEqual(res.statusCode, 405, 'status');
        });
    });

    await check('create-payment: missing name/dob/birthplace -> 400', async () => {
        await withEnv({ NODE_ENV: 'production', TOKEN_SECRET: SECRET, RAZORPAY_KEY_ID: KEY_ID, RAZORPAY_KEY_SECRET: KEY_SECRET }, async () => {
            const res = makeRes();
            await createPayment(req('POST', {}, { name: '', dob: '', birthplace: '' }), res);
            assertEqual(res.statusCode, 400, 'status');
        });
    });

    await check('create-payment: missing photoHash -> 400', async () => {
        await withEnv({ NODE_ENV: 'production', TOKEN_SECRET: SECRET, RAZORPAY_KEY_ID: KEY_ID, RAZORPAY_KEY_SECRET: KEY_SECRET }, async () => {
            const res = makeRes();
            await createPayment(req('POST', {}, CUSTOMER), res);
            assertEqual(res.statusCode, 400, 'status');
        });
    });

    await check('create-payment: invalid photoHash -> 400', async () => {
        await withEnv({ NODE_ENV: 'production', TOKEN_SECRET: SECRET, RAZORPAY_KEY_ID: KEY_ID, RAZORPAY_KEY_SECRET: KEY_SECRET }, async () => {
            const res = makeRes();
            await createPayment(req('POST', {}, { ...CUSTOMER, photoHash: 'xyz' }), res);
            assertEqual(res.statusCode, 400, 'status');
        });
    });

    await check('create-payment: missing Razorpay credentials -> 500 (fails closed)', async () => {
        await withEnv({ NODE_ENV: 'production', TOKEN_SECRET: SECRET }, async () => {
            const res = makeRes();
            await createPayment(req('POST', {}, { ...CUSTOMER, photoHash: PHOTO }), res);
            assertEqual(res.statusCode, 500, 'status');
        });
    });

    await check('create-payment: invalid PAYMENT_AMOUNT -> 500 (fails closed)', async () => {
        await withEnv({ NODE_ENV: 'production', TOKEN_SECRET: SECRET, RAZORPAY_KEY_ID: KEY_ID, RAZORPAY_KEY_SECRET: KEY_SECRET, PAYMENT_AMOUNT: 'abc' }, async () => {
            const res = makeRes();
            await createPayment(req('POST', {}, { ...CUSTOMER, photoHash: PHOTO }), res);
            assertEqual(res.statusCode, 500, 'status');
        });
    });

    await check('create-payment: success -> 200 with real order, never leaks secret', async () => {
        const restore = installFetchMock({ id: RZ_ORDER });
        try {
            await withEnv({ NODE_ENV: 'production', TOKEN_SECRET: SECRET, RAZORPAY_KEY_ID: KEY_ID, RAZORPAY_KEY_SECRET: KEY_SECRET, PAYMENT_AMOUNT: '20' }, async () => {
                const res = makeRes();
                await createPayment(req('POST', {}, { ...CUSTOMER, photoHash: PHOTO }), res);
                assertEqual(res.statusCode, 200, 'status');
                const p = res._json.payment;
                assertEqual(p.razorpayOrderId, RZ_ORDER, 'order id');
                assertEqual(p.keyId, KEY_ID, 'public keyId returned');
                assertEqual(p.amountPaise, 2000, 'amountPaise');
                const serialized = JSON.stringify(res._json);
                assertTrue(!serialized.includes(KEY_SECRET), 'KEY_SECRET must never appear in response');
                assertTrue(!serialized.includes('keySecret'), 'keySecret field must not exist');
                assertTrue(res._json.token === undefined && res._json.resultUrl === undefined, 'no auto-grant');
            });
        } finally {
            restore();
        }
    });

    // ============================================================
    // 2. verify-razorpay
    // ============================================================

    await check('verify-razorpay: GET -> 405', async () => {
        await withEnv({ NODE_ENV: 'production', TOKEN_SECRET: SECRET, RAZORPAY_KEY_SECRET: KEY_SECRET }, async () => {
            const res = makeRes();
            await verifyRazorpay(req('GET'), res);
            assertEqual(res.statusCode, 405, 'status');
        });
    });

    await check('verify-razorpay: valid signature -> 200, token + resultUrl', async () => {
        const payment = await obtainPayment();
        await withEnv({ NODE_ENV: 'production', TOKEN_SECRET: SECRET, RAZORPAY_KEY_SECRET: KEY_SECRET }, async () => {
            const res = makeRes();
            await verifyRazorpay(req('POST', {}, verifyBody(payment, sigFor(payment))), res);
            assertEqual(res.statusCode, 200, 'status');
            assertTrue(res._json.verified === true, 'verified');
            const url = new URL('https://example.com' + res._json.resultUrl);
            assertEqual(url.searchParams.get('orderId'), payment.orderId, 'orderId param');
            assertTrue(url.searchParams.get('token').length === 64, '64-hex token');
        });
    });

    await check('verify-razorpay: forged signature -> 403, never grants', async () => {
        const payment = await obtainPayment();
        await withEnv({ NODE_ENV: 'production', TOKEN_SECRET: SECRET, RAZORPAY_KEY_SECRET: KEY_SECRET }, async () => {
            const res = makeRes();
            await verifyRazorpay(req('POST', {}, verifyBody(payment, 'f'.repeat(64))), res);
            assertEqual(res.statusCode, 403, 'status');
            assertTrue(res._json.token === undefined && res._json.resultUrl === undefined, 'no grant');
        });
    });

    await check('verify-razorpay: missing RAZORPAY_KEY_SECRET -> 500', async () => {
        const payment = await obtainPayment();
        await withEnv({ NODE_ENV: 'production', TOKEN_SECRET: SECRET }, async () => {
            const res = makeRes();
            await verifyRazorpay(req('POST', {}, verifyBody(payment, sigFor(payment))), res);
            assertEqual(res.statusCode, 500, 'status');
        });
    });

    await check('verify-razorpay: missing TOKEN_SECRET -> 500', async () => {
        const payment = await obtainPayment();
        await withEnv({ NODE_ENV: 'production', RAZORPAY_KEY_SECRET: KEY_SECRET }, async () => {
            const res = makeRes();
            await verifyRazorpay(req('POST', {}, verifyBody(payment, sigFor(payment))), res);
            assertEqual(res.statusCode, 500, 'status');
        });
    });

    await check('verify-razorpay: orderId not matching the signed order -> 400', async () => {
        const payment = await obtainPayment();
        await withEnv({ NODE_ENV: 'production', TOKEN_SECRET: SECRET, RAZORPAY_KEY_SECRET: KEY_SECRET }, async () => {
            const res = makeRes();
            await verifyRazorpay(req('POST', {}, verifyBody(payment, sigFor(payment), { orderId: 'abc' })), res);
            assertEqual(res.statusCode, 400, 'status');
        });
    });

    // ============================================================
    // 3. generate-reading: production token gate + dev bypass
    // ============================================================

    await check('generate-reading: no token + NODE_ENV=production -> 403 even with DEV_BYPASS=true', async () => {
        await withEnv({ NODE_ENV: 'production', DEV_BYPASS: 'true', TOKEN_SECRET: SECRET }, async () => {
            const res = makeRes();
            await generateReading(req('GET', { ...CUSTOMER, photoHash: PHOTO, orderId: 'PPAA00000015', token: '' }), res);
            assertEqual(res.statusCode, 403, 'bypass must not apply in production');
        });
    });

    await check('generate-reading: DEV_BYPASS applies ONLY in development', async () => {
        await withEnv({ NODE_ENV: 'development', DEV_BYPASS: 'true', TOKEN_SECRET: SECRET }, async () => {
            const res = makeRes();
            await generateReading(req('GET', { ...CUSTOMER, photoHash: PHOTO, orderId: 'PPAA00000016', token: '' }), res);
            assertEqual(res.statusCode, 200, 'local dev bypass allowed');
        });
    });

    await check('generate-reading: forged token -> 403', async () => {
        await withEnv({ NODE_ENV: 'production', TOKEN_SECRET: SECRET }, async () => {
            const res = makeRes();
            await generateReading(req('GET', { ...CUSTOMER, photoHash: PHOTO, orderId: 'PPAA00000017', token: 'f'.repeat(64) }), res);
            assertEqual(res.statusCode, 403, 'status');
        });
    });

    await check('round-trip: verify-razorpay resultUrl -> generate-reading 200', async () => {
        const payment = await obtainPayment();
        const sig = sigFor(payment);
        let resultUrl;
        await withEnv({ NODE_ENV: 'production', TOKEN_SECRET: SECRET, RAZORPAY_KEY_SECRET: KEY_SECRET }, async () => {
            const res = makeRes();
            await verifyRazorpay(req('POST', {}, verifyBody(payment, sig)), res);
            resultUrl = res._json.resultUrl;
        });
        const q = new URL('https://example.com' + resultUrl).searchParams;
        const res = makeRes();
        await withEnv({ NODE_ENV: 'production', TOKEN_SECRET: SECRET }, async () => {
            await generateReading(req('GET', {
                name: q.get('name'), dob: q.get('dob'), birthplace: q.get('birthplace'),
                tradition: q.get('tradition'), photoHash: q.get('photoHash'),
                orderId: q.get('orderId'), token: q.get('token')
            }), res);
        });
        assertEqual(res.statusCode, 200, 'status');
        assertTrue(res._json.reading && res._json.reading.core && res._json.reading.love && res._json.reading.pro, 'full reading');
    });

    // ============================================================
    // 4. razorpay-webhook
    // ============================================================

    const webhookEvent = {
        event: 'payment.captured',
        payload: {
            payment: { entity: { id: RZ_PAYMENT, amount: 2000 } },
            order: { entity: { id: RZ_ORDER } }
        }
    };

    await check('webhook: GET -> 405', async () => {
        await withEnv({ NODE_ENV: 'production', RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET }, async () => {
            const res = makeRes();
            await razorpayWebhook(req('GET'), res);
            assertEqual(res.statusCode, 405, 'status');
        });
    });

    await check('webhook: valid raw-body HMAC -> 200 handled', async () => {
        const rawBody = JSON.stringify(webhookEvent);
        const sig = crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');
        await withEnv({ NODE_ENV: 'production', RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET }, async () => {
            const res = makeRes();
            await razorpayWebhook(req('POST', {}, rawBody, { 'x-razorpay-signature': sig }), res);
            assertEqual(res.statusCode, 200, 'status');
            assertTrue(res._json.handled === true, 'handled');
        });
    });

    await check('webhook: forged signature -> 401', async () => {
        const rawBody = JSON.stringify(webhookEvent);
        await withEnv({ NODE_ENV: 'production', RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET }, async () => {
            const res = makeRes();
            await razorpayWebhook(req('POST', {}, rawBody, { 'x-razorpay-signature': 'f'.repeat(64) }), res);
            assertEqual(res.statusCode, 401, 'status');
        });
    });

    await check('webhook: missing signature header -> 401', async () => {
        await withEnv({ NODE_ENV: 'production', RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET }, async () => {
            const res = makeRes();
            await razorpayWebhook(req('POST', {}, JSON.stringify(webhookEvent)), res);
            assertEqual(res.statusCode, 401, 'status');
        });
    });

    await check('webhook: missing RAZORPAY_WEBHOOK_SECRET -> 500', async () => {
        const rawBody = JSON.stringify(webhookEvent);
        const sig = crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');
        await withEnv({ NODE_ENV: 'production' }, async () => {
            const res = makeRes();
            await razorpayWebhook(req('POST', {}, rawBody, { 'x-razorpay-signature': sig }), res);
            assertEqual(res.statusCode, 500, 'status');
        });
    });

    // ============================================================
    // 5. hygiene / secrets
    // ============================================================

    await check('secrets: never logged in create-payment / verify-razorpay', () => {
        for (const rel of ['api/create-payment.js', 'api/verify-razorpay.js']) {
            const src = readFile(rel);
            assertTrue(!/console\.log[^\n]*RAZORPAY_KEY_SECRET/.test(src), `${rel} must not log RAZORPAY_KEY_SECRET`);
            assertTrue(!/RAZORPAY_KEY_SECRET[^\n]*console\.log/.test(src), `${rel} must not log RAZORPAY_KEY_SECRET`);
            assertTrue(!/console\.log[^\n]*TOKEN_SECRET/.test(src), `${rel} must not log TOKEN_SECRET`);
        }
    });

    await check('hygiene: old manual endpoints deleted', () => {
        assertTrue(!fileExists('api/verify-payment.js'), 'verify-payment.js deleted');
        assertTrue(!fileExists('api/admin-confirm-payment.js'), 'admin-confirm-payment.js deleted');
    });

    await check('hygiene: no ADMIN_CONFIRM_SECRET / PAYMENT_UPI_ID anywhere in active code', () => {
        const files = ['api/create-payment.js', 'api/verify-razorpay.js', 'api/razorpay-webhook.js', 'api/generate-reading.js', 'js/checkout.js', 'js/teaser.js', 'js/reveal.js', 'index.html', 'result.html', '.env.example'];
        for (const rel of files) {
            const content = readFile(rel);
            assertTrue(!content.includes('ADMIN_CONFIRM_SECRET'), `${rel} must not reference ADMIN_CONFIRM_SECRET`);
            assertTrue(!content.includes('PAYMENT_UPI_ID'), `${rel} must not reference PAYMENT_UPI_ID`);
            assertTrue(!content.includes('UTR'), `${rel} must not reference UTR`);
        }
    });

    await check('hygiene: env contract documents all required Razorpay vars', () => {
        const example = readFile('.env.example');
        for (const v of ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET', 'TOKEN_SECRET', 'PAYMENT_AMOUNT']) {
            assertTrue(example.includes(v), `.env.example documents ${v}`);
        }
    });

    console.log('\n=== PRODUCTION CHECKS SUMMARY ===');
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log(`Total: ${passed + failed}`);
    if (failed > 0) process.exit(1);
    console.log('PRODUCTION CHECKS: ALL PASSED');
})().catch((err) => {
    console.error('Production checks crashed:', err);
    process.exit(1);
});
