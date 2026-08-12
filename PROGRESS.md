# PalmPyaar Progress

### Phase 1 — Static shell + free teaser — 2026-08-05
Files created/modified:
- `index.html`
- `css/style.css`
- `js/teaser.js`
- `content/templates.js`
- `refund-policy.html` (minimal — required by Section 6 refund link before payment)
- `.gitignore`

Key decisions made:
- Asset paths use relative URLs (`css/style.css`, `js/teaser.js`, `content/templates.js`) so the shell works with simple static serving as well as Vercel.
- Unlock button is a stub: enabled once a teaser is shown; click handler is a no-op until Phase 2 wires Instamojo.
- Teaser seed combines Western zodiac sign (real calendar boundaries) + optional photo SHA-256 hash; tradition selects the template pool (Western / Vedic / Hellenic).
- Signature SVG is one continuous path (palm curve → constellation segments); animation respects `prefers-reduced-motion`.
- Tradition selector uses W / V / H pill radios per Section 5 layout spec (not a dropdown).
- Noto Sans loaded for name input fallback stack (Indian-script rendering per Section 5).
- Refund-policy link visible in CTA block and footer before payment (Section 6); `refund-policy.html` holds minimal compliant copy until Phase 4 expands it.
- “How it works” 01/02/03 section included per design spec layout guidance.

Env vars now required: (none — Phase 1 is fully client-side)

Deviations from spec, if any:
- None material. Relative asset paths instead of root-absolute `/css/…` paths (improves local preview; Vercel-compatible).
- `refund-policy.html` created early (Phase 4 scope) because Section 6 requires a visible refund link before payment on `index.html`.

Phase 1 audit (2026-08-05 review pass) — gaps found and fixed:
- Missing Section 6 refund-policy link before payment → added link + minimal `refund-policy.html`
- Missing Section 5 W/V/H tradition layout → replaced dropdown with pill radio selector
- Missing Noto Sans on name input for Indian-script fallback → font loaded + `.field__input--name`
- Signature SVG had discontinuous subpath → redrawn as one continuous path
- Missing layout cue “→ your free line appears” → added `.teaser-flow` indicator
- Missing CTA price/includes/refund visibility per Section 5 checkout guidance → added includes line + refund link
- UI polish pass: ambient depth, form panel card, page fade-in, cinematic teaser reveal, premium spacing/typography

What's next: Phase 2 — Payment integration. Confirm Section 7a (Instamojo sandbox or live credentials), then implement `/api/create-payment.js` and `/api/verify-payment.js`.

To resume in a different tool: "Read PROJECT_SPEC.md and PROGRESS.md, then continue Phase 2."

---

### Phase 2 — Payment integration — 2026-08-05
Files created/modified:
- `api/create-payment.js`
- `api/verify-payment.js`
- `js/checkout.js`
- `js/teaser.js`
- `index.html`
- `css/style.css`
- `.env.example`
- `PROGRESS.md`

Key decisions made:
- `/api/create-payment.js` receives buyer inputs, determines amount by selected tier (₹49 Standard, ₹79 Couples, ₹149 All Traditions), builds the return `redirect_url` with encoded user parameters, and calls Instamojo Payment Requests API.
- `/api/verify-payment.js` receives the Instamojo redirect server-side, validates payment status with Instamojo API to ensure `status === 'Credit'`, computes signed HMAC-SHA256 token over buyer inputs + orderId, and performs HTTP 302 redirect to `/result.html`.
- Added `js/checkout.js` to handle form input validation, tier selection, loading state, error display, and invocation of `/api/create-payment`.
- Tier selector UI added to `index.html` CTA block supporting Standard (₹49), Couples (₹79), and All Traditions (₹149) with clean responsive styling.
- `js/teaser.js` updated to expose `window.PalmTeaser.getPhotoHash()` so `checkout.js` can attach the client-side SHA-256 photo hash without raw upload.

Env vars now required:
- `INSTAMOJO_API_KEY`
- `INSTAMOJO_AUTH_TOKEN`
- `TOKEN_SECRET`

Deviations from spec, if any:
- None. Followed all Instamojo API and token signing specifications.

