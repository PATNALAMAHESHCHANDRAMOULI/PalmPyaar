/**
 * Payment configuration shared by /api/create-payment and /api/verify-razorpay
 * so both endpoints always agree on the expected amount for the reading.
 *
 * PalmPyaar's price is ₹49 (4900 paise, INR). PAYMENT_AMOUNT overrides the
 * rupee figure in non-production deployments; when unset it defaults to 49.
 */
function expectedAmountRupees() {
  const raw = process.env.PAYMENT_AMOUNT || '49';
  const amount = parseInt(raw, 10);
  if (!Number.isInteger(amount) || amount <= 0 || amount > 100000) return null;
  return amount;
}

const CURRENCY = 'INR';

module.exports = { expectedAmountRupees, CURRENCY };
