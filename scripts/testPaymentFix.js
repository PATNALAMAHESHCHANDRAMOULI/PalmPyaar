/**
 * Focused regression test suite for Payment & Redirect Flow (BUG 2)
 *
 * Verifies:
 *   1. Checkout amount is ₹9 (no stale ₹20 in checkout.js or index.html)
 *   2. Order amount is exactly 900 paise (₹9)
 *   3. Correct ₹9 payment + valid Razorpay signature grants access
 *   4. Successful payment generates valid resultUrl
 *   5. Reading loads with original customer submission
 *   6. Refreshing result page succeeds without requiring payment again
 *   7. Wrong amount, invalid signature, and forged access are rejected
 *   8. Retry after successful payment redirects to paid reading without re-charging
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let passed = 0;
let failed = 0;

async function check(name, fn) {
  try {
    await fn();
    console.log('PASS: ' + name);
    passed++;
  } catch (err) {
    console.error('FAIL: ' + name + ' -> ' + (err && err.message ? err.message : err));
    failed++;
  }
}

function assertTrue(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error((msg || 'value') + ': expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
  }
}

const ROOT = path.join(__dirname, '..');
const SECRET = 'payment-fix-secret';
const KEY_ID = 'rzp_test_paymentKey';
const KEY_SECRET = 'payment-fix-key-secret';
const RZ_ORDER = 'order_FIX12345678';
const RZ_PAYMENT = 'pay_FIX12345678';

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

const CUSTOMER = {
  name: 'Aarav Sharma',
  dob: '1995-07-14',
  birthplace: 'Mumbai',
  tradition: 'vedic',
  photoHash: 'e'.repeat(64)
};

const ENV_KEYS = [
  'NODE_ENV', 'DEV_BYPASS', 'TOKEN_SECRET', 'RAZORPAY_KEY_ID',
  'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET', 'PAYMENT_AMOUNT', 'AI_READING'
];

async function withEnv(env, fn) {
  const saved = {};
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  try {
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    return await fn();
  } finally {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
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
  const generateReading = require('../api/generate-reading');
  const paymentConfig = require('../lib/paymentConfig');

  // -------------------------------------------------------------------------
  // 1. Checkout amount is ₹9 (frontend code inspection)
  // -------------------------------------------------------------------------
  await check('P1 [checkout amount]: checkout.js DEFAULT_BTN_TEXT is ₹9, never ₹20', () => {
    const checkoutSrc = fs.readFileSync(path.join(ROOT, 'js', 'checkout.js'), 'utf8');
    assertTrue(checkoutSrc.includes('DEFAULT_BTN_TEXT = \'Unlock full reading \\u2014 \\u20B99\''), 'DEFAULT_BTN_TEXT must be ₹9');
    assertTrue(!checkoutSrc.includes('\\u20B920'), 'stale ₹20 constant must not exist in checkout.js');
    assertTrue(!checkoutSrc.includes('₹20'), 'stale ₹20 string must not exist in checkout.js');
  });

  await check('P1b [index.html copy]: index.html displays ₹9 consistently', () => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    assertTrue(html.includes('Unlock full reading — ₹9'), 'CTA displays ₹9');
    assertTrue(html.includes('One-time ₹9'), 'subtext displays ₹9');
    assertTrue(!html.includes('₹20'), 'no stale ₹20 anywhere in index.html');
  });

  // -------------------------------------------------------------------------
  // 2. Order amount is 900 paise (server-side)
  // -------------------------------------------------------------------------
  await check('P2 [order amount]: create-payment creates Razorpay order with 900 paise (₹9)', async () => {
    const restore = installFetchMock({ id: RZ_ORDER });
    try {
      await withEnv({
        NODE_ENV: 'production',
        TOKEN_SECRET: SECRET,
        RAZORPAY_KEY_ID: KEY_ID,
        RAZORPAY_KEY_SECRET: KEY_SECRET
      }, async () => {
        assertEqual(paymentConfig.expectedAmountRupees(), 9, 'paymentConfig defaults to 9');
        const res = makeRes();
        await createPayment(req('POST', {}, CUSTOMER), res);
        assertEqual(res.statusCode, 200, 'create-payment status');
        assertEqual(res._json.payment.amount, 9, 'rupees amount');
        assertEqual(res._json.payment.amountPaise, 900, 'paise amount');
        assertEqual(res._json.payment.currency, 'INR', 'currency');
      });
    } finally {
      restore();
    }
  });

  // -------------------------------------------------------------------------
  // 3. Correct ₹9 payment and valid signature grant access
  // -------------------------------------------------------------------------
  let paidPayment = null;
  await check('P3 [verification]: valid ₹9 payment and HMAC signature verify successfully', async () => {
    const restore = installFetchMock({ id: RZ_ORDER });
    try {
      await withEnv({
        NODE_ENV: 'production',
        TOKEN_SECRET: SECRET,
        RAZORPAY_KEY_ID: KEY_ID,
        RAZORPAY_KEY_SECRET: KEY_SECRET
      }, async () => {
        const createRes = makeRes();
        await createPayment(req('POST', {}, CUSTOMER), createRes);
        paidPayment = createRes._json.payment;

        const sig = rzSignature(paidPayment.razorpayOrderId, RZ_PAYMENT);
        const verifyRes = makeRes();
        await verifyRazorpay(req('POST', {}, {
          name: CUSTOMER.name,
          dob: CUSTOMER.dob,
          birthplace: CUSTOMER.birthplace,
          tradition: CUSTOMER.tradition,
          photoHash: CUSTOMER.photoHash,
          orderId: paidPayment.orderId,
          stateToken: paidPayment.stateToken,
          razorpayOrderId: paidPayment.razorpayOrderId,
          razorpayPaymentId: RZ_PAYMENT,
          razorpaySignature: sig
        }), verifyRes);

        assertEqual(verifyRes.statusCode, 200, 'verify status');
        assertTrue(verifyRes._json.verified === true, 'verified is true');
        assertTrue(typeof verifyRes._json.resultUrl === 'string', 'resultUrl returned');
        assertTrue(verifyRes._json.resultUrl.includes('/result.html?'), 'resultUrl points to result.html');
      });
    } finally {
      restore();
    }
  });

  // -------------------------------------------------------------------------
  // 4. Successful payment redirects to the correct reading
  // -------------------------------------------------------------------------
  let resultUrl = '';
  await check('P4 [redirect target]: resultUrl carries all required customer parameters and token', async () => {
    const sig = rzSignature(paidPayment.razorpayOrderId, RZ_PAYMENT);
    const verifyRes = makeRes();
    await withEnv({
      NODE_ENV: 'production',
      TOKEN_SECRET: SECRET,
      RAZORPAY_KEY_SECRET: KEY_SECRET
    }, async () => {
      await verifyRazorpay(req('POST', {}, {
        name: CUSTOMER.name,
        dob: CUSTOMER.dob,
        birthplace: CUSTOMER.birthplace,
        tradition: CUSTOMER.tradition,
        photoHash: CUSTOMER.photoHash,
        orderId: paidPayment.orderId,
        stateToken: paidPayment.stateToken,
        razorpayOrderId: paidPayment.razorpayOrderId,
        razorpayPaymentId: RZ_PAYMENT,
        razorpaySignature: sig
      }), verifyRes);
      resultUrl = verifyRes._json.resultUrl;
      const url = new URL('https://example.com' + resultUrl);
      assertEqual(url.pathname, '/result.html', 'result.html path');
      assertEqual(url.searchParams.get('name'), CUSTOMER.name, 'customer name matches');
      assertEqual(url.searchParams.get('dob'), CUSTOMER.dob, 'customer dob matches');
      assertEqual(url.searchParams.get('orderId'), paidPayment.orderId, 'orderId matches');
      assertTrue(/^[0-9a-f]{64}$/.test(url.searchParams.get('token')), 'valid 64-hex signed token');
    });
  });

  // -------------------------------------------------------------------------
  // 5. Reading loads with original customer submission
  // -------------------------------------------------------------------------
  let originalReading = null;
  await check('P5 [reading load]: generate-reading serves full reading with customer submission', async () => {
    const url = new URL('https://example.com' + resultUrl);
    const q = url.searchParams;
    const res = makeRes();
    await withEnv({ NODE_ENV: 'production', TOKEN_SECRET: SECRET }, async () => {
      await generateReading(req('GET', {
        name: q.get('name'),
        dob: q.get('dob'),
        birthplace: q.get('birthplace'),
        tradition: q.get('tradition'),
        photoHash: q.get('photoHash'),
        orderId: q.get('orderId'),
        token: q.get('token')
      }), res);
      assertEqual(res.statusCode, 200, 'generate-reading status');
      assertTrue(res._json.success === true, 'success true');
      originalReading = res._json.reading;
      assertTrue(originalReading.core.length > 50, 'core non-empty');
      assertTrue(originalReading.love.length > 50, 'love non-empty');
      assertTrue(originalReading.pro.length > 50, 'pro non-empty');
    });
  });

  // -------------------------------------------------------------------------
  // 6. Refreshing result page does not require payment again
  // -------------------------------------------------------------------------
  await check('P6 [refresh idempotency]: refreshing result URL regenerates identical reading without payment', async () => {
    const url = new URL('https://example.com' + resultUrl);
    const q = url.searchParams;
    const res = makeRes();
    await withEnv({ NODE_ENV: 'production', TOKEN_SECRET: SECRET }, async () => {
      await generateReading(req('GET', {
        name: q.get('name'),
        dob: q.get('dob'),
        birthplace: q.get('birthplace'),
        tradition: q.get('tradition'),
        photoHash: q.get('photoHash'),
        orderId: q.get('orderId'),
        token: q.get('token')
      }), res);
      assertEqual(res.statusCode, 200, 'refresh status 200');
      assertEqual(res._json.reading.core, originalReading.core, 'core matches');
      assertEqual(res._json.reading.love, originalReading.love, 'love matches');
      assertEqual(res._json.reading.pro, originalReading.pro, 'pro matches');
    });
  });

  await check('P6b [reveal.js caching]: reveal.js contains search param caching for refresh recovery', () => {
    const revealSrc = fs.readFileSync(path.join(ROOT, 'js', 'reveal.js'), 'utf8');
    assertTrue(revealSrc.includes('palmpyaar_paid_result_search'), 'search params cached in storage');
  });

  // -------------------------------------------------------------------------
  // 7. Wrong amount, invalid signature, failed payment, forged access rejected
  // -------------------------------------------------------------------------
  await check('P7a [wrong amount]: payment for ₹20 rejected when ₹9 expected', async () => {
    const restore = installFetchMock({ id: RZ_ORDER });
    try {
      await withEnv({
        NODE_ENV: 'production',
        TOKEN_SECRET: SECRET,
        RAZORPAY_KEY_ID: KEY_ID,
        RAZORPAY_KEY_SECRET: KEY_SECRET,
        PAYMENT_AMOUNT: '20'
      }, async () => {
        const createRes = makeRes();
        await createPayment(req('POST', {}, CUSTOMER), createRes);
        const payment20 = createRes._json.payment;

        // Try verifying with default expected ₹9
        await withEnv({
          NODE_ENV: 'production',
          TOKEN_SECRET: SECRET,
          RAZORPAY_KEY_SECRET: KEY_SECRET,
          PAYMENT_AMOUNT: '9'
        }, async () => {
          const sig = rzSignature(payment20.razorpayOrderId, RZ_PAYMENT);
          const verifyRes = makeRes();
          await verifyRazorpay(req('POST', {}, {
            name: CUSTOMER.name,
            dob: CUSTOMER.dob,
            birthplace: CUSTOMER.birthplace,
            tradition: CUSTOMER.tradition,
            photoHash: CUSTOMER.photoHash,
            orderId: payment20.orderId,
            stateToken: payment20.stateToken,
            razorpayOrderId: payment20.razorpayOrderId,
            razorpayPaymentId: RZ_PAYMENT,
            razorpaySignature: sig
          }), verifyRes);
          assertEqual(verifyRes.statusCode, 403, 'amount mismatch rejected');
        });
      });
    } finally {
      restore();
    }
  });

  await check('P7b [invalid signature]: forged Razorpay signature rejected', async () => {
    const verifyRes = makeRes();
    await withEnv({
      NODE_ENV: 'production',
      TOKEN_SECRET: SECRET,
      RAZORPAY_KEY_SECRET: KEY_SECRET
    }, async () => {
      await verifyRazorpay(req('POST', {}, {
        name: CUSTOMER.name,
        dob: CUSTOMER.dob,
        birthplace: CUSTOMER.birthplace,
        tradition: CUSTOMER.tradition,
        photoHash: CUSTOMER.photoHash,
        orderId: paidPayment.orderId,
        stateToken: paidPayment.stateToken,
        razorpayOrderId: paidPayment.razorpayOrderId,
        razorpayPaymentId: RZ_PAYMENT,
        razorpaySignature: 'f'.repeat(64)
      }), verifyRes);
      assertEqual(verifyRes.statusCode, 403, 'forged signature rejected');
    });
  });

  await check('P7c [forged token]: arbitrary token rejected by generate-reading', async () => {
    const res = makeRes();
    await withEnv({ NODE_ENV: 'production', TOKEN_SECRET: SECRET }, async () => {
      await generateReading(req('GET', {
        ...CUSTOMER,
        orderId: paidPayment.orderId,
        token: 'a'.repeat(64)
      }), res);
      assertEqual(res.statusCode, 403, 'forged token denied');
    });
  });

  // -------------------------------------------------------------------------
  // 8. Retry after successful payment does not charge the customer again
  // -------------------------------------------------------------------------
  await check('P8 [safe recovery / no double charge]: checkout.js saves paid resultUrl and redirects without re-charging', () => {
    const checkoutSrc = fs.readFileSync(path.join(ROOT, 'js', 'checkout.js'), 'utf8');
    assertTrue(checkoutSrc.includes('palmpyaar_paid_result_url'), 'paid resultUrl persisted in storage');
    assertTrue(checkoutSrc.includes('View your reading'), 'recovery button text provided');
    assertTrue(checkoutSrc.includes('if (savedUrl)'), 'existing paid session redirects without calling create-payment');
    assertTrue(checkoutSrc.includes('if (paymentSucceeded && lastResultUrl)'), 'in-memory retry redirects directly');
  });

  console.log('\n=== PAYMENT FLOW REGRESSION SUMMARY ===');
  console.log('Passed: ' + passed);
  console.log('Failed: ' + failed);
  console.log('Total:  ' + (passed + failed));
  if (failed > 0) process.exit(1);
})().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