Phase 2 security hardening review pass:
- Cleaned up HTTP status error response logic in `/api/create-payment.js`.
- Added input sanitization and strict 100-character length limits for `name` and `birthplace` inputs in both API handlers.
- Added `AbortController` timeouts (10 seconds) for all server-side Instamojo API HTTP calls to prevent serverless function hangs.
- Enforced mandatory `TOKEN_SECRET` requirement in `/api/verify-payment.js` (removed default secret fallback).
- Strictly verified payment status against documented Instamojo success state (`payment.status === 'Credit'`).
- Added explicit inline security decision documentation across all backend handlers.

What's next: Phase 3 — Backend reading generation (`/api/generate-reading.js`).

---

### Phase 3 (UI & Client Reveal) — 2026-08-05
Files created/modified:
- `result.html`
- `js/reveal.js`
- `css/style.css`
- `PROGRESS.md`

Key decisions made:
- Implemented `result.html` with premium dark theme (`--night`), access-denied state for missing tokens, animated loading state, structured reading sections, and WhatsApp permanent link sharing button.
- Implemented `js/reveal.js` client controller that verifies HMAC `token` in URL, displays premium loading animation, and attempts `fetch('/api/generate-reading')` while falling back seamlessly to structured placeholder reading data for this non-AI UI stage.
- Maintained architecture ready for `/api/generate-reading.js` integration.

Env vars now required:
- `INSTAMOJO_API_KEY`
- `INSTAMOJO_AUTH_TOKEN`
- `TOKEN_SECRET`

Deviations from spec, if any:
- None.

What's next: Phase 3 — Template Engine expansion & Gemini integration (`providers/geminiProvider.js`).

---

### Phase 3 (Backend API & Provider Architecture) — 2026-08-05
Files created/modified:
- `api/generate-reading.js`
- `providers/templateProvider.js`
- `providers/geminiProvider.js`
- `PROGRESS.md`

Key decisions made:
- Implemented `/api/generate-reading.js` serverless function as the single public endpoint for reading generation.
- Enforced server-side HMAC-SHA256 token verification using `TOKEN_SECRET` and `crypto.timingSafeEqual` to prevent paywall bypass and timing side-channel attacks.
- Created `providers/templateProvider.js` implementing deterministic template-based reading generation returning structured reading sections (`core`, `love`, `pro`).
- Created `providers/geminiProvider.js` as a stub with an identical, interchangeable provider interface (`generateReading(params)`), delegating to `templateProvider` until AI integration is activated.
- Preserved frontend and payment files without modification.

Env vars now required:
- `INSTAMOJO_API_KEY`
- `INSTAMOJO_AUTH_TOKEN`
- `TOKEN_SECRET`
- `AI_READING` (optional, toggle for AI provider)

Deviations from spec, if any:
- None.

Phase 3 template provider fixes:
- Added missing Libra zodiac sign (`September 23 to October 22`) in `providers/templateProvider.js`.
- Added reusable `escapeHtml()` helper in `providers/templateProvider.js` to sanitize `name`, `birthplace`, `tradition`, and all user inputs before HTML interpolation, preventing XSS/injection vulnerabilities.

What's next: Phase 4 — Trust & compliance pages (`refund-policy.html`, `privacy.html`).

---

### Phase 4 — Development Payment Bypass — 2026-08-05
Files modified:
- `api/create-payment.js`

Key decisions made:
- Added DEVELOPMENT-ONLY payment bypass in `/api/create-payment.js`.
- Bypass activates ONLY when `process.env.DEV_BYPASS === "true"`.
- When active, bypasses Instamojo entirely, generates the same HMAC-SHA256 token as `verify-payment.js` using `TOKEN_SECRET`, and returns a direct redirect URL to `result.html` with identical query parameters (name, dob, birthplace, tradition, photoHash, orderId, token).
- The reading is still fetched through `/api/generate-reading.js` which verifies the HMAC token exactly as before.
- No client-side fake token generation, no skipping `generate-reading.js`, no changes to provider architecture or Gemini integration.
- Production flow remains completely unchanged when DEV_BYPASS is false or missing.
- Clear comments added explaining this bypass exists ONLY for local development and MUST NOT be enabled in production.

