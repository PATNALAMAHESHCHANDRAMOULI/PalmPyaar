/**
 * Verification script for the DIRECT UPI payment flow (Instamojo removed).
 *
 * Covers:
 *   create-payment      (validation, UPI config, deep link, NO auto-grant)
 *   verify-payment      (UTR claim submission, never grants)
 *   admin-confirm-payment (owner-only HMAC token mint)
 *   generate-reading    (prod/dev bypass separation, token gate)
 *   full round-trip:    admin-confirm token -> generate-reading reading
 *
 * Prints PASS/FAIL per check and exits non-zero on any failure.
 */

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

const VALID_PARAMS = { name: 'Ananya Sharma', dob: '1990-06-15', birthplace: 'Pune', tradition: 'western' };
const VALID_PHOTO = 'a'.repeat(64);

async function withEnv(env, fn) {
    const saved = {};
    const keys = ['NODE_ENV', 'DEV_BYPASS', 'TOKEN_SECRET', 'ADMIN_CONFIRM_SECRET', 'PAYMENT_UPI_ID', 'PAYMENT_AMOUNT', 'PAYMENT_PAYEE_NAME', 'AI_READING'];
    for (const k of keys) { saved[k] = process.env[k]; delete process.env[k]; }
    try {
        for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
        return await fn();
    } finally {
        for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    }
}

