/**
 * verifyUpiPaymentFlow.js — focused verification of the DIRECT UPI payment flow
 * (Google Pay-compatible). Asserts:
 *   1. upi:// deep link format and parameters
 *   2. server-side orderId generation (format + uniqueness)
 *   3. HMAC token binding (orderId + photoHash) and determinism
 *   4. verify-payment NEVER grants, even with TOKEN_SECRET configured
 *   5. create-payment NEVER mints a token (no auto-grant by construction)
 *   6. no stale Instamojo / gateway-redirect / auto-grant references in active code
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
const SECRET = 'upi-flow-secret';
const ADMIN_SECRET = 'upi-flow-admin';
const UPI_ID = 'palm@hdfcbank';
const UPI_ID_ENCODED = 'palm%40hdfcbank';

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

(async () => {
    const createPayment = require('../api/create-payment');
    const verifyPayment = require('../api/verify-payment');
    const adminConfirmPayment = require('../api/admin-confirm-payment');
    const generateReading = require('../api/generate-reading');

    // ============================================================
    // 1. Deep link format (Google Pay / PhonePe / Paytm compatible)
    // ============================================================

    let orderId1, orderId2;
    await check('deep link: standard upi://pay scheme with all params', async () => {
        process.env.NODE_ENV = 'production';
        process.env.TOKEN_SECRET = SECRET;
        process.env.PAYMENT_UPI_ID = UPI_ID;
        process.env.PAYMENT_PAYEE_NAME = 'PalmPyaar';
        delete process.env.PAYMENT_AMOUNT;
        const res = makeRes();
        await createPayment(req('POST', {}, { ...CUSTOMER, photoHash: PHOTO }), res);
        assertEqual(res.statusCode, 200, 'status');
        const dl = res._json.payment.deepLink;
        orderId1 = res._json.payment.orderId;
        assertTrue(/^upi:\/\/pay\?pa=[^&]+&pn=[^&]+&am=\d+&cu=INR&tn=[^&]+&tid=[^&]+$/.test(dl), `deep link shape: ${dl}`);
        assertTrue(dl.includes(`pa=${UPI_ID_ENCODED}`), 'VPA encoded and present');
        assertTrue(dl.includes('pn=PalmPyaar'), 'payee name present');
        assertTrue(dl.includes('am=49'), 'amount default 49');
        assertTrue(dl.includes('cu=INR'), 'currency INR');
        assertTrue(dl.includes(`tid=${orderId1}`), 'tid matches orderId');
        assertTrue(!dl.includes('photoHash') && !dl.includes(CUSTOMER.name), 'no PII (name/photo) in deep link');
    });

    await check('deep link: orderId is PP + 10 random hex, unique per request', async () => {
        process.env.PAYMENT_UPI_ID = UPI_ID;
        const res2 = makeRes();
        await createPayment(req('POST', {}, CUSTOMER), res2);
        orderId2 = res2._json.payment.orderId;
        assertTrue(/^PP[0-9A-F]{10}$/.test(orderId1), `orderId1 format: ${orderId1}`);
        assertTrue(/^PP[0-9A-F]{10}$/.test(orderId2), `orderId2 format: ${orderId2}`);
        assertTrue(orderId1 !== orderId2, 'orderIds must differ');
        assertTrue(res2._json.payment.deepLink.includes(`tid=${orderId2}`), 'tid2 matches orderId2');
    });

    // ============================================================
    // 2. Token binding + determinism (admin-confirm -> generate-reading)
    // ============================================================

    await check('token: same payload + secret -> deterministic; binds orderId and photoHash', async () => {
        process.env.ADMIN_CONFIRM_SECRET = ADMIN_SECRET;
        process.env.TOKEN_SECRET = SECRET;
        const mk = async (orderId, photoHash) => {
            const res = makeRes();
            await adminConfirmPayment(req('POST', {}, { ...CUSTOMER, orderId, photoHash }, { 'x-admin-secret': ADMIN_SECRET }), res);
            assertEqual(res.statusCode, 200, `status for ${orderId}`);
            return new URL('https://example.com' + res._json.resultUrl).searchParams.get('token');
        };
        const t1 = await mk('PPAA00000001', PHOTO);
        const t2 = await mk('PPAA00000001', PHOTO);
        assertEqual(t1, t2, 'deterministic for identical payload');
        const t3 = await mk('PPAA00000002', PHOTO);
        assertTrue(t1 !== t3, 'token binds orderId');
        const t4 = await mk('PPAA00000001', '');
        assertTrue(t1 !== t4, 'token binds photoHash');
        // sanity: generate-reading accepts the exactly-matching token
        const res = makeRes();
        await generateReading(req('GET', { ...CUSTOMER, photoHash: PHOTO, orderId: 'PPAA00000001', token: t1 }), res);
        assertEqual(res.statusCode, 200, 'round-trip accepted');
    });

    await check('token: wrong orderId against a minted token is rejected (403)', async () => {
        const res = makeRes();
        await adminConfirmPayment(req('POST', {}, { ...CUSTOMER, orderId: 'PPAA00000003', photoHash: PHOTO }, { 'x-admin-secret': ADMIN_SECRET }), res);
        const q = new URL('https://example.com' + res._json.resultUrl).searchParams;
        const locked = makeRes();
        await generateReading(req('GET', { ...CUSTOMER, photoHash: PHOTO, orderId: 'PPAA99999999', token: q.get('token') }), locked);
        assertEqual(locked.statusCode, 403, 'token+orderId mismatch must lock');
    });

    // ============================================================
    // 3. Never grant without owner confirmation
    // ============================================================

    await check('NO AUTO-GRANT: create-payment returns no token/URL under any env', async () => {
        for (const env of [
            { NODE_ENV: 'production', TOKEN_SECRET: SECRET, PAYMENT_UPI_ID: UPI_ID },
            { NODE_ENV: 'development', DEV_BYPASS: 'true', TOKEN_SECRET: SECRET, PAYMENT_UPI_ID: UPI_ID }
        ]) {
            for (const [k, v] of Object.entries(env)) process.env[k] = v;
            const res = makeRes();
            await createPayment(req('POST', {}, CUSTOMER), res);
            assertEqual(res.statusCode, 200, 'status');
            assertTrue(res._json.token === undefined, 'no token in payload');
            assertTrue(res._json.resultUrl === undefined && res._json.paymentUrl === undefined, 'no result/payment URL');
        }
    });

    await check('NO AUTO-GRANT: verify-payment (UTR claim) never mints a token', async () => {
        process.env.NODE_ENV = 'production';
        process.env.TOKEN_SECRET = SECRET;
        delete process.env.DEV_BYPASS;
        const res = makeRes();
        await verifyPayment(req('POST', {}, { orderId: 'PPAA00000001', utr: '1A2B3C4D5E6F' }), res);
        assertEqual(res.statusCode, 200, 'status');
        assertTrue(res._json.submitted === true, 'submitted flag');
        assertTrue(res._json.token === undefined, 'no token');
        assertTrue(res._json.resultUrl === undefined, 'no resultUrl');
        // an un-tokened orderId still cannot open the reading
        const locked = makeRes();
        await generateReading(req('GET', { ...CUSTOMER, orderId: 'PPAA00000001', token: '' }), locked);
        assertEqual(locked.statusCode, 403, 'reading stays locked');
    });

    // ============================================================
    // 4. No stale gateway references in active code
    // ============================================================

    await check('hygiene: no Instamojo / gateway redirect / auto-grant in api/*.js and js/*.js', () => {
        const files = ['api/create-payment.js', 'api/verify-payment.js', 'api/admin-confirm-payment.js', 'api/generate-reading.js', 'js/checkout.js', 'js/reveal.js', 'js/teaser.js'];
        const banned = ['Instamojo', 'INSTAMOJO', 'paymentUrl', 'payment_request_id', 'payment_id', 'longurl'];
        for (const rel of files) {
            const content = readFile(rel);
            for (const b of banned) {
                assertTrue(!content.includes(b), `${rel} must not contain "${b}"`);
            }
        }
        // the auto-grant bypass was removed: create-payment must not compute an HMAC token
        const createPaymentSrc = readFile('api/create-payment.js');
        assertTrue(!createPaymentSrc.includes('createHmac'), 'create-payment must not mint HMAC tokens');
        assertTrue(!createPaymentSrc.includes('DEV_BYPASS'), 'create-payment must not have a dev bypass grant');
    });

    await check('hygiene: env contract (.env.example) documents UPI + admin secret, no INSTAMOJO', () => {
        const example = readFile('.env.example');
        assertTrue(example.includes('PAYMENT_UPI_ID'), 'PAYMENT_UPI_ID documented');
        assertTrue(example.includes('PAYMENT_AMOUNT'), 'PAYMENT_AMOUNT documented');
        assertTrue(example.includes('ADMIN_CONFIRM_SECRET'), 'ADMIN_CONFIRM_SECRET documented');
        assertTrue(example.includes('TOKEN_SECRET'), 'TOKEN_SECRET documented');
        assertTrue(!example.includes('INSTAMOJO'), 'no INSTAMOJO vars documented');
    });

    // cleanup
    delete process.env.PAYMENT_UPI_ID;
    delete process.env.ADMIN_CONFIRM_SECRET;
    delete process.env.PAYMENT_PAYEE_NAME;

    console.log('\n=== UPI PAYMENT FLOW SUMMARY ===');
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log(`Total: ${passed + failed}`);
    if (failed > 0) process.exit(1);
    console.log('UPI PAYMENT FLOW: ALL CHECKS PASSED');
})().catch((err) => {
    console.error('UPI flow verification crashed:', err);
    process.exit(1);
});