Env vars now required:
- `INSTAMOJO_API_KEY`
- `INSTAMOJO_AUTH_TOKEN`
- `TOKEN_SECRET`
- `AI_READING` (optional, toggle for AI provider)
- `GEMINI_API_KEY` (required for live AI readings)
- `DEV_BYPASS` (optional, "true" to enable dev payment bypass)

Deviations from spec, if any:
- None.

What's next: Phase 4 — Trust & compliance pages (`refund-policy.html`, `privacy.html`).

---

### Phase 4 — Development Testing Bypass — 2026-08-05
Files modified:
- `api/generate-reading.js`

Key decisions made:
- Added development-only testing bypass for HMAC token verification in `/api/generate-reading.js`.
- Bypass activates ONLY when BOTH `process.env.NODE_ENV === "development"` AND `process.env.DEV_BYPASS === "true"`.
- When active, skips HMAC token verification but continues using the selected provider (templateProvider or geminiProvider) for reading generation.
- Production behavior remains completely unchanged - token verification is always enforced when bypass conditions are not met.
- Clear comments added explaining this bypass exists ONLY for local development and MUST NOT be enabled in production.
- If DEV_BYPASS is not true, existing security behaves exactly as before.

Env vars now required:
- `INSTAMOJO_API_KEY`
- `INSTAMOJO_AUTH_TOKEN`
- `TOKEN_SECRET`
- `AI_READING` (optional, toggle for AI provider)
- `GEMINI_API_KEY` (required for live AI readings)
- `NODE_ENV` (development/production)
- `DEV_BYPASS` (optional, "true" to enable dev bypass)

Deviations from spec, if any:
- None.

What's next: Phase 4 — Trust & compliance pages (`refund-policy.html`, `privacy.html`).

---

### Phase 4 — Gemini Provider Preparation — 2026-08-05
Files modified:
- `providers/geminiProvider.js`

Key decisions made:
- Updated `providers/geminiProvider.js` export to include `name: "gemini"` for provider identification.
- Added clear TODO comments showing exactly where the Gemini API call will be inserted.
- Maintained fallback to `templateProvider` for all errors.
- No API calls added yet — provider remains a stub ready for live integration.
- `templateProvider.js` unchanged.
- `generate-reading.js` unchanged.

Env vars now required:
- `INSTAMOJO_API_KEY`
- `INSTAMOJO_AUTH_TOKEN`
- `TOKEN_SECRET`
- `AI_READING` (optional, toggle for AI provider)
- `GEMINI_API_KEY` (future, for live integration)

Deviations from spec, if any:
- None.

What's next: Phase 4 — Trust & compliance pages (`refund-policy.html`, `privacy.html`).

To resume in a different tool: "Read PROJECT_SPEC.md and PROGRESS.md, then continue Phase 4."

---

### Phase 4 — Prompt Architecture Preparation — 2026-08-05
Files created/modified:
- `prompts/readingPrompt.js` (created)
- `providers/geminiProvider.js` (modified)

Key decisions made:
- Created `prompts/readingPrompt.js` with `buildReadingPrompt(params)` function returning a placeholder string.
- Updated `providers/geminiProvider.js` with TODO comments showing where to import and use `buildReadingPrompt()`.
- No real prompt written yet — placeholder only.
- No Gemini API calls added.
- `generate-reading.js` unchanged.
- `templateProvider.js` unchanged.

Env vars now required:
- `INSTAMOJO_API_KEY`
- `INSTAMOJO_AUTH_TOKEN`
- `TOKEN_SECRET`
- `AI_READING` (optional, toggle for AI provider)
- `GEMINI_API_KEY` (future, for live integration)

Deviations from spec, if any:
- None.

What's next: Phase 4 — Trust & compliance pages (`refund-policy.html`, `privacy.html`).

---

### Phase 4 — Live Gemini Integration — 2026-08-05
Files modified:
- `providers/geminiProvider.js`