(async () => {
    const createPayment = require('../api/create-payment');
    const verifyPayment = require('../api/verify-payment');
    const adminConfirmPayment = require('../api/admin-confirm-payment');
    const generateReading = require('../api/generate-reading');
    const crypto = require('crypto');
    const SECRET = 'phase4-secret-key-xyz';
    const ADMIN_SECRET = 'admin-phase4-secret';
    const UPI_ID = 'palm@pyaar';

    // ============================================================
    // 1. create-payment: request validation
    // ============================================================

    await check('create-payment: non-POST -> 405', async () => {
        const res = makeRes();
        await createPayment(req('GET', VALID_PARAMS), res);
        assertEqual(res.statusCode, 405, 'status');
    });

    await check('create-payment: missing fields -> 400', async () => {
        const res = makeRes();
        await createPayment(req('POST', {}, { name: 'Only Name' }), res);
        assertEqual(res.statusCode, 400, 'status');
    });

    await check('create-payment: name >100 chars -> 400', async () => {
        const res = makeRes();
        await createPayment(req('POST', {}, { ...VALID_PARAMS, name: 'X'.repeat(101) }), res);
        assertEqual(res.statusCode, 400, 'status');
    });

    await check('create-payment: invalid dob format -> 400', async () => {
        const res = makeRes();
        await createPayment(req('POST', {}, { ...VALID_PARAMS, dob: '15/06/1990' }), res);
        assertEqual(res.statusCode, 400, 'status');
    });

    await check('create-payment: invalid tradition -> 400', async () => {
        const res = makeRes();
        await createPayment(req('POST', {}, { ...VALID_PARAMS, tradition: 'nordic' }), res);
        assertEqual(res.statusCode, 400, 'status');
    });

    await check('create-payment: invalid photoHash -> 400', async () => {
        const res = makeRes();
        await createPayment(req('POST', {}, { ...VALID_PARAMS, photoHash: 'not-a-hex-hash' }), res);
        assertEqual(res.statusCode, 400, 'status');
    });

    // ============================================================
    // 2. create-payment: UPI config requirements
    // ============================================================

    await check('create-payment: missing PAYMENT_UPI_ID -> 500 config error', async () => {
        await withEnv({ NODE_ENV: 'production', TOKEN_SECRET: SECRET }, async () => {
            const res = makeRes();
            await createPayment(req('POST', {}, VALID_PARAMS), res);
            assertEqual(res.statusCode, 500, 'status');
            assertTrue(res._json.error.includes('PAYMENT_UPI_ID'), 'must mention PAYMENT_UPI_ID');
        });
    });

    await check('create-payment: invalid PAYMENT_AMOUNT (0) -> 500 config error', async () => {
        await withEnv({ NODE_ENV: 'production', TOKEN_SECRET: SECRET, PAYMENT_UPI_ID: UPI_ID, PAYMENT_AMOUNT: '0' }, async () => {
            const res = makeRes();
            await createPayment(req('POST', {}, VALID_PARAMS), res);
            assertEqual(res.statusCode, 500, 'status');
        });
    });

    await check('create-payment: invalid PAYMENT_AMOUNT (non-numeric) -> 500 config error', async () => {
        await withEnv({ NODE_ENV: 'production', TOKEN_SECRET: SECRET, PAYMENT_UPI_ID: UPI_ID, PAYMENT_AMOUNT: 'abc' }, async () => {
            const res = makeRes();
            await createPayment(req('POST', {}, VALID_PARAMS), res);
            assertEqual(res.statusCode, 500, 'status');
        });
    });

    // ============================================================
    // 3. create-payment: successful UPI payment intent
    // ============================================================

    await check('create-payment: success returns UPI intent (default amount 49, no grant)', async () => {
        await withEnv({ NODE_ENV: 'production', TOKEN_SECRET: SECRET, PAYMENT_UPI_ID: UPI_ID }, async () => {
            const res = makeRes();
            await createPayment(req('POST', {}, VALID_PARAMS), res);
            assertEqual(res.statusCode, 200, 'status');
            assertTrue(res._json.success === true, 'success flag');
            const p = res._json.payment;
            assertTrue(p && typeof p === 'object', 'payment object');
            assertEqual(p.upiId, UPI_ID, 'upiId');
            assertEqual(p.amount, 49, 'amount default 49');
            assertEqual(p.payeeName, 'PalmPyaar', 'default payee name');
            assertTrue(/^PP[0-9A-F]{10}$/.test(p.orderId), `orderId format PP+10hex: ${p.orderId}`);
            assertTrue(p.deepLink.startsWith('upi://pay?'), 'deep link scheme');
            assertTrue(p.deepLink.includes('pa=palm%40pyaar'), 'deep link pa param (URL-encoded VPA)');
            assertTrue(p.deepLink.includes('am=49'), 'deep link am param');
            assertTrue(p.deepLink.includes('cu=INR'), 'deep link cu param');
            assertTrue(p.deepLink.includes(`tid=${p.orderId}`), 'deep link tid matches orderId');
            assertTrue(res._json.token === undefined, 'must NOT return a token');
            assertTrue(res._json.resultUrl === undefined && res._json.paymentUrl === undefined, 'must NOT return a result/payment URL');
        });
    });

    await check('create-payment: custom PAYMENT_AMOUNT + payee name reflected in deep link', async () => {
        await withEnv({ NODE_ENV: 'production', TOKEN_SECRET: SECRET, PAYMENT_UPI_ID: UPI_ID, PAYMENT_AMOUNT: '79', PAYMENT_PAYEE_NAME: 'PalmPyaar Astro' }, async () => {
            const res = makeRes();
            await createPayment(req('POST', {}, VALID_PARAMS), res);
            assertEqual(res.statusCode, 200, 'status');
            assertEqual(res._json.payment.amount, 79, 'amount 79');
            assertTrue(res._json.payment.deepLink.includes('am=79'), 'deep link am=79');
            assertTrue(res._json.payment.deepLink.includes('pn=PalmPyaar+Astro'), 'deep link encoded payee name');
            assertEqual(res._json.payment.payeeName, 'PalmPyaar Astro', 'payee name');
        });
    });

    await check('create-payment: prod + DEV_BYPASS=true still does NOT grant (no token/URL)', async () => {
        await withEnv({ NODE_ENV: 'production', DEV_BYPASS: 'true', TOKEN_SECRET: SECRET, PAYMENT_UPI_ID: UPI_ID }, async () => {
            const res = makeRes();
            await createPayment(req('POST', {}, VALID_PARAMS), res);
            assertEqual(res.statusCode, 200, 'status');
            assertTrue(res._json.token === undefined && res._json.resultUrl === undefined && res._json.paymentUrl === undefined, 'must NOT grant in dev bypass');
        });
    });

    // ============================================================
    // 4. verify-payment: UTR claim (never grants)
    // ============================================================

    await check('verify-payment: non-POST -> 405', async () => {
        const res = makeRes();
        await verifyPayment(req('GET', {}), res);
        assertEqual(res.statusCode, 405, 'status');
    });

    await check('verify-payment: missing orderId -> 400', async () => {
        const res = makeRes();
        await verifyPayment(req('POST', {}, { utr: '6A3B2C9D1E' }), res);
        assertEqual(res.statusCode, 400, 'status');
    });

    await check('verify-payment: invalid utr (too short) -> 400', async () => {
        const res = makeRes();
        await verifyPayment(req('POST', {}, { orderId: 'PPA1B2C3D4E', utr: 'AB12' }), res);
        assertEqual(res.statusCode, 400, 'status');
    });

    await check('verify-payment: invalid utr (special chars) -> 400', async () => {
        const res = makeRes();
        await verifyPayment(req('POST', {}, { orderId: 'PPA1B2C3D4E', utr: 'AB12$%&*CD34' }), res);
        assertEqual(res.statusCode, 400, 'status');
    });

    await check('verify-payment: valid claim -> 200 submitted, NEVER grants even with TOKEN_SECRET', async () => {
        await withEnv({ TOKEN_SECRET: SECRET }, async () => {
            const res = makeRes();
            await verifyPayment(req('POST', {}, { orderId: 'PPA1B2C3D4E', utr: '6a3b2c9d1e' }), res);
            assertEqual(res.statusCode, 200, 'status');
            assertTrue(res._json.success === true, 'success flag');
            assertTrue(res._json.submitted === true, 'submitted flag');
            assertEqual(res._json.orderId, 'PPA1B2C3D4E', 'orderId echoed');
            assertTrue(res._json.token === undefined, 'must NOT return a token');
            assertTrue(res._json.resultUrl === undefined, 'must NOT return a resultUrl');
        });
    });

    // ============================================================
    // 5. admin-confirm-payment: owner-only token mint
    // ============================================================

    await check('admin-confirm: non-POST -> 405', async () => {
        const res = makeRes();
        await adminConfirmPayment(req('GET', {}), res);
        assertEqual(res.statusCode, 405, 'status');
    });

    await check('admin-confirm: missing ADMIN_CONFIRM_SECRET -> 500 config error', async () => {
        await withEnv({ TOKEN_SECRET: SECRET }, async () => {
            const res = makeRes();
            await adminConfirmPayment(req('POST', {}, VALID_PARAMS, { 'x-admin-secret': ADMIN_SECRET }), res);
            assertEqual(res.statusCode, 500, 'status');
            assertTrue(res._json.error.includes('ADMIN_CONFIRM_SECRET'), 'must mention ADMIN_CONFIRM_SECRET');
        });
    });

    await check('admin-confirm: wrong secret -> 401', async () => {
        await withEnv({ TOKEN_SECRET: SECRET, ADMIN_CONFIRM_SECRET: ADMIN_SECRET }, async () => {
            const res = makeRes();
            await adminConfirmPayment(req('POST', {}, VALID_PARAMS, { 'x-admin-secret': 'wrong-secret' }), res);
            assertEqual(res.statusCode, 401, 'status');
        });
    });

    await check('admin-confirm: missing secret entirely -> 401', async () => {
        await withEnv({ TOKEN_SECRET: SECRET, ADMIN_CONFIRM_SECRET: ADMIN_SECRET }, async () => {
            const res = makeRes();
            await adminConfirmPayment(req('POST', {}, VALID_PARAMS), res);
            assertEqual(res.statusCode, 401, 'status');
        });
    });

    await check('admin-confirm: missing fields -> 400', async () => {
        await withEnv({ TOKEN_SECRET: SECRET, ADMIN_CONFIRM_SECRET: ADMIN_SECRET }, async () => {
            const res = makeRes();
            await adminConfirmPayment(req('POST', {}, { name: 'Only Name' }, { 'x-admin-secret': ADMIN_SECRET }), res);
            assertEqual(res.statusCode, 400, 'status');
        });
    });

    await check('admin-confirm: missing TOKEN_SECRET -> 500 config error', async () => {
        await withEnv({ ADMIN_CONFIRM_SECRET: ADMIN_SECRET }, async () => {
            const res = makeRes();
            await adminConfirmPayment(req('POST', {}, { ...VALID_PARAMS, orderId: 'PPA1B2C3D4E' }, { 'x-admin-secret': ADMIN_SECRET }), res);
            assertEqual(res.statusCode, 500, 'status');
            assertTrue(res._json.error.includes('TOKEN_SECRET'), 'must mention TOKEN_SECRET');
        });
    });

    await check('admin-confirm: valid -> 200 resultUrl with HMAC token + all params', async () => {
        await withEnv({ TOKEN_SECRET: SECRET, ADMIN_CONFIRM_SECRET: ADMIN_SECRET }, async () => {
            const res = makeRes();
            await adminConfirmPayment(req('POST', {}, { ...VALID_PARAMS, orderId: 'PPA1B2C3D4E', photoHash: VALID_PHOTO }, { 'x-admin-secret': ADMIN_SECRET }), res);
            assertEqual(res.statusCode, 200, 'status');
            assertTrue(res._json.success === true, 'success flag');
            assertTrue(res._json.confirmed === true, 'confirmed flag');
            const url = new URL('https://example.com' + res._json.resultUrl);
            assertTrue(url.pathname === '/result.html', 'result.html path');
            const q = url.searchParams;
            assertEqual(q.get('name'), VALID_PARAMS.name, 'name param');
            assertEqual(q.get('dob'), VALID_PARAMS.dob, 'dob param');
            assertEqual(q.get('tradition'), VALID_PARAMS.tradition, 'tradition param');
            assertEqual(q.get('orderId'), 'PPA1B2C3D4E', 'orderId param');
            assertTrue(q.get('token') && q.get('token').length === 64, '64-char hex token');
            // token must be valid HMAC over the exact payload generate-reading recomputes
            const expected = crypto.createHmac('sha256', SECRET)
                .update([VALID_PARAMS.name, VALID_PARAMS.dob, VALID_PARAMS.birthplace, VALID_PARAMS.tradition, VALID_PHOTO, 'PPA1B2C3D4E'].join(':'))
                .digest('hex');
            assertEqual(q.get('token'), expected, 'token matches HMAC payload');
        });
    });

    // ============================================================
    // 6. generate-reading: prod/dev bypass separation (unchanged)
    // ============================================================

    await check('generate-reading: prod + DEV_BYPASS=true + no token -> 403', async () => {
        await withEnv({ NODE_ENV: 'production', DEV_BYPASS: 'true', TOKEN_SECRET: SECRET }, async () => {
            const res = makeRes();
            await generateReading(req('GET', VALID_PARAMS), res);
            assertEqual(res.statusCode, 403, 'status');
        });
    });

    await check('generate-reading: dev + DEV_BYPASS=true + no token -> 200', async () => {
        await withEnv({ NODE_ENV: 'development', DEV_BYPASS: 'true', TOKEN_SECRET: SECRET }, async () => {
            const res = makeRes();
            await generateReading(req('GET', VALID_PARAMS), res);
            assertEqual(res.statusCode, 200, 'status');
            assertTrue(res._json.reading && res._json.reading.core, 'reading present');
        });
    });

    await check('generate-reading: forged token (wrong orderId) -> 403', async () => {
        await withEnv({ NODE_ENV: 'production', TOKEN_SECRET: SECRET }, async () => {
            const badPayload = ['Ananya Sharma', '1990-06-15', 'Pune', 'western', '', 'PP0000000000'].join(':');
            const forged = crypto.createHmac('sha256', SECRET).update(badPayload).digest('hex');
            const res = makeRes();
            await generateReading(req('GET', { ...VALID_PARAMS, orderId: 'PPA1B2C3D4E', token: forged }), res);
            assertEqual(res.statusCode, 403, 'status');
        });
    });

    // ============================================================
    // 7. No auto-grant + round-trip
    // ============================================================

    await check('NO auto-grant: orderId from create-payment alone does not unlock reading', async () => {
        let orderId;
        await withEnv({ NODE_ENV: 'production', TOKEN_SECRET: SECRET, PAYMENT_UPI_ID: UPI_ID }, async () => {
            const res = makeRes();
            await createPayment(req('POST', {}, VALID_PARAMS), res);
            orderId = res._json.payment.orderId;
        });
        await withEnv({ NODE_ENV: 'production', TOKEN_SECRET: SECRET }, async () => {
            const res = makeRes();
            await generateReading(req('GET', { ...VALID_PARAMS, orderId, token: '' }), res);
            assertEqual(res.statusCode, 403, 'must stay locked without a token');
        });
    });

    await check('round-trip: admin-confirm resultUrl token -> generate-reading 200', async () => {
        let resultUrl;
        await withEnv({ TOKEN_SECRET: SECRET, ADMIN_CONFIRM_SECRET: ADMIN_SECRET }, async () => {
            const res = makeRes();
            await adminConfirmPayment(req('POST', {}, { ...VALID_PARAMS, orderId: 'PPA1B2C3D4E' }, { 'x-admin-secret': ADMIN_SECRET }), res);
            resultUrl = res._json.resultUrl;
        });
        const q = new URL('https://example.com' + resultUrl).searchParams;
        const readingRes = await withEnv({ NODE_ENV: 'production', TOKEN_SECRET: SECRET }, async () => {
            const res = makeRes();
            await generateReading(req('GET', {
                name: q.get('name'), dob: q.get('dob'), birthplace: q.get('birthplace'),
                tradition: q.get('tradition'), photoHash: q.get('photoHash'),
                orderId: q.get('orderId'), token: q.get('token')
            }), res);
            return res;
        });
        assertEqual(readingRes.statusCode, 200, 'status');
        assertTrue(readingRes._json.reading && readingRes._json.reading.core && readingRes._json.reading.love && readingRes._json.reading.pro, 'reading sections');
    });

    console.log('\n=== DIRECT UPI PAYMENT CHECKS SUMMARY ===');
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log(`Total: ${passed + failed}`);
    if (failed > 0) process.exit(1);
    console.log('ALL UPI CHECKS PASSED');
})().catch((err) => {
    console.error('UPI verification crashed:', err);
    process.exit(1);
});
