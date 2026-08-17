/**
 * PalmPyaar Questions — Post-payment question UI controller
 *
 * After a paid reading is unlocked, the customer can ask up to 3 follow-up
 * questions. The question token (HMAC-signed) is exchanged server-side for
 * each answer, and a new token with the incremented count is returned.
 *
 * Refresh persistence:
 * The URL always contains the ORIGINAL qToken issued at payment time
 * (questionCount = 0). Refreshing the page must not silently reset the
 * user's entitlement back to 3 questions. The latest server-issued qToken
 * is therefore mirrored into localStorage, scoped to this specific reading
 * (keyed by orderId, or readingToken if orderId is unavailable), and is
 * preferred over the URL token whenever it represents an equal or greater
 * question count for the SAME reading.
 *
 * This is a UX/persistence convenience only. The server is the sole source
 * of truth: it always re-derives the authoritative question count from the
 * verified, HMAC-signed qToken (see api/ask-question.js) and never trusts
 * any client-supplied questionCount/remainingQuestions/maxQuestions. A
 * tampered or stale localStorage value can, at worst, cause the frontend to
 * try an invalid/older token — the server will reject it (403) and the
 * frontend falls back to the URL token gracefully.
 *
 * Known limitation: because this architecture is intentionally stateless
 * and database-free, the server cannot prove that an older-but-still-valid
 * signed qToken was already superseded (no server-side replay store exists
 * by design). localStorage significantly reduces the practical chance of a
 * user accidentally reusing a stale token after a normal refresh, but it is
 * not a security boundary — the signed questionCount inside each qToken is.
 */
