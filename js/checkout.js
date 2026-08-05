/**
 * PalmPyaar checkout — collects form inputs, validates, calls /api/create-payment
 * and redirects to Instamojo checkout URL.
 */
(function () {
  'use strict';

  var unlockBtn = null;
  var checkoutError = null;
  var form = null;

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

  function startCheckout() {
    var data = validateInputs();
    if (!data) return;

    if (!unlockBtn) unlockBtn = document.getElementById('unlock-btn');
    var originalBtnText = unlockBtn ? unlockBtn.textContent : 'Unlock full reading — ₹49';

    if (unlockBtn) {
      unlockBtn.disabled = true;
      unlockBtn.textContent = 'Connecting to payment gateway…';
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
        if (res.body && res.body.success && res.body.paymentUrl) {
          window.location.href = res.body.paymentUrl;
        } else {
          var errorMsg = (res.body && res.body.error) || 'Payment initialization failed. Please try again.';
          setError(errorMsg);
          if (unlockBtn) {
            unlockBtn.disabled = false;
            unlockBtn.textContent = originalBtnText;
          }
        }
      })
      .catch(function (err) {
        setError('Network error connecting to payment server. Please check your connection.');
        if (unlockBtn) {
          unlockBtn.disabled = false;
          unlockBtn.textContent = originalBtnText;
        }
      });
  }

  function checkUrlParams() {
    var params = new URLSearchParams(window.location.search);
    var paymentStatus = params.get('payment');
    if (paymentStatus === 'failed') {
      setError('Payment was not completed. Please try again to unlock your full reading.');
    } else if (paymentStatus === 'missing_params' || paymentStatus === 'error') {
      setError('Payment verification encountered an issue. Please try again.');
    }
  }

  function init() {
    unlockBtn = document.getElementById('unlock-btn');
    checkoutError = document.getElementById('checkout-error');
    form = document.getElementById('reading-form');

    if (unlockBtn) {
      unlockBtn.addEventListener('click', function (e) {
        e.preventDefault();
        startCheckout();
      });
    }

    checkUrlParams();
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