Key decisions made:
- Implemented live Gemini API integration using the official Google Generative AI JavaScript SDK (`@google/generative-ai`).
- Uses model `gemini-2.5-flash-lite` as specified.
- Reads `process.env.GEMINI_API_KEY` for authentication.
- Imports `buildReadingPrompt()` from `prompts/readingPrompt.js` to construct the prompt.
- Sends a single request to Gemini expecting plain text response (not JSON).
- Added `parseGeminiResponse()` helper to split plain text into `{ core, love, pro }` sections using section headers or paragraph distribution.
- Robust fallback: on ANY error (API error, timeout, invalid response, missing API key, empty response), immediately falls back to `templateProvider.generateReading(params)`.
- Never throws uncaught errors, never breaks the reading flow.
- 15-second timeout via AbortController to prevent serverless function hangs.
- `generate-reading.js` unchanged.
- `templateProvider.js` unchanged.
- `readingPrompt.js` unchanged (still uses placeholder prompt).

Env vars now required:
- `INSTAMOJO_API_KEY`
- `INSTAMOJO_AUTH_TOKEN`
- `TOKEN_SECRET`
- `AI_READING` (optional, toggle for AI provider)
- `GEMINI_API_KEY` (now required for live AI readings)

Deviations from spec, if any:
- None.

What's next: Phase 4 — Trust & compliance pages (`refund-policy.html`, `privacy.html`).

---

### Phase 4 — Single Pricing Model Migration — 2026-08-05
Architecture Update (Current State)

PalmPyaar now uses a single pricing model.

The historical Phase 2 entries below describe the earlier multi-tier implementation that has since been removed.

Current application behavior:
- One product only
- Unlock Full Reading — ₹49
- No tier selection
- No package selector
- No Couples Bundle
- No All Traditions pricing
Files modified:
- `api/create-payment.js`
- `api/verify-payment.js`
- `api/generate-reading.js`
- `js/checkout.js`
- `js/reveal.js`
- `providers/templateProvider.js`
- `providers/geminiProvider.js`

Key decisions made:
- Removed all multi-tier pricing references (Couples Bundle, ₹79, ₹149, tier, pricing cards, package selector, tier validation, tier parameter).
- Single pricing model: "Unlock Full Reading — ₹49" only.
- Updated HMAC-SHA256 payload in both `/api/verify-payment.js` and `/api/generate-reading.js` to exclude `tier` parameter for consistency.
- Removed `tier` from provider interface (`generateReading` params) in both `templateProvider.js` and `geminiProvider.js`.
- Removed `tier` from URL parameters and client-side logic in `js/reveal.js`.
- Verified zero remaining "tier" references across entire project.

Env vars now required:
- `INSTAMOJO_API_KEY`
- `INSTAMOJO_AUTH_TOKEN`
- `TOKEN_SECRET`
- `AI_READING` (optional, toggle for AI provider)

Deviations from spec, if any:
- None.

What's next: Phase 4 — Trust & compliance pages (`refund-policy.html`, `privacy.html`).

---

### Phase 4 — Project Setup for Gemini SDK — 2026-08-05
Files created/modified:
- `package.json` (created)

Key decisions made:
- Created `package.json` in project root with single dependency: `@google/generative-ai` (v0.21.0).
- No other dependencies added.
- No application code, providers, prompts, or APIs modified.
- This prepares the project for the official Gemini SDK used in `providers/geminiProvider.js`.

Env vars now required:
- `INSTAMOJO_API_KEY`
- `INSTAMOJO_AUTH_TOKEN`
- `TOKEN_SECRET`
- `AI_READING` (optional, toggle for AI provider)
- `GEMINI_API_KEY` (required for live AI readings)

Deviations from spec, if any:
- None.

What's next: Phase 4 — Trust & compliance pages (`refund-policy.html`, `privacy.html`).

---

### Phase 4 — Production-Ready Gemini Prompt — 2026-08-05
Files modified:
- `prompts/readingPrompt.js`