(function () {
  'use strict';

  var MAX_QUESTIONS = 3;
  var STORAGE_PREFIX = 'palmpyaar_qtoken:';

  var questionForm = null;
  var questionInput = null;
  var questionList = null;
  var questionCountEl = null;
  var submitBtn = null;
  var questionError = null;
  var currentQuestionToken = null;
  var currentReadingToken = null;
  var currentParams = {};
  var currentStorageKey = null;
  var restoredExhausted = false;
  var submitted = [];

  function $(id) {
    return document.getElementById(id);
  }

  function setError(message) {
    if (!questionError) {
      questionError = $('question-error');
    }
    if (!questionError) return;
    if (message) {
      questionError.textContent = message;
      questionError.hidden = false;
    } else {
      questionError.textContent = '';
      questionError.hidden = true;
    }
  }

  function renderQuestionHistory() {
    if (!questionList) return;
    questionList.innerHTML = '';
    for (var i = 0; i < submitted.length; i++) {
      var entry = submitted[i];
      var div = document.createElement('div');
      div.className = 'question-item';
      div.innerHTML =
        '<p class="question-item__q"><strong>Q' + (i + 1) + ':</strong> ' + escapeHtml(entry.question) + '</p>' +
        '<p class="question-item__a">' + entry.answer + '</p>';
      questionList.appendChild(div);
    }
  }

  function updateCountDisplay() {
    if (!questionCountEl) return;
    var remaining = MAX_QUESTIONS - submitted.length;
    questionCountEl.textContent =
      remaining > 0
        ? remaining + ' question' + (remaining > 1 ? 's' : '') + ' remaining'
        : 'All questions used';
    questionCountEl.className = 'question-count ' + (remaining > 0 ? 'has-questions' : 'no-questions');
  }

  function setSubmitBusy(text) {
    if (!submitBtn) return;
    submitBtn.disabled = true;
    submitBtn.setAttribute('aria-disabled', 'true');
    submitBtn.textContent = text || 'Asking…';
  }

  function resetSubmitButton() {
    if (!submitBtn) return;
    submitBtn.disabled = false;
    submitBtn.setAttribute('aria-disabled', 'false');
    submitBtn.textContent = 'Ask';
  }

  function lockQuestionsExhausted() {
    if (questionInput) questionInput.disabled = true;
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.setAttribute('aria-disabled', 'true');
      submitBtn.textContent = 'All questions used';
    }
  }

  function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Derive a storage key scoped to this specific reading/order. Uses orderId
   * when available (non-secret, non-personal identifier already present in
   * the result URL), falling back to the readingToken (a one-way HMAC digest
   * that reveals nothing about the underlying birth data). Never includes
   * raw personal data or secrets in the key.
   * @param {string} orderId
   * @param {string} readingToken
   * @returns {string|null}
   */
  function deriveStorageKey(orderId, readingToken) {
    var id = (orderId && String(orderId).trim()) || (readingToken && String(readingToken).trim()) || '';
    if (!id) return null;
    return STORAGE_PREFIX + id;
  }

  /**
   * Decode (WITHOUT verifying) a qToken's payload for display/restore
   * purposes only. This never validates the HMAC signature — the frontend
   * has no access to TOKEN_SECRET and cannot verify tokens. The server
   * (api/ask-question.js) always independently re-verifies the signature
   * and re-derives questionCount before honoring any request; this function
   * only powers optimistic UI restoration.
   * @param {string} token
   * @returns {object|null}
   */
  function decodeQuestionTokenPayload(token) {
    if (typeof token !== 'string' || !token) return null;
    var idx = token.lastIndexOf('.');
    if (idx <= 0 || idx === token.length - 1) return null;
    var body = token.slice(0, idx);
    try {
      var base64 = body.replace(/-/g, '+').replace(/_/g, '/');
      while (base64.length % 4) base64 += '=';

      var jsonStr;
      if (typeof atob === 'function') {
        var binary = atob(base64);
        var bytes = [];
        for (var i = 0; i < binary.length; i++) {
          bytes.push('%' + ('00' + binary.charCodeAt(i).toString(16)).slice(-2));
        }
        jsonStr = decodeURIComponent(bytes.join(''));
      } else if (typeof Buffer !== 'undefined') {
        jsonStr = Buffer.from(base64, 'base64').toString('utf8');
      } else {
        return null;
      }

      var payload = JSON.parse(jsonStr);
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
      if (!Number.isInteger(payload.questionCount)) return null;
      if (!Array.isArray(payload.questions)) return null;
      return payload;
    } catch (e) {
      return null;
    }
  }

  /**
   * Decide which qToken the frontend should use as current: the one from
   * the URL (always questionCount = 0, issued at payment time) or a newer
   * one previously saved to localStorage for this same reading.
   *
   * The stored token is only preferred when:
   *  - it decodes successfully (otherwise it is corrupt/tampered — ignored)
   *  - it belongs to the SAME reading as the URL token (readingToken match),
   *    when the URL token is itself decodable
   *  - its questionCount is greater than or equal to the URL token's
   *
   * This is a UI convenience decision only. It never grants entitlement by
   * itself — whichever token is chosen still must pass full HMAC and
   * readingToken verification server-side on the next request.
   * @param {string} urlToken
   * @param {string} storedToken
   * @returns {string}
   */
  function chooseEffectiveToken(urlToken, storedToken) {
    var storedPayload = decodeQuestionTokenPayload(storedToken);
    if (!storedPayload) return urlToken || '';

    var urlPayload = decodeQuestionTokenPayload(urlToken);
    if (urlPayload && storedPayload.readingToken && urlPayload.readingToken &&
        storedPayload.readingToken !== urlPayload.readingToken) {
      return urlToken || '';
    }

    if (urlPayload && storedPayload.questionCount < urlPayload.questionCount) {
      return urlToken || '';
    }

    return storedToken;
  }

  function readStoredToken(storageKey) {
    if (!storageKey || typeof window === 'undefined' || !window.localStorage) return '';
    try {
      return window.localStorage.getItem(storageKey) || '';
    } catch (e) {
      return '';
    }
  }

  function saveTokenToStorage(storageKey, token) {
    if (!storageKey || typeof window === 'undefined' || !window.localStorage) return;
    try {
      window.localStorage.setItem(storageKey, token);
    } catch (e) {
      // localStorage may be unavailable (private browsing, quota exceeded,
      // disabled storage). This is a UX convenience only — fail silently.
    }
  }

  function validateInput() {
    if (!questionInput) return null;
    var q = questionInput.value.trim();
    if (!q) {
      setError('Please enter your question first.');
      questionInput.focus();
      return null;
    }
    if (q.length > 500) {
      setError('Questions must be 500 characters or fewer.');
      questionInput.focus();
      return null;
    }
    setError('');
    return q;
  }

  function submitQuestion() {
    var question = validateInput();
    if (!question) return;

    setSubmitBusy('Asking…');

    var payload = Object.assign({}, currentParams, {
      question: question,
      questionToken: currentQuestionToken,
      readingToken: currentReadingToken
    });

    fetch('/api/ask-question', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (res) {
        return res.text().then(function (text) {
          var json = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch (e) {
            json = { success: false, error: 'Unexpected server response. Please try again.' };
          }
          return { status: res.status, ok: res.ok, body: json };
        });
      })
      .then(function (res) {
        if (res.ok && res.body && res.body.success) {
          if (res.body.questionToken) {
            currentQuestionToken = res.body.questionToken;
            saveTokenToStorage(currentStorageKey, currentQuestionToken);
          } else if (res.body.remainingQuestions > 0) {
            setError('Question token was not refreshed. Please reload your saved result link before asking again.');
            resetSubmitButton();
            return;
          }

          submitted.push({
            question: question,
            answer: res.body.answer || '(No answer generated)'
          });

          renderQuestionHistory();
          updateCountDisplay();

          if (res.body.remainingQuestions === 0) {
            restoredExhausted = true;
            lockQuestionsExhausted();
          } else {
            resetSubmitButton();
          }

          if (questionInput) questionInput.value = '';
        } else {
          setError((res.body && res.body.error) || 'Could not process your question. Please try again.');
          resetSubmitButton();
        }
      })
      .catch(function () {
        setError('Network error. If the problem persists, please refresh the page.');
        resetSubmitButton();
      });
  }

  /**
   * Re-derive the effective token/history/lock state from the URL and
   * localStorage. Safe to call multiple times (e.g. on bfcache restore via
   * the pageshow event) since it never re-binds event listeners.
   */
  function restoreState() {
    var params = new URLSearchParams(window.location.search);
    currentParams = {
      name: params.get('name') || '',
      dob: params.get('dob') || '',
      birthTime: params.get('birthTime') || '',
      birthplace: params.get('birthplace') || '',
      tradition: params.get('tradition') || 'western',
      photoHash: params.get('photoHash') || '',
      orderId: params.get('orderId') || '',
      palmEvidence: params.get('palmEvidence') || null,
      nakshatraMode: params.get('nakshatraMode') || '',
      nakshatra: params.get('nakshatra') || ''
    };

    currentReadingToken = params.get('token') || '';

    var urlQuestionToken = params.get('qToken') || '';
    currentStorageKey = deriveStorageKey(currentParams.orderId, currentReadingToken);
    var storedToken = readStoredToken(currentStorageKey);
    currentQuestionToken = chooseEffectiveToken(urlQuestionToken, storedToken);

    var payload = decodeQuestionTokenPayload(currentQuestionToken);
    if (payload) {
      submitted = payload.questions.map(function (q) {
        return { question: q.text, answer: q.answer };
      });
      restoredExhausted = payload.questionCount >= MAX_QUESTIONS;
    } else {
      submitted = [];
      restoredExhausted = false;
    }

    renderQuestionHistory();
    updateCountDisplay();

    if (restoredExhausted) {
      lockQuestionsExhausted();
    }

    // Persist the effective token so a fresh visit (no stored token yet)
    // seeds storage, and so re-choosing the same token is idempotent.
    if (currentQuestionToken) {
      saveTokenToStorage(currentStorageKey, currentQuestionToken);
    }
  }

  function init() {
    questionForm = $('question-form');
    questionInput = $('question-input');
    questionList = $('question-list');
    questionCountEl = $('question-count');
    submitBtn = $('question-submit');
    questionError = $('question-error');

    if (questionForm && submitBtn) {
      submitBtn.addEventListener('click', function (e) {
        e.preventDefault();
        submitQuestion();
      });
    }

    if (questionForm) {
      questionForm.addEventListener('submit', function (e) {
        e.preventDefault();
        submitQuestion();
      });
    }

    // Safety net: reveal.js re-enables the question input/button
    // asynchronously once the reading finishes loading, regardless of
    // question entitlement state. If this page load restored an already
    // exhausted qToken (questionCount >= MAX_QUESTIONS), re-assert the
    // locked state if anything re-enables these controls afterward.
    if (typeof MutationObserver !== 'undefined') {
      var reassertLock = function () {
        if (!restoredExhausted) return;
        if (questionInput && !questionInput.disabled) questionInput.disabled = true;
        if (submitBtn && (!submitBtn.disabled || submitBtn.textContent !== 'All questions used')) {
          lockQuestionsExhausted();
        }
      };
      var observer = new MutationObserver(reassertLock);
      if (submitBtn) observer.observe(submitBtn, { attributes: true, attributeFilter: ['disabled'] });
      if (questionInput) observer.observe(questionInput, { attributes: true, attributeFilter: ['disabled'] });
    }

    restoreState();
  }

  if (typeof window !== 'undefined') {
    window.PalmQuestions = {
      submitQuestion: submitQuestion,
      currentQuestionToken: function () { return currentQuestionToken; },
      currentReadingToken: function () { return currentReadingToken; }
    };

    // Handle bfcache-restored page views (browser back/forward navigation)
    // by re-running state restoration without re-binding listeners.
    window.addEventListener('pageshow', function (e) {
      if (e && e.persisted) {
        restoreState();
      }
    });
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  }

  // Expose pure helper functions for Node-based unit testing only. These
  // guards ensure this remains a plain browser script with no build step or
  // framework dependency; module/exports simply don't exist in a browser.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      deriveStorageKey: deriveStorageKey,
      decodeQuestionTokenPayload: decodeQuestionTokenPayload,
      chooseEffectiveToken: chooseEffectiveToken,
      MAX_QUESTIONS: MAX_QUESTIONS,
      STORAGE_PREFIX: STORAGE_PREFIX
    };
  }
})();
