/**
 * verifyRazorpaySecurity.js — explicit order-to-reading-payload security tests
 * for the Razorpay migration, run against the REAL handlers:
 *   api/create-payment.js, api/verify-razorpay.js, api/razorpay-webhook.js,
 *   lib/stateToken.js, lib/paymentConfig.js, api/generate-reading.js.
 *
 * Cases 1-14 are the deployment gate (from the security verification request):
 *   1  Correct payment + original payload            -> SUCCESS
 *   2  Same paid order + modified name               -> REJECTED
 *   3  Same paid order + modified DOB                -> REJECTED
 *   4  Same paid order + modified birthplace         -> REJECTED
 *   5  Same paid order + modified tradition          -> REJECTED
 *   6  Same paid order + modified photoHash          -> REJECTED
 *   7  Same paid payment + modified orderId          -> REJECTED
 *   8  Amount other than ₹20 / 2000 paise            -> REJECTED
 *   9  Expired state token                           -> REJECTED
 *   10 Tampered state token                          -> REJECTED
 *   11 Invalid Razorpay payment signature            -> REJECTED
 *   12 Different payment ID                          -> REJECTED
 *   13 Different Razorpay order ID                   -> REJECTED
 *   14 Missing photoHash                             -> REJECTED
 *
 * Architectural requirements A-M are asserted at the end (source-level greps
 * plus behavioral tests). This file never weakens or deletes existing tests;
 * it is additive. Exits non-zero on any failure.
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

function assertNoGrant(res, msg) {
    const json = res._json || {};
    assertTrue(json.token === undefined, `${msg}: must not return a reading token`);
    assertTrue(json.resultUrl === undefined, `${msg}: must not return a resultUrl`);
}

const ROOT = path.join(__dirname, '..');
const SECRET = 'sec-test-secret';
const KEY_ID = 'rzp_test_securityKeyId';
const KEY_SECRET = 'sec-key-secret';
const WEBHOOK_SECRET = 'sec-wh-secret';

const RZ_ORDER = 'order_SEC1234567890ABC';
const RZ_PAYMENT = 'pay_SEC1234567890ABC';

const CUSTOMER = { name: 'Aarav Nair', dob: '1988-06-17', birthplace: 'Thiruvananthapuram', tradition: 'vedic' };
const PHOTO = 'a'.repeat(64);
const OTHER_PHOTO = 'b'.repeat(64);

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

(async () => {
    const createPayment = require('../api/create-payment');
    const verifyRazorpay = require('../api/verify-razorpay');
    const razorpayWebhook = require('../api/razorpay-webhook');
    const generateReading = require('../api/generate-reading');
    const stateToken = require('../lib/stateToken');

    // Creates a REAL order through api/create-payment (Razorpay mocked). The
    // returned payment carries the server-signed state token + razorpayOrderId.
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

    async function callVerify(body, env) {
        const res = makeRes();
        await withEnv({ NODE_ENV: 'production', TOKEN_SECRET: SECRET, RAZORPAY_KEY_SECRET: KEY_SECRET, ...(env || {}) }, async () => {
            await verifyRazorpay(req('POST', {}, body), res);
        });
        return res;
    }

    function signStateToken(payload) {
        return stateToken.sign(payload, SECRET);
    }

    const nowSeconds = () => Math.floor(Date.now() / 1000);

    // ============================================================
    // CASE 1 — correct payment + original reading payload -> SUCCESS
    // ============================================================
    await check('CASE 1: valid paid order + original payload -> 200, token minted', async () => {
        const payment = await obtainPayment();
        const res = await callVerify(verifyBody(payment, sigFor(payment)));
        assertEqual(res.statusCode, 200, 'status');
        assertTrue(res._json.verified === true, 'verified');
        assertTrue(typeof res._json.resultUrl === 'string' && res._json.resultUrl.startsWith('/result.html?'), 'resultUrl');
        const q = new URL('https://example.com' + res._json.resultUrl).searchParams;
        assertEqual(q.get('name'), CUSTOMER.name, 'name');
        assertEqual(q.get('dob'), CUSTOMER.dob, 'dob');
        assertEqual(q.get('birthplace'), CUSTOMER.birthplace, 'birthplace');
        assertEqual(q.get('tradition'), CUSTOMER.tradition, 'tradition');
        assertEqual(q.get('photoHash'), PHOTO, 'photoHash');
        assertEqual(q.get('orderId'), payment.orderId, 'orderId');
        assertTrue(/^[0-9a-f]{64}$/.test(q.get('token')), '64-hex reading token');
    });

    // ============================================================
    // CASES 2-7 — same paid order, one reading field modified
    // ============================================================
    await check('CASE 2: same paid order + modified name -> REJECTED', async () => {
        const payment = await obtainPayment();
        const res = await callVerify(verifyBody(payment, sigFor(payment), { name: 'Ravi Changed' }));
        assertEqual(res.statusCode, 400, 'status');
        assertNoGrant(res, 'modified name');
    });

    await check('CASE 3: same paid order + modified DOB -> REJECTED', async () => {
        const payment = await obtainPayment();
        const res = await callVerify(verifyBody(payment, sigFor(payment), { dob: '1990-01-01' }));
        assertEqual(res.statusCode, 400, 'status');
        assertNoGrant(res, 'modified DOB');
    });

    await check('CASE 4: same paid order + modified birthplace -> REJECTED', async () => {
        const payment = await obtainPayment();
        const res = await callVerify(verifyBody(payment, sigFor(payment), { birthplace: 'Mumbai' }));
        assertEqual(res.statusCode, 400, 'status');
        assertNoGrant(res, 'modified birthplace');
    });

    await check('CASE 5: same paid order + modified tradition -> REJECTED', async () => {
        const payment = await obtainPayment();
        const res = await callVerify(verifyBody(payment, sigFor(payment), { tradition: 'hellenic' }));
        assertEqual(res.statusCode, 400, 'status');
        assertNoGrant(res, 'modified tradition');
    });

    await check('CASE 6: same paid order + modified photoHash -> REJECTED', async () => {
        const payment = await obtainPayment();
        const res = await callVerify(verifyBody(payment, sigFor(payment), { photoHash: OTHER_PHOTO }));
        assertEqual(res.statusCode, 400, 'status');
        assertNoGrant(res, 'modified photoHash');
    });

    await check('CASE 7: same paid payment + modified orderId -> REJECTED', async () => {
        const payment = await obtainPayment();
        const res = await callVerify(verifyBody(payment, sigFor(payment), { orderId: 'PPAAAAAAAAAA' }));
        assertEqual(res.statusCode, 400, 'status');
        assertNoGrant(res, 'modified orderId');
    });

    // ============================================================
    // CASE 8 — amount other than ₹20 / 2000 paise -> REJECTED
    // ============================================================
    await check('CASE 8: order created at ₹20 / 2000 paise verifies at default ₹20 -> SUCCESS', async () => {
        const payment = await obtainPayment(); // state token records amount=20, amountPaise=2000
        const res = await callVerify(verifyBody(payment, sigFor(payment))); // verify with default ₹20
        assertEqual(res.statusCode, 200, 'status');
        assertTrue(res._json.verified === true, 'verified');
    });

    await check('CASE 8: order created at ₹49 / 4900 paise cannot verify at default ₹20 (amount mismatch) -> REJECTED', async () => {
        const payment = await obtainPayment({ PAYMENT_AMOUNT: '49' }); // state token records amount=49
        const res = await callVerify(verifyBody(payment, sigFor(payment))); // verify with default ₹20
        assertEqual(res.statusCode, 403, 'status');
        assertNoGrant(res, 'amount mismatch');
    });

    await check('CASE 8: order created at ₹50 cannot verify at default ₹20 (amount mismatch) -> REJECTED', async () => {
        const payment = await obtainPayment({ PAYMENT_AMOUNT: '50' }); // state token records amount=50
        const res = await callVerify(verifyBody(payment, sigFor(payment))); // verify with default ₹20
        assertEqual(res.statusCode, 403, 'status');
        assertNoGrant(res, 'amount mismatch');
    });

    await check('CASE 8: state token with amount=0 is rejected -> REJECTED', async () => {
        const payment = await obtainPayment();
        const forged = signStateToken({
            v: 1, razorpayOrderId: payment.razorpayOrderId,
            name: CUSTOMER.name, dob: CUSTOMER.dob, birthplace: CUSTOMER.birthplace,
            tradition: CUSTOMER.tradition, photoHash: PHOTO, orderId: payment.orderId,
            amount: 0, amountPaise: 0, currency: 'INR',
            iat: nowSeconds(), exp: nowSeconds() + stateToken.TTL_SECONDS
        });
        const res = await callVerify(verifyBody(payment, sigFor(payment), { stateToken: forged }));
        assertEqual(res.statusCode, 403, 'status');
        assertNoGrant(res, 'zero amount');
    });

    // ============================================================
    // CASES 9-10 — expired / tampered state token -> REJECTED
    // ============================================================
    await check('CASE 9: expired state token -> REJECTED', async () => {
        const payment = await obtainPayment();
        const now = nowSeconds();
        const expired = signStateToken({
            v: 1, razorpayOrderId: payment.razorpayOrderId,
            name: CUSTOMER.name, dob: CUSTOMER.dob, birthplace: CUSTOMER.birthplace,
            tradition: CUSTOMER.tradition, photoHash: PHOTO, orderId: payment.orderId,
            amount: 20, amountPaise: 2000, currency: 'INR',
            iat: now - 200, exp: now - 100 // already expired
        });
        const res = await callVerify(verifyBody(payment, sigFor(payment), { stateToken: expired }));
        assertEqual(res.statusCode, 403, 'status');
        assertNoGrant(res, 'expired state token');
    });

    await check('CASE 10: tampered state token (payload bit-flip) -> REJECTED', async () => {
        const payment = await obtainPayment();
        const token = payment.stateToken;
        const idx = token.lastIndexOf('.');
        const flip = token[idx - 1] === 'A' ? 'B' : 'A';
        const tampered = token.slice(0, idx - 1) + flip + token.slice(idx);
        const res = await callVerify(verifyBody(payment, sigFor(payment), { stateToken: tampered }));
        assertEqual(res.statusCode, 403, 'status');
        assertNoGrant(res, 'tampered payload');
    });

    await check('CASE 10: tampered state token (signature bit-flip) -> REJECTED', async () => {
        const payment = await obtainPayment();
        const token = payment.stateToken;
        const idx = token.lastIndexOf('.');
        const sigFlip = (token[idx + 1] === '0' ? '1' : '0');
        const tampered = token.slice(0, idx + 1) + sigFlip + token.slice(idx + 2);
        const res = await callVerify(verifyBody(payment, sigFor(payment), { stateToken: tampered }));
        assertEqual(res.statusCode, 403, 'status');
        assertNoGrant(res, 'tampered signature');
    });

    // ============================================================
    // CASES 11-13 — invalid payment signature / payment ID / order ID
    // ============================================================
    await check('CASE 11: invalid Razorpay payment signature -> REJECTED', async () => {
        const payment = await obtainPayment();
        const res = await callVerify(verifyBody(payment, '0'.repeat(64)));
        assertEqual(res.statusCode, 403, 'status');
        assertNoGrant(res, 'invalid signature');
    });

    await check('CASE 12: same order + different payment ID -> REJECTED', async () => {
        const payment = await obtainPayment();
        // Keep the original (valid) signature but swap the payment ID: the HMAC
        // message changes and verification must fail.
        const res = await callVerify(verifyBody(payment, sigFor(payment), { razorpayPaymentId: 'pay_OTHER1234567890' }));
        assertEqual(res.statusCode, 403, 'status');
        assertNoGrant(res, 'different payment id');
    });

    await check('CASE 13: different Razorpay order ID (original sig) -> REJECTED', async () => {
        const payment = await obtainPayment();
        const res = await callVerify(verifyBody(payment, sigFor(payment), { razorpayOrderId: 'order_SWAPPED12345678' }));
        assertEqual(res.statusCode, 403, 'status');
        assertNoGrant(res, 'different order id');
    });

    await check('CASE 13: different Razorpay order ID (even with matching sig for that order) -> REJECTED', async () => {
        const payment = await obtainPayment();
        // Signature is recomputed for the swapped order id, yet the request is
        // rejected because the state token binds the ORIGINAL razorpayOrderId.
        const swapped = 'order_SWAPPED12345678';
        const res = await callVerify(verifyBody(payment, rzSignature(swapped, RZ_PAYMENT), { razorpayOrderId: swapped }));
        assertEqual(res.statusCode, 403, 'status');
        assertNoGrant(res, 'different order id with valid sig');
    });

    // ============================================================
    // CASE 14 — missing photoHash -> REJECTED
    // ============================================================
    await check('CASE 14: create-payment without photoHash -> REJECTED', async () => {
        const restore = installFetchMock({ id: RZ_ORDER });
        try {
            await withEnv({ NODE_ENV: 'production', TOKEN_SECRET: SECRET, RAZORPAY_KEY_ID: KEY_ID, RAZORPAY_KEY_SECRET: KEY_SECRET }, async () => {
                const res = makeRes();
                await createPayment(req('POST', {}, CUSTOMER), res);
                assertEqual(res.statusCode, 400, 'status');
            });
        } finally {
            restore();
        }
    });

    await check('CASE 14: verify-razorpay without photoHash -> REJECTED', async () => {
        const payment = await obtainPayment();
        const body = verifyBody(payment, sigFor(payment));
        delete body.photoHash;
        const res = await callVerify(body);
        assertEqual(res.statusCode, 400, 'status');
        assertNoGrant(res, 'missing photoHash');
    });

    // ============================================================
    // Architectural: H — token minted ONLY after server-side verification
    // ============================================================
    await check('ARCH H: forged signature yields no token AND token never works', async () => {
        const payment = await obtainPayment();
        const forged = await callVerify(verifyBody(payment, 'f'.repeat(64)));
        assertEqual(forged.statusCode, 403, 'forged status');
        assertNoGrant(forged, 'forged');

        const good = await callVerify(verifyBody(payment, sigFor(payment)));
        assertEqual(good.statusCode, 200, 'good status');
        const q = new URL('https://example.com' + good._json.resultUrl).searchParams;
        const res = makeRes();
        await withEnv({ NODE_ENV: 'production', TOKEN_SECRET: SECRET }, async () => {
            await generateReading(req('GET', {
                name: q.get('name'), dob: q.get('dob'), birthplace: q.get('birthplace'),
                tradition: q.get('tradition'), photoHash: q.get('photoHash'),
                orderId: q.get('orderId'), token: q.get('token')
            }), res);
        });
        assertEqual(res.statusCode, 200, 'verified token unlocks reading');
    });

    // ============================================================
    // Architectural: J — INR currency enforced server-side
    // ============================================================
    await check('ARCH J: state token with non-INR currency -> REJECTED', async () => {
        const payment = await obtainPayment();
        const usd = signStateToken({
            v: 1, razorpayOrderId: payment.razorpayOrderId,
            name: CUSTOMER.name, dob: CUSTOMER.dob, birthplace: CUSTOMER.birthplace,
            tradition: CUSTOMER.tradition, photoHash: PHOTO, orderId: payment.orderId,
            amount: 20, amountPaise: 2000, currency: 'USD',
            iat: nowSeconds(), exp: nowSeconds() + stateToken.TTL_SECONDS
        });
        const res = await callVerify(verifyBody(payment, sigFor(payment), { stateToken: usd }));
        assertEqual(res.statusCode, 403, 'status');
        assertNoGrant(res, 'non-INR currency');
    });

    // ============================================================
    // Architectural: I — ₹20 enforced server-side at order creation
    // ============================================================
    await check('ARCH I: create-payment always creates order at expected ₹20', async () => {
        const restore = installFetchMock({ id: RZ_ORDER });
        try {
            await withEnv({ NODE_ENV: 'production', TOKEN_SECRET: SECRET, RAZORPAY_KEY_ID: KEY_ID, RAZORPAY_KEY_SECRET: KEY_SECRET }, async () => {
                const res = makeRes();
                await createPayment(req('POST', {}, { ...CUSTOMER, photoHash: PHOTO }), res);
                assertEqual(res.statusCode, 200, 'status');
                assertEqual(res._json.payment.amount, 20, 'rupees');
                assertEqual(res._json.payment.amountPaise, 2000, 'paise');
                assertEqual(res._json.payment.currency, 'INR', 'currency');
            });
        } finally {
            restore();
        }
    });

    // ============================================================
    // Architectural: L — webhook signature verified over RAW body
    // ============================================================
    const webhookEvent = {
        event: 'payment.captured',
        payload: { payment: { entity: { id: RZ_PAYMENT, amount: 2000 } }, order: { entity: { id: RZ_ORDER } } }
    };

    await check('ARCH L: webhook valid raw-body HMAC -> 200', async () => {
        const rawBody = JSON.stringify(webhookEvent);
        const sig = crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');
        await withEnv({ NODE_ENV: 'production', RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET }, async () => {
            const res = makeRes();
            await razorpayWebhook(req('POST', {}, rawBody, { 'x-razorpay-signature': sig }), res);
            assertEqual(res.statusCode, 200, 'status');
            assertTrue(res._json.handled === true, 'handled');
        });
    });

    await check('ARCH L: re-serialized body (different raw bytes) fails raw-body HMAC -> 401', async () => {
        const rawBody = JSON.stringify(webhookEvent);
        const sig = crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');
        // Same parsed JSON object, different raw bytes (extra whitespace). A
        // signature computed over re-serialized JSON would match; raw-body
        // verification must NOT.
        const reserialized = rawBody.replace('{', '{ ');
        assertEqual(JSON.parse(reserialized).event, webhookEvent.event, 'same parsed event');
        assertTrue(reserialized !== rawBody, 'raw bytes differ');
        await withEnv({ NODE_ENV: 'production', RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET }, async () => {
            const res = makeRes();
            await razorpayWebhook(req('POST', {}, reserialized, { 'x-razorpay-signature': sig }), res);
            assertEqual(res.statusCode, 401, 'status');
        });
    });

    await check('ARCH L: webhook with wrong secret -> 401', async () => {
        const rawBody = JSON.stringify(webhookEvent);
        const sig = crypto.createHmac('sha256', 'wrong-secret').update(rawBody).digest('hex');
        await withEnv({ NODE_ENV: 'production', RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET }, async () => {
            const res = makeRes();
            await razorpayWebhook(req('POST', {}, rawBody, { 'x-razorpay-signature': sig }), res);
            assertEqual(res.statusCode, 401, 'status');
        });
    });

    // ============================================================
    // Architectural: M — webhook cannot mint reading tokens
    // ============================================================
    await check('ARCH M: verified webhook response never grants a reading token', async () => {
        const rawBody = JSON.stringify(webhookEvent);
        const sig = crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');
        await withEnv({ NODE_ENV: 'production', RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET }, async () => {
            const res = makeRes();
            await razorpayWebhook(req('POST', {}, rawBody, { 'x-razorpay-signature': sig }), res);
            assertEqual(res.statusCode, 200, 'status');
            assertNoGrant(res, 'webhook');
            assertTrue(res._json.token === undefined && res._json.resultUrl === undefined && res._json.stateToken === undefined, 'no unlock data');
        });
    });

    await check('ARCH M: webhook handler contains no token-minting / generate-reading calls', () => {
        const src = readFile('api/razorpay-webhook.js');
        assertTrue(!src.includes('generate-reading') && !src.includes('generateReading'), 'no reading generator call');
        assertTrue(!src.includes('resultUrl'), 'no resultUrl construction');
        assertTrue(!src.includes('reading token'), 'no reading token minting');
    });

    // ============================================================
    // Architectural: A, B, C — stateless, no DB, no accounts
    // ============================================================
    function stripComments(src) {
        // Remove /* ... */ and // ... comments (including trailing ones) so
        // explanatory comments cannot cause false positives.
        let out = src.replace(/\/\*[\s\S]*?\*\//g, '');
        out = out.replace(/(^|[^:"'\\])\/\/[^\n]*/g, '$1');
        return out;
    }

    await check('ARCH A/B: active code has no database (stateless)', () => {
        const files = ['api/create-payment.js', 'api/verify-razorpay.js', 'api/razorpay-webhook.js', 'api/generate-reading.js', 'lib/stateToken.js', 'lib/paymentConfig.js'];
        const dbPattern = /sqlite|mongodb|postgres|postgresql|mysql|firestore|firebase|sequelize|prisma|knex|dynamodb|createClient|new\s+Pool|require\(\s*['"](pg|mysql|sqlite3|redis|mongoose|@prisma|prisma)[\s\S]*?['"]\s*\)/i;
        for (const rel of files) {
            assertTrue(!dbPattern.test(stripComments(readFile(rel))), `${rel} must not reference a database`);
        }
    });

    await check('ARCH B: package.json has no database dependency', () => {
        const pkg = JSON.parse(readFile('package.json'));
        const deps = Object.keys(pkg.dependencies || {});
        for (const d of deps) {
            assertTrue(!/(sqlite|pg|mysql|mongodb|redis|prisma|sequelize|knex|firebase|dynamodb)/.test(d), `no DB dependency: ${d}`);
        }
        assertTrue(!pkg.dependencies.pg && !pkg.dependencies.mysql && !pkg.dependencies.sqlite3, 'no SQL drivers');
    });

    await check('ARCH C: no auth/login/account endpoints or flows exist', () => {
        const files = ['api/create-payment.js', 'api/verify-razorpay.js', 'api/razorpay-webhook.js', 'api/generate-reading.js', 'js/checkout.js', 'js/reveal.js', 'js/teaser.js'];
        const authPattern = /signup|sign-up|register|login|log-in|account|password|oauth|jwt|passport/i;
        for (const rel of files) {
            assertTrue(!authPattern.test(readFile(rel)), `${rel} must not implement auth/accounts`);
        }
        assertTrue(!fileExists('api/login.js') && !fileExists('api/signup.js') && !fileExists('api/register.js') && !fileExists('api/auth'), 'no auth endpoints');
    });

    // ============================================================
    // Architectural: D, E, F — secrets server-side only
    // ============================================================
    await check('ARCH D/E: payment secrets only referenced in server code, never served', () => {
        const serverFiles = ['api/create-payment.js', 'api/verify-razorpay.js', 'api/razorpay-webhook.js'];
        for (const rel of serverFiles) {
            assertTrue(readFile(rel).includes('process.env.RAZORPAY_KEY_SECRET') || readFile(rel).includes('process.env.RAZORPAY_WEBHOOK_SECRET'), `${rel} reads secrets from env`);
        }
        // The public responses must never contain the secrets.
        assertTrue(!readFile('api/create-payment.js').includes('keySecret:'), 'create-payment response must not echo keySecret');
        assertTrue(!readFile('api/verify-razorpay.js').includes('keySecret:'), 'verify-razorpay response must not echo keySecret');
        assertTrue(!readFile('api/razorpay-webhook.js').includes('webhookSecret:'), 'webhook response must not echo webhookSecret');
    });

    await check('ARCH F: frontend JS contains no payment secrets or env access', () => {
        for (const rel of ['js/checkout.js', 'js/teaser.js', 'js/reveal.js']) {
            const src = readFile(rel);
            assertTrue(!src.includes('process.env'), `${rel} must not read process.env`);
            assertTrue(!/rzp_(live|test)_[A-Za-z0-9]{8,}/.test(src), `${rel} must not hardcode a key id`);
            assertTrue(!src.includes('RAZORPAY_KEY_SECRET=') && !src.includes('RAZORPAY_WEBHOOK_SECRET=') && !src.includes('TOKEN_SECRET='), `${rel} must not hardcode secrets`);
        }
    });

    await check('ARCH G: create-payment response exposes only public key id, never a secret', async () => {
        const restore = installFetchMock({ id: RZ_ORDER });
        try {
            await withEnv({ NODE_ENV: 'production', TOKEN_SECRET: SECRET, RAZORPAY_KEY_ID: KEY_ID, RAZORPAY_KEY_SECRET: KEY_SECRET }, async () => {
                const res = makeRes();
                await createPayment(req('POST', {}, { ...CUSTOMER, photoHash: PHOTO }), res);
                const serialized = JSON.stringify(res._json);
                assertTrue(!serialized.includes(KEY_SECRET), 'KEY_SECRET value must not appear');
                assertTrue(!serialized.includes('keySecret'), 'keySecret field must not exist');
                assertTrue(!serialized.includes('TOKEN_SECRET') && !serialized.includes(SECRET), 'TOKEN_SECRET must not appear');
                assertEqual(res._json.payment.keyId, KEY_ID, 'only public keyId is exposed');
            });
        } finally {
            restore();
        }
    });

    // ============================================================
    // Summary
    // ============================================================
    console.log('\n=== RAZORPAY SECURITY VERIFICATION SUMMARY ===');
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log(`Total: ${passed + failed}`);
    if (failed > 0) process.exit(1);
    console.log('RAZORPAY SECURITY: ALL CHECKS PASSED');
})().catch((err) => {
    console.error('Security verification crashed:', err);
    process.exit(1);
});