Key decisions made:
- Replaced placeholder prompt with production-ready Gemini prompt in `buildReadingPrompt(params)`.
- Prompt generates entertainment-only readings with premium, elegant, mysterious, emotionally intelligent, modern voice.
- Never claims certainty, never promises future events, never mentions being an AI, never mentions prompts/system instructions.
- Personalizes using: name, DOB (formatted), birthplace, tradition (with label mapping), zodiac sign (calculated from DOB), optional photo hash indicator.
- Response structure enforced with exact section markers: ===CORE===, ===LOVE===, ===PRO===.
- CORE: personality, strengths, challenges, palm + zodiac interpretation (2-3 paragraphs).
- LOVE: relationship energy, communication, emotional patterns, gentle guidance (2-3 paragraphs).
- PRO: career, creativity, next 12 months as thematic landscape, practical reflection (2-3 paragraphs).
- Beautiful, concise paragraphs; no markdown; no JSON; ends with entertainment disclaimer.
- Zodiac sign calculated from DOB using standard Western boundaries.
- Tradition labels mapped: western→Western, vedic→Vedic, hellenic→Hellenic.
- Photo hash included as subtle reference when provided (first 8 chars).

Env vars now required:
- `INSTAMOJO_API_KEY`
- `INSTAMOJO_AUTH_TOKEN`
- `TOKEN_SECRET`
- `AI_READING` (optional, toggle for AI provider)
- `GEMINI_API_KEY` (required for live AI readings)

Deviations from spec, if any:
- None.

What's next: Phase 4 — Trust & compliance pages (`refund-policy.html`, `privacy.html`).

---

### Phase 4 — Prompt & Provider Refinements — 2026-08-05
Files modified:
- `providers/geminiProvider.js`
- `prompts/readingPrompt.js`

Key decisions made:
- Updated `parseGeminiResponse()` in `geminiProvider.js` to parse ONLY the exact required markers: `===CORE===`, `===LOVE===`, `===PRO===`. Removed all regex guessing and paragraph heuristics. Returns empty strings for missing sections.
- Increased Gemini temperature from 0.7 to 0.9 for more creative, varied outputs.
- Removed photo hash value from prompt. Now only states whether a palm photo was provided (no hash exposure).
- Replaced "master entertainment astrologer" with "seasoned entertainment astrologer" for a more natural writing role.
- Replaced "Never use markdown" with: "Do not use bullet lists, tables, Markdown syntax, or JSON. Use plain paragraphs beneath the required section markers."
- Added target word counts to each section:
  - CORE: 180–250 words
  - LOVE: 150–220 words
  - PRO: 180–250 words

Env vars now required:
- `INSTAMOJO_API_KEY`
- `INSTAMOJO_AUTH_TOKEN`
- `TOKEN_SECRET`
- `AI_READING` (optional, toggle for AI provider)
- `GEMINI_API_KEY` (required for live AI readings)

Deviations from spec, if any:
- None.

What's next: Phase 4 — Trust & compliance pages (`refund-policy.html`, `privacy.html`).

---

### Phase — Direct UPI payment migration (Instamojo removed) — 2026-08-08
Files created/modified:
- `api/create-payment.js` — rewritten as a direct UPI payment-intent endpoint
- `api/verify-payment.js` — rewritten as the customer "I've paid" UTR submission
- `api/admin-confirm-payment.js` — NEW owner-only token-mint endpoint
- `js/checkout.js` — rewritten to render the UPI panel + UTR form
- `index.html` — added UPI payment panel + updated CTA/honest copy
- `css/style.css` — payment panel styles
- `.env.example` — replaced Instamojo vars with UPI + admin secret vars
- `scripts/verifyProductionChecks.js`, `scripts/verifyCustomerJourney.js` — rewritten for the new flow
- `scripts/verifyUpiPaymentFlow.js` — NEW focused UPI flow test
- `PROJECT_SPEC.md`, `.cursor/rules/project.mdc`, `PROGRESS.md` — docs updated

Key decisions made:
- Migrated from the Instamojo gateway to a **direct UPI flow** (`upi://pay` deep link, Google Pay / PhonePe / Paytm compatible). No PSP, no bank API, no gateway credentials.
- Direct UPI provides **no server-side settlement callback**, so nothing can be auto-verified. The design therefore:
  - `create-payment` returns a payment intent `{ upiId, amount, payeeName, note, orderId, deepLink }` and **never** mints a token.
  - `verify-payment` records the customer's UTR claim (stateless acknowledgment) and **never** grants access.
  - `admin-confirm-payment` is the **sole grant path**: the owner verifies the credit in their own UPI app, then calls it with `ADMIN_CONFIRM_SECRET` to mint the HMAC token for `/result.html`.
