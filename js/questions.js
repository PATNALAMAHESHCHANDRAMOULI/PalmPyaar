/**
 * PalmPyaar Questions — Post-payment question UI controller
 *
 * After a paid reading is unlocked, the customer can ask up to 3 follow-up
 * questions. The question token (HMAC-signed) is exchanged server-side for
 * each answer, and a new token with the incremented count is returned.
 */
(function () {
  'use strict';

  var MAX_QUESTIONS = 3;
  var questionForm = null;
  var questionInput = null;
  var questionList = null;
  var questionCountEl = null;
  var submitBtn = null;
  var questionError = null;
  var currentQuestionToken = null;
  var currentReadingToken = null;
  var currentParams = {};
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

  function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
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
            if (questionInput) questionInput.disabled = true;
            if (submitBtn) {
              submitBtn.disabled = true;
              submitBtn.setAttribute('aria-disabled', 'true');
              submitBtn.textContent = 'All questions used';
            }
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

  function init() {
    questionForm = $('question-form');
    questionInput = $('question-input');
    questionList = $('question-list');
    questionCountEl = $('question-count');
    submitBtn = $('question-submit');
    questionError = $('question-error');

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

    currentQuestionToken = params.get('qToken') || '';
    currentReadingToken = params.get('token') || '';

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

    updateCountDisplay();
  }

  window.PalmQuestions = {
    submitQuestion: submitQuestion,
    currentQuestionToken: function () { return currentQuestionToken; },
    currentReadingToken: function () { return currentReadingToken; }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
