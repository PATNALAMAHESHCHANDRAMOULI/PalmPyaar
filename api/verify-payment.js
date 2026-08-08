/**
 * Vercel Serverless Function: POST /api/verify-payment
 *
 * Replaces the previous gateway callback handling with the DIRECT UPI flow.
 * There is no gateway redirect anymore: the customer pays the UPI
 * deep link directly in their UPI app and returns here with their
 * transaction reference (UTR).
 *
 * Accepts { orderId, utr }:
 *   - orderId: the order id returned by /api/create-payment (matches the UPI tid)
 *   - utr:     the UPI transaction reference shown in the customer's UPI app
 *
 * Returns a confirmation with instructions.
 *
 * SECURITY: Direct UPI provides NO server-side settlement callback, so this
 * endpoint CANNOT and DOES NOT verify the payment or grant access. It only
 * records the customer's claim (stateless acknowledgment) and instructs them
 * to share the UTR with the owner. The SOLE grant path is
 * /api/admin-confirm-payment, which only the owner may call AFTER manually
 * confirming the credit in their own UPI app.
 */
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    let orderId = String(body.orderId || '').trim();
    let utr = String(body.utr || '').trim();

    // Security Decision: Strict format checks to prevent injection / log poisoning.
    if (!orderId || !/^[A-Za-z0-9_-]{4,32}$/.test(orderId)) {
      return res.status(400).json({ success: false, error: 'A valid order id is required.' });
    }

    // UPI UTRs are short alphanumeric references (commonly 12 chars).
    // Accept 8-16 alphanumeric chars to avoid false rejections across apps/banks.
    utr = utr.toUpperCase();
    if (!/^[A-Z0-9]{8,16}$/.test(utr)) {
      return res.status(400).json({
        success: false,
        error: 'The UTR should be the 12-character UPI transaction reference (letters and numbers only).'
      });
    }

    return res.status(200).json({
      success: true,
      submitted: true,
      orderId,
      message: 'Payment claim received. PalmPyaar confirms payments manually — if we have any question we will reach out with your UTR. Once confirmed, your permanent reading link will be sent to you.'
    });
  } catch (err) {
    console.error('[verify-payment] error:', err);
    return res.status(500).json({
      success: false,
      error: 'Could not submit your payment claim. Please try again.'
    });
  }
};