- Order ID is generated server-side as `PP` + 10 random uppercase hex (12 chars, unguessable, within UPI `tid` limits) and reused as the deep link `tid` so the token binds to the real order.
- Removed the old dev-bypass grant inside `create-payment` (it auto-minted tokens in dev, which contradicts the no-fake-grant rule). `generate-reading`'s dev bypass (`NODE_ENV=development` + `DEV_BYPASS=true`) remains as the only dev shortcut.
- Price stays ₹49, now configurable via `PAYMENT_AMOUNT` (default 49) so the server is the single source of truth.
- Token payload unchanged: `HMAC-SHA256([name, dob, birthplace, tradition, photoHash, orderId].join(':'), TOKEN_SECRET)` — `generate-reading` untouched.

Security decisions:
- `admin-confirm-payment` authenticates via constant-time comparison (`crypto.timingSafeEqual`) of `ADMIN_CONFIRM_SECRET`.
- Strict input validation everywhere (100-char limits, DOB regex, tradition whitelist, photoHash = SHA-256 hex or empty, UTR = 8–16 alphanumeric, orderId format check).
- No PII in the deep link; order ID, token and photo hash never leak into logs.

Env vars now required:
- `PAYMENT_UPI_ID` (required — payee UPI ID/VPA)
- `TOKEN_SECRET` (required — HMAC signing)
- `ADMIN_CONFIRM_SECRET` (required — owner confirmation key)
- Optional: `PAYMENT_AMOUNT` (default 49), `PAYMENT_PAYEE_NAME` (default "PalmPyaar"), `PAYMENT_NOTE` (default "PalmPyaar Reading"), `AI_READING` + `GROQ_API_KEY`/`GEMINI_API_KEY`
- Dev only: `NODE_ENV=development`, `DEV_BYPASS=true`

Tests (all passing):
- `scripts/verifyUpiPaymentFlow.js` (8 checks) — deep link format, orderId uniqueness, token binding/determinism, no-auto-grant, hygiene (no Instamojo/paymentUrl/auto-grant in active code, env contract)
- `scripts/verifyProductionChecks.js` (29 checks) — validation, UPI config errors, intent contract, UTR submission never grants, admin-confirm auth/token, generate-reading gate, round-trip, no auto-grant
- `scripts/verifyCustomerJourney.js` (8 checks) — full customer journey: intent → UTR claim → owner confirm → reading
- `scripts/verifyProductionPath.js` (9 checks) — reading pipeline + token gate (orderId style updated)

Deviations from spec, if any:
- Payment is now direct UPI (spec Section 7a Instamojo plan superseded — marked in PROJECT_SPEC.md).
- Phase 2 spec updated to the new flow; env var list in Section 9 updated.
- Pre-existing failures in `scripts/testPalmEvidenceIntegrity.js` (7/13) and `scripts/testOpeningLibrary.js` (1/38) are unrelated to this migration (palm-evidence MODE B selection); not touched by this phase.

What's next: Deploy — set `PAYMENT_UPI_ID`, `ADMIN_CONFIRM_SECRET`, `TOKEN_SECRET` in Vercel, then manually test the UPI flow on a phone.

### Phase 0B — AI provider path hardening + truthful source labeling — 2026-08-12
Files created/modified:
- providers/groqProvider.js — env-configurable model/URL (GROQ_MODEL, GROQ_BASE_URL); every fallback now explicitly labeled.
- pi/generate-reading.js — response now includes provider + iGenerated; 500 errors sanitized (no internal detail leak).
- .env.example — reading-provider block rewritten (GROQ_API_KEY / GROQ_MODEL / GROQ_BASE_URL; GEMINI_API_KEY removed).
- scripts/verifyAiProviderPath.js — new verification suite (13 checks) against a local mock Groq server; no live quota spent.

