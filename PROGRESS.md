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

To resume in a different tool: "Read PROJECT_SPEC.md and PROGRESS.md, then continue Phase 4."





