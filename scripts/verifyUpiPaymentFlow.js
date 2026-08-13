/**
 * verifyUpiPaymentFlow.js — payment-flow verification for the Razorpay gateway.
 *
 * NOTE: filename kept from the original direct-UPI flow; this file now verifies
 * the Razorpay checkout flow. Asserts:
 *   1. create-payment creates a REAL Razorpay order (razorpayOrderId, keyId,
 *      amount ₹49) and returns no token / result URL
 *   2. server-side orderId generation (format + uniqueness)
 *   3. hand photo (photoHash) is REQUIRED — frontend can't bypass it
 *   4. verify-razorpay verifies the Razorpay signature server-side and mints a
 *      deterministic HMAC token bound to orderId + photoHash; round-trips
 *   5. verify-razorpay NEVER mints on a forged / tampered signature
 *   6. razorpay-webhook verifies X-Razorpay-Signature (raw body HMAC)
 *   7. no stale UTR / manual-confirmation / Instamojo references in active code;
 *      the old verify-payment and admin-confirm-payment endpoints are deleted
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
const SECRET = 'razorpay-flow-secret';
const KEY_ID = 'rzp_test_publicKeyId';
const KEY_SECRET = 'razorpay-flow-key-secret';
const WEBHOOK_SECRET = 'razorpay-flow-webhook-secret';

const RZ_ORDER = 'order_G7k2L9m4XpQ1aBcD';
const RZ_PAYMENT = 'pay_H3jM5n8PqR2sTvWx';

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

const ENV_KEYS = ['NODE_ENV', 'DEV_BYPASS', 'TOKEN_SECRET', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET', 'PAYMENT_AMOUNT'];

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

function webhookSignature(rawBody) {
    return crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');
}

// rzBody removed: verification request bodies are now built from a REAL
// created order (which carries the signed state token) via obtainPayment()/
// verifyBody() inside the runner below.

(async () => {
    const createPayment = require('../api/create-payment');
    const verifyRazorpay = require('../api/verify-razorpay');
    const razorpayWebhook = require('../api/razorpay-webhook');
    const generateReading = require('../api/generate-reading');

    // Creates a REAL order (mocked Razorpay API) and returns the payment
    // object including its signed state token.
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

    // Builds a valid /api/verify-razorpay request body from a created order,
    // with optional per-test overrides for negative cases.
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
    // 1. create-payment -> REAL Razorpay order
    // ============================================================

    let orderId1, orderId2;
    await check('create-payment: returns a Razorpay order payload (order id, keyId, ₹49), no token', async () => {
        const restore = installFetchMock({ id: RZ_ORDER });
        try {
            await withEnv({ NODE_ENV: 'production', TOKEN_SECRET: SECRET, RAZORPAY_KEY_ID: KEY_ID, RAZORPAY_KEY_SECRET: KEY_SECRET }, async () => {
                const res = makeRes();
                await createPayment(req('POST', {}, { ...CUSTOMER, photoHash: PHOTO }), res);
                assertEqual(res.statusCode, 200, 'status');
                const p = res._json.payment;
                assertEqual(res._json.success, true, 'success flag');
                assertTrue(p && typeof p === 'object', 'payment object');
                assertEqual(p.razorpayOrderId, RZ_ORDER, 'razorpayOrderId echoed from API');
                assertEqual(p.keyId, KEY_ID, 'public keyId returned');
                assertEqual(p.amount, 49, 'amount default 49');
                assertEqual(p.amountPaise, 4900, 'amountPaise = 49*100');
                assertEqual(p.currency, 'INR', 'currency INR');
                assertTrue(typeof p.stateToken === 'string' && p.stateToken.includes('.'), 'short-lived signed state token returned');
                assertEqual(p.stateTokenTtlSeconds, 1800, 'state token TTL is 30 minutes');
                assertTrue(/^PP[0-9A-F]{10}$/.test(p.orderId), `orderId format PP+10hex: ${p.orderId}`);
                assertTrue(res._json.token === undefined, 'must NOT return a token');
                assertTrue(res._json.resultUrl === undefined && res._json.paymentUrl === undefined, 'must NOT return a result/payment URL');
                orderId1 = p.orderId;
            });
        } finally {
            restore();
        }
    });

    await check('create-payment: unique orderId per request', async () => {
        const restore = installFetchMock({ id: RZ_ORDER });
        try {
            await withEnv({ NODE_ENV: 'production', TOKEN_SECRET: SECRET, RAZORPAY_KEY_ID: KEY_ID, RAZORPAY_KEY_SECRET: KEY_SECRET }, async () => {
                const res = makeRes();
                await createPayment(req('POST', {}, { ...CUSTOMER, photoHash: PHOTO }), res);
                orderId2 = res._json.payment.orderId;
                assertTrue(orderId1 !== orderId2, 'orderIds must differ');
            });
        } finally {
            restore();
        }
    });

    await check('create-payment: missing photoHash -> 400 (hand photo REQUIRED, backend-enforced)', async () => {
        await withEnv({ NODE_ENV: 'production', TOKEN_SECRET: SECRET, RAZORPAY_KEY_ID: KEY_ID, RAZORPAY_KEY_SECRET: KEY_SECRET }, async () => {
            const res = makeRes();
            await createPayment(req('POST', {}, CUSTOMER), res);
            assertEqual(res.statusCode, 400, 'status');
            assertTrue(res._json.error.toLowerCase().includes('photo'), 'error mentions photo');
        });
    });

    await check('create-payment: missing RAZORPAY credentials -> 500 config error (no order)', async () => {
        await withEnv({ NODE_ENV: 'production', TOKEN_SECRET: SECRET }, async () => {
            const res = makeRes();
            await createPayment(req('POST', {}, { ...CUSTOMER, photoHash: PHOTO }), res);
            assertEqual(res.statusCode, 500, 'status');
            assertTrue(res._json.error.includes('RAZORPAY_KEY_ID') && res._json.error.includes('RAZORPAY_KEY_SECRET'), 'must mention Razorpay creds');
        });
    });

    // ============================================================
    // 2. verify-razorpay: signature gate + token mint
    // ============================================================

    await check('verify-razorpay: valid Razorpay signature -> mints deterministic token + resultUrl', async () => {
        const payment = await obtainPayment();
        const sig = sigFor(payment);
        const res = makeRes();
        await withEnv({ NODE_ENV: 'production', TOKEN_SECRET: SECRET, RAZORPAY_KEY_SECRET: KEY_SECRET }, async () => {
            await verifyRazorpay(req('POST', {}, verifyBody(payment, sig)), res);
            assertEqual(res.statusCode, 200, 'status');
            assertTrue(res._json.verified === true, 'verified flag');
            const url = new URL('https://example.com' + res._json.resultUrl);
            assertEqual(url.pathname, '/result.html', 'result.html path');
            assertEqual(url.searchParams.get('orderId'), payment.orderId, 'orderId param');
            assertEqual(url.searchParams.get('photoHash'), PHOTO, 'photoHash param');
            const expected = crypto.createHmac('sha256', SECRET)
                .update([CUSTOMER.name, CUSTOMER.dob, CUSTOMER.birthplace, CUSTOMER.tradition, PHOTO, '', payment.orderId].join(':'))
                .digest('hex');
            assertEqual(url.searchParams.get('token'), expected, 'token is HMAC over payload');
        });
    });

    await check('verify-razorpay: deterministic -> same request, same token (no duplicate grant)', async () => {
        const payment = await obtainPayment();
        const sig = sigFor(payment);
        const getToken = async () => {
            const res = makeRes();
            await withEnv({ NODE_ENV: 'production', TOKEN_SECRET: SECRET, RAZORPAY_KEY_SECRET: KEY_SECRET }, async () => {
                await verifyRazorpay(req('POST', {}, verifyBody(payment, sig)), res);
            });
            assertEqual(res.statusCode, 200, 'status');
            return new URL('https://example.com' + res._json.resultUrl).searchParams.get('token');
        };
        const t1 = await getToken();
        const t2 = await getToken();
        assertEqual(t1, t2, 'identical payload -> identical token');
    });

    await check('verify-razorpay: forged client success (bad signature) -> 403, no token', async () => {
        const payment = await obtainPayment();
        await withEnv({ NODE_ENV: 'production', TOKEN_SECRET: SECRET, RAZORPAY_KEY_SECRET: KEY_SECRET }, async () => {
            const res = makeRes();
            await verifyRazorpay(req('POST', {}, verifyBody(payment, '0'.repeat(64))), res);
            assertEqual(res.statusCode, 403, 'status');
            assertTrue(res._json.token === undefined && res._json.resultUrl === undefined, 'no token/resultUrl');
        });
    });

    await check('verify-razorpay: tampered payment id against valid order -> 403', async () => {
        const payment = await obtainPayment();
        await withEnv({ NODE_ENV: 'production', TOKEN_SECRET: SECRET, RAZORPAY_KEY_SECRET: KEY_SECRET }, async () => {
            const res = makeRes();
            await verifyRazorpay(req('POST', {}, verifyBody(payment, sigFor(payment), { razorpayPaymentId: 'pay_aaaaaaaaaaaaaaaa' })), res);
            assertEqual(res.statusCode, 403, 'status');
        });
    });

    await check('verify-razorpay: missing RAZORPAY_KEY_SECRET -> 500', async () => {
        const payment = await obtainPayment();
        await withEnv({ NODE_ENV: 'production', TOKEN_SECRET: SECRET }, async () => {
            const res = makeRes();
            await verifyRazorpay(req('POST', {}, verifyBody(payment, sigFor(payment))), res);
            assertEqual(res.statusCode, 500, 'status');
            assertTrue(res._json.error.includes('RAZORPAY_KEY_SECRET'), 'mentions RAZORPAY_KEY_SECRET');
        });
    });

    await check('verify-razorpay: missing photoHash -> 400 (photo REQUIRED)', async () => {
        const payment = await obtainPayment();
        await withEnv({ NODE_ENV: 'production', TOKEN_SECRET: SECRET, RAZORPAY_KEY_SECRET: KEY_SECRET }, async () => {
            const res = makeRes();
            await verifyRazorpay(req('POST', {}, verifyBody(payment, sigFor(payment), { photoHash: '' })), res);
            assertEqual(res.statusCode, 400, 'status');
        });
    });

    await check('verify-razorpay: missing TOKEN_SECRET -> 500', async () => {
        const payment = await obtainPayment();
        await withEnv({ NODE_ENV: 'production', RAZORPAY_KEY_SECRET: KEY_SECRET }, async () => {
            const res = makeRes();
            await verifyRazorpay(req('POST', {}, verifyBody(payment, sigFor(payment))), res);
            assertEqual(res.statusCode, 500, 'status');
            assertTrue(res._json.error.includes('TOKEN_SECRET'), 'mentions TOKEN_SECRET');
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
        assertTrue(res._json.reading && res._json.reading.core, 'reading present');
    });

    // ============================================================
    // 3. NO auto-grant
    // ============================================================

    await check('NO AUTO-GRANT: orderId alone (no signature) cannot unlock reading', async () => {
        await withEnv({ NODE_ENV: 'production', TOKEN_SECRET: SECRET, RAZORPAY_KEY_SECRET: KEY_SECRET }, async () => {
            const res = makeRes();
            await generateReading(req('GET', { ...CUSTOMER, photoHash: PHOTO, orderId: 'PPAA00000008', token: '' }), res);
            assertEqual(res.statusCode, 403, 'reading stays locked');
        });
    });

    // ============================================================
    // 4. webhook signature verification
    // ============================================================

    const webhookEvent = {
        event: 'payment.captured',
        payload: {
            payment: { entity: { id: RZ_PAYMENT, amount: 4900 } },
            order: { entity: { id: RZ_ORDER } }
        }
    };

    await check('webhook: valid X-Razorpay-Signature (raw body HMAC) -> 200', async () => {
        const rawBody = JSON.stringify(webhookEvent);
        await withEnv({ NODE_ENV: 'production', RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET }, async () => {
            const res = makeRes();
            await razorpayWebhook(req('POST', {}, rawBody, { 'x-razorpay-signature': webhookSignature(rawBody) }), res);
            assertEqual(res.statusCode, 200, 'status');
            assertTrue(res._json.received === true, 'received flag');
            assertTrue(res._json.handled === true, 'handled flag');
        });
    });

    await check('webhook: forged signature -> 401, not trusted', async () => {
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

    await check('webhook: missing RAZORPAY_WEBHOOK_SECRET -> 500 config error', async () => {
        const rawBody = JSON.stringify(webhookEvent);
        await withEnv({ NODE_ENV: 'production' }, async () => {
            const res = makeRes();
            await razorpayWebhook(req('POST', {}, rawBody, { 'x-razorpay-signature': webhookSignature(rawBody) }), res);
            assertEqual(res.statusCode, 500, 'status');
        });
    });

    // ============================================================
    // 5. hygiene: no stale manual-UPI / gateway references
    // ============================================================

    await check('hygiene: old manual endpoints deleted (verify-payment, admin-confirm-payment)', () => {
        assertTrue(!fileExists('api/verify-payment.js'), 'api/verify-payment.js must be deleted');
        assertTrue(!fileExists('api/admin-confirm-payment.js'), 'api/admin-confirm-payment.js must be deleted');
    });

    await check('hygiene: no UTR / manual-confirm / Instamojo references in active code', () => {
        const files = ['api/create-payment.js', 'api/verify-razorpay.js', 'api/razorpay-webhook.js', 'api/generate-reading.js', 'js/checkout.js', 'js/reveal.js', 'js/teaser.js'];
        const banned = [
            'UTR', 'utr', 'verify-payment', 'admin-confirm', 'Payment claim received',
            'payment-panel', 'payment-utr', 'payment-upi-id', 'payment-deeplink',
            'PAYMENT_UPI_ID', 'ADMIN_CONFIRM_SECRET', 'Instamojo', 'INSTAMOJO',
            'longurl', 'payment_request_id'
        ];
        for (const rel of files) {
            const content = readFile(rel);
            for (const b of banned) {
                assertTrue(!content.includes(b), `${rel} must not contain "${b}"`);
            }
        }
        const createPaymentSrc = readFile('api/create-payment.js');
        assertTrue(createPaymentSrc.includes('stateToken'), 'create-payment signs a payment state token');
        assertTrue(!createPaymentSrc.includes('result.html'), 'create-payment must not build result URLs / mint reading tokens');
        assertTrue(!createPaymentSrc.includes('DEV_BYPASS'), 'create-payment must not have a dev bypass grant');
        assertTrue(createPaymentSrc.includes('RAZORPAY_KEY_SECRET'), 'create-payment references key secret server-side only');
    });

    await check('hygiene: index.html requires the hand photo and has no UPI/UTR panel', () => {
        const html = readFile('index.html');
        assertTrue(html.includes('Hand photo (required)'), 'hand photo required label');
        assertTrue(html.includes('accept="image/*" required'), 'photo input required');
        assertTrue(!html.includes('payment-panel'), 'no payment-panel');
        assertTrue(!html.includes('UTR') && !html.includes('utr'), 'no UTR references');
        assertTrue(!html.includes('payment-utr'), 'no payment-utr elements');
    });

    await check('hygiene: env contract (.env.example) documents Razorpay vars, no UPI/admin secret', () => {
        const example = readFile('.env.example');
        assertTrue(example.includes('RAZORPAY_KEY_ID'), 'RAZORPAY_KEY_ID documented');
        assertTrue(example.includes('RAZORPAY_KEY_SECRET'), 'RAZORPAY_KEY_SECRET documented');
        assertTrue(example.includes('RAZORPAY_WEBHOOK_SECRET'), 'RAZORPAY_WEBHOOK_SECRET documented');
        assertTrue(example.includes('TOKEN_SECRET'), 'TOKEN_SECRET documented');
        assertTrue(example.includes('PAYMENT_AMOUNT'), 'PAYMENT_AMOUNT documented');
        assertTrue(!example.includes('PAYMENT_UPI_ID'), 'no PAYMENT_UPI_ID documented');
        assertTrue(!example.includes('ADMIN_CONFIRM_SECRET'), 'no ADMIN_CONFIRM_SECRET documented');
        assertTrue(!example.includes('INSTAMOJO'), 'no INSTAMOJO vars documented');
    });

    console.log('\n=== RAZORPAY PAYMENT FLOW SUMMARY ===');
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log(`Total: ${passed + failed}`);
    if (failed > 0) process.exit(1);
    console.log('RAZORPAY PAYMENT FLOW: ALL CHECKS PASSED');
})().catch((err) => {
    console.error('Razorpay flow verification crashed:', err);
    process.exit(1);
});
