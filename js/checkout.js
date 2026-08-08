/**
 * PalmPyaar checkout — collects form inputs, validates, calls /api/create-payment
 * and renders the direct UPI payment panel (Google Pay / PhonePe / Paytm deep link,
 * UPI ID copy, and the "I've paid" UTR submission form).
 *
 * Direct UPI has no automatic server confirmation, so this flow NEVER grants access.
 * The customer submits their UTR and the owner confirms manually via
 * /api/admin-confirm-payment, which mints the token for /result.html.
 */
(function () {
  'use strict';

  var unlockBtn = null;
  var checkoutError = null;
  var form = null;
  var ctaBlock = null;
  var panel = null;
  var currentOrderId = '';

  function setError(message) {
    if (!checkoutError) {
      checkoutError = document.getElementById('checkout-error');
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
    if (!form) form = document.getElementById('reading-form');
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

    setError('');
    return {
      name: name,
      dob: dob,
      birthplace: birthplace,
      tradition: tradition,
      photoHash: photoHash
    };
  }

  function $(id) {
    return document.getElementById(id);
  }

  function setUtrStatus(message, isError) {
    var status = $('payment-utr-status');
    if (!status) return;
    status.textContent = message || '';
    status.hidden = !message;
    status.setAttribute('role', isError ? 'alert' : 'status');
    status.setAttribute('data-state', isError ? 'error' : 'success');
  }

  function copyUpiId() {
    var upiIdEl = $('payment-upi-id');
    if (!upiIdEl || !upiIdEl.textContent) return;
    var text = upiIdEl.textContent.trim();

    function copied() {
      var btn = $('payment-copy-btn');
      if (btn) {
        var original = btn.textContent;
        btn.textContent = 'Copied ✓';
        setTimeout(function () { btn.textContent = original; }, 1600);
      }
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(copied, function () {
        fallbackCopy(text, copied);
      });
    } else {
      fallbackCopy(text, copied);
    }
  }

  function fallbackCopy(text, done) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'absolute';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      done();
    } catch (e) { /* ignore */ }
    document.body.removeChild(ta);
  }

  function showPaymentPanel(payment) {
    currentOrderId = payment.orderId;

    if (form) form.hidden = true;
    if ($('teaser-flow')) $('teaser-flow').hidden = true;
    if ($('teaser-reveal')) $('teaser-reveal').hidden = true;
    if (ctaBlock) ctaBlock.hidden = true;

    if (panel) panel.hidden = false;

    var amountEl = $('payment-amount');
    if (amountEl) amountEl.textContent = '\u20B9' + payment.amount;

    var payeeEl = $('payment-payee');
    if (payeeEl) payeeEl.textContent = payment.payeeName;

    var upiIdEl = $('payment-upi-id');
    if (upiIdEl) upiIdEl.textContent = payment.upiId;

    var deepLinkBtn = $('payment-deeplink-btn');
    if (deepLinkBtn) {
      deepLinkBtn.href = payment.deepLink;
      deepLinkBtn.target = '_blank';
    }

    setUtrStatus('', false);
    var utrInput = $('payment-utr-input');
    if (utrInput) utrInput.value = '';

    if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function backToForm() {
    currentOrderId = '';
    if (panel) panel.hidden = true;
    if (form) form.hidden = false;
    if ($('teaser-flow')) $('teaser-flow').hidden = false;
    if ($('teaser-reveal')) $('teaser-reveal').hidden = false;
    if (ctaBlock) ctaBlock.hidden = false;
  }

  function resetUnlockButton(originalBtnText) {
    if (unlockBtn) {
      unlockBtn.disabled = false;
      unlockBtn.textContent = originalBtnText;
    }
  }

  function startCheckout() {
    var data = validateInputs();
    if (!data) return;

    if (!unlockBtn) unlockBtn = $('unlock-btn');
    var originalBtnText = unlockBtn ? unlockBtn.textContent : 'Unlock full reading';

    if (unlockBtn) {
      unlockBtn.disabled = true;
      unlockBtn.textContent = 'Preparing UPI payment…';
    }

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
          showPaymentPanel(res.body.payment);
        } else {
          var errorMsg = (res.body && res.body.error) || 'Payment initialization failed. Please try again.';
          setError(errorMsg);
          resetUnlockButton(originalBtnText);
        }
      })
      .catch(function () {
        setError('Network error connecting to payment server. Please check your connection.');
        resetUnlockButton(originalBtnText);
      });
  }

  function submitUtr(e) {
    if (e) e.preventDefault();
    setUtrStatus('', false);

    var utrInput = $('payment-utr-input');
    var submitBtn = $('payment-utr-submit');
    if (!utrInput || !currentOrderId) return;

    var utr = utrInput.value.trim().toUpperCase();
    if (!/^[A-Z0-9]{8,16}$/.test(utr)) {
      setUtrStatus('Please enter the 12-character UPI transaction reference (letters and numbers only).', true);
      utrInput.focus();
      return;
    }

    var originalText = submitBtn ? submitBtn.textContent : '';
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Submitting…';
    }

    fetch('/api/verify-payment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ orderId: currentOrderId, utr: utr })
    })
      .then(function (response) {
        return response.json().then(function (json) {
          return { status: response.status, body: json };
        });
      })
      .then(function (res) {
        if (res.body && res.body.success) {
          setUtrStatus(res.body.message || 'Payment claim received. Awaiting manual confirmation for your permanent link.', false);
          utrInput.value = '';
        } else {
          setUtrStatus((res.body && res.body.error) || 'Could not submit your payment claim. Please try again.', true);
        }
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = originalText;
        }
      })
      .catch(function () {
        setUtrStatus('Network error. Please check your connection and try again.', true);
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = originalText;
        }
      });
  }

  function init() {
    unlockBtn = $('unlock-btn');
    checkoutError = $('checkout-error');
    form = $('reading-form');
    ctaBlock = $('cta-block');
    panel = $('payment-panel');

    if (unlockBtn) {
      unlockBtn.addEventListener('click', function (e) {
        e.preventDefault();
        startCheckout();
      });
    }

    var copyBtn = $('payment-copy-btn');
    if (copyBtn) {
      copyBtn.addEventListener('click', function (e) {
        e.preventDefault();
        copyUpiId();
      });
    }

    var utrForm = $('payment-utr-form');
    if (utrForm) {
      utrForm.addEventListener('submit', submitUtr);
    }

    var backBtn = $('payment-back-btn');
    if (backBtn) {
      backBtn.addEventListener('click', function (e) {
        e.preventDefault();
        backToForm();
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
