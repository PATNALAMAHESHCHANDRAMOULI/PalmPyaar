/**
 * PalmPyaar checkout — collects form inputs, validates, calls /api/create-payment
 * to create a REAL Razorpay Order, opens the Razorpay Checkout modal, and after a
 * successful payment sends the Razorpay response to /api/verify-razorpay so the
 * server can verify the payment signature and mint the access token.
 *
 * The frontend NEVER decides whether a payment succeeded. /api/verify-razorpay
 * verifies the Razorpay signature with RAZORPAY_KEY_SECRET before granting
 * access, so a forged "payment success" cannot unlock a reading.
 */
(function () {
  'use strict';

  var unlockBtn = null;
  var checkoutError = null;
  var form = null;
  var currentOrderId = '';
  var currentStateToken = '';
  var rzpInstance = null;
  var DEFAULT_BTN_TEXT = 'Unlock full reading \u2014 \u20B949';

  function $(id) {
    return document.getElementById(id);
  }

  function setError(message) {
    if (!checkoutError) {
      checkoutError = $('checkout-error');
    }
    if (!checkoutError) return;

    if (message) {
      checkoutError.textContent = message;
      checkoutError.hidden = false;
      checkoutError.setAttribute('aria-live', 'assertive');
    } else {
      checkoutError.textContent = '';
      checkoutError.hidden = true;
    }
  }

  function validateInputs() {
    if (!form) form = $('reading-form');
    if (!form) return null;

    var name = (form.name ? form.name.value : '').trim();
    var dob = (form.dob ? form.dob.value : '').trim();
    var birthplace = (form.birthplace ? form.birthplace.value : '').trim();
    var traditionEl = form.querySelector('input[name="tradition"]:checked');
    var tradition = traditionEl ? traditionEl.value : 'western';

    var photoHash = '';
    if (window.PalmTeaser && typeof window.PalmTeaser.getPhotoHash === 'function') {
      photoHash = window.PalmTeaser.getPhotoHash();
    }

    if (!name) {
      setError('Please enter your name.');
      if (form.name) form.name.focus();
      return null;
    }

    if (!dob) {
      setError('Please select your date of birth.');
      if (form.dob) form.dob.focus();
      return null;
    }

    if (!birthplace) {
      setError('Please enter your birthplace.');
      if (form.birthplace) form.birthplace.focus();
      return null;
    }

    if (!photoHash) {
      setError('A hand photo is required before you can unlock your reading. Please add your palm photo.');
      var photoInput = form.querySelector('#photo');
      if (photoInput) photoInput.focus();
      return null;
    }

    setError('');
    return {
      name: name,
      dob: dob,
      birthplace: birthplace,
      tradition: tradition,
      photoHash: photoHash
    };
  }

  function setButtonBusy(text) {
    if (unlockBtn) {
      unlockBtn.disabled = true;
      unlockBtn.setAttribute('aria-disabled', 'true');
      unlockBtn.textContent = text || DEFAULT_BTN_TEXT;
    }
  }

  function resetUnlockButton() {
    if (unlockBtn) {
      unlockBtn.disabled = false;
      unlockBtn.setAttribute('aria-disabled', 'false');
      unlockBtn.textContent = DEFAULT_BTN_TEXT;
    }
  }

  function loadRazorpayScript() {
    return new Promise(function (resolve, reject) {
      if (window.Razorpay) {
        resolve(window.Razorpay);
        return;
      }
      var script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.async = true;
      script.onload = function () {
        if (window.Razorpay) resolve(window.Razorpay);
        else reject(new Error('Razorpay Checkout did not load. Please try again.'));
      };
      script.onerror = function () {
        reject(new Error('Could not load the Razorpay payment gateway. Please check your connection and try again.'));
      };
      document.head.appendChild(script);
    });
  }

  function verifyPayment(response, data) {
    setButtonBusy('Verifying your payment\u2026');

    fetch('/api/verify-razorpay', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: data.name,
        dob: data.dob,
        birthplace: data.birthplace,
        tradition: data.tradition,
        photoHash: data.photoHash,
        orderId: currentOrderId,
        stateToken: currentStateToken,
        razorpayOrderId: response.razorpay_order_id,
        razorpayPaymentId: response.razorpay_payment_id,
        razorpaySignature: response.razorpay_signature
      })
    })
      .then(function (res) {
        return res.json().then(function (json) {
          return { status: res.status, body: json };
        });
      })
      .then(function (res) {
        if (res.body && res.body.success && res.body.resultUrl) {
          window.location.href = res.body.resultUrl;
        } else {
          setError((res.body && res.body.error) || 'We could not verify your payment. Please try again.');
          resetUnlockButton();
        }
      })
      .catch(function () {
        setError('Network error while verifying your payment. If you were charged, please contact support with your transaction reference.');
        resetUnlockButton();
      });
  }

  function openRazorpayCheckout(payment, data) {
    var options = {
      key: payment.keyId,
      amount: payment.amountPaise,
      currency: payment.currency || 'INR',
      order_id: payment.razorpayOrderId,
      name: 'PalmPyaar',
      description: 'Personalized palm & zodiac reading',
      prefill: { name: data.name },
      theme: { color: '#B5555C' },
      handler: function (response) {
        verifyPayment(response, data);
      },
      modal: {
        ondismiss: function () {
          resetUnlockButton();
        }
      }
    };

    try {
      rzpInstance = new window.Razorpay(options);
      rzpInstance.on('payment.failed', function (resp) {
        var detail = resp && resp.error && resp.error.description;
        setError('Payment failed' + (detail ? ': ' + detail : '.') + ' You have not been charged. Please try again.');
        resetUnlockButton();
      });
      rzpInstance.open();
    } catch (err) {
      setError('Could not open the payment window. Please try again.');
      resetUnlockButton();
    }
  }

  function startCheckout() {
    var data = validateInputs();
    if (!data) return;

    setError('');
    setButtonBusy('Preparing secure payment\u2026');

    fetch('/api/create-payment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    })
      .then(function (response) {
        return response.json().then(function (json) {
          return { status: response.status, body: json };
        });
      })
      .then(function (res) {
        if (res.body && res.body.success && res.body.payment) {
          currentOrderId = res.body.payment.orderId;
          currentStateToken = res.body.payment.stateToken;
          loadRazorpayScript()
            .then(function () {
              openRazorpayCheckout(res.body.payment, data);
            })
            .catch(function (err) {
              setError(err.message || 'Could not load the payment gateway. Please try again.');
              resetUnlockButton();
            });
        } else {
          setError((res.body && res.body.error) || 'Payment initialization failed. Please try again.');
          resetUnlockButton();
        }
      })
      .catch(function () {
        setError('Network error connecting to the payment server. Please check your connection.');
        resetUnlockButton();
      });
  }

  function init() {
    unlockBtn = $('unlock-btn');
    checkoutError = $('checkout-error');
    form = $('reading-form');

    if (unlockBtn) {
      unlockBtn.addEventListener('click', function (e) {
        e.preventDefault();
        startCheckout();
      });
    }
  }

  window.PalmCheckout = {
    startCheckout: startCheckout
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