Key decisions made:
- Template fallbacks are explicitly labeled: { provider: 'template', aiGenerated: false, reason: 'missing_api_key' | 'pipeline_not_ready' | 'provider_error' }. A paying customer can never receive an unlabeled template reading presented as AI output.
- Successful AI output returns { provider: 'groq', aiGenerated, model, fallbackSections, reason }; iGenerated is true only when genuine Groq output (writer or rewriter) is in the final reading.
- Groq config is read at call time via getProviderConfig() (GROQ_MODEL default llama-3.3-70b-versatile, GROQ_BASE_URL default https://api.groq.com/openai/v1).
- scripts/verifyAiProviderPath.js verifies provider selection, model, assembled prompt content, controlled failure modes, client-side secret hygiene, and re-runs the 4 existing regression suites.

Tests (all passing):
- scripts/verifyAiProviderPath.js (13 checks) — uses a local mock OpenAI-compatible Groq server; no live API key/quota needed.

---

### Phase 2 (Real Image Validation) — 2026-08-12
Files created/modified:
- `js/palmValidator.js` — **NEW** — client-side palm image validation using MediaPipe Hands loaded from jsdelivr CDN (free). Lazy-loads the library and model only when the user first selects a photo. No npm dependency added.
- `js/teaser.js` — `onPhotoChange` now calls `PalmValidator.validateImage(file)` before hashing. The image is only hashed after successful CV validation. Added file-size pre-check (10 MB).
- `css/style.css` — Added ellipsis animation on the "Checking image…" loading state.
- `index.html` — Added `<script src="js/palmValidator.js">` (loaded before `js/teaser.js`). Updated photo hint and default status text to mention validation.
- `scripts/verifyPalmValidation.js` — **NEW** — 17 focused checks for the validation layer.

Key decisions made:
- Chose `@mediapipe/hands` (not `@mediapipe/tasks-vision`) because it supports script-tag injection and the `locateFile` callback pattern that works cleanly with vanilla JS static files — no ES modules or npm bundling needed.
- The MediaPipe model (~10 MB) is lazy-loaded on first photo selection; subsequent validations reuse the cached instance. During first load the UI shows "Checking image…" with an ellipsis animation.
- Validation pipeline: MIME type → file size ≤ 10 MB → image load → dimensions ≥ 200 px → MediaPipe hand detection → exactly 1 hand detected → detection confidence ≥ 0.5 → fingers extended (open palm, not a fist). If any check fails, the image is NOT hashed and a specific user-facing error is shown.
- The `updateUnlockState` guard was extended to not overwrite an existing `error` state on the photo-status element (prevents the generic "A hand photo is required" from clobbering a specific validation error like "No hand detected").
- No palm-line/mount/line analysis is performed — Phase 2 is validation only. The reading system still receives only `photoHash` (SHA-256) and `photoHashPresent: true`. There is no "palmEvidence" data flow from CV to the AI provider.
- Payment code (`js/checkout.js`, `api/create-payment.js`, `api/verify-razorpay.js`) is completely untouched — the backend still requires a valid 64-char hex photoHash, which now only gets set after successful validation.

Env vars now required: unchanged (no new env vars).

Validation states surfaced to the user:
- "Checking image…" (loading)
- "No hand detected. Please upload a clear photo of your palm."
- "Multiple hands detected. Please upload one palm only."
- "Image is too small or blurry. Please upload a clearer photo of your palm."
- "Please show your open palm. Keep your fingers spread for a clear photo."
- "Image is too large. Please choose a file under 10 MB."
- "Palm image validated — hashed on your device, never uploaded." (success)

Tests (all passing):
- scripts/verifyPalmValidation.js (17 checks)
- scripts/verifyAiProviderPath.js (13 checks) — all regression suites still pass
- scripts/verifyUpiPaymentFlow.js (21 checks) — payment flow untouched
- scripts/verifyRazorpaySecurity.js (32 checks) — security untouched
- scripts/verifyProductionChecks.js (26 checks)
- scripts/verifyCustomerJourney.js (11 checks)

Deviations from spec, if any:
- None.

What's next: Phase 3 — Full palm line analysis (optional, future). The validation layer in Phase 2 only confirms a hand is present; extracting actual palm-line/mount observations would require a separate model or more detailed landmark analysis. Until then, the AI reading system receives only `photoHashPresent: true` and must not claim specific palm observations.

To resume in a different tool: "Read PROJECT_SPEC.md and PROGRESS.md, then continue Phase 3."