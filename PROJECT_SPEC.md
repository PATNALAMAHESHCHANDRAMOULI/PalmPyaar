# PalmPyaar — Master Build Spec & Prompt

**How to use this file:** Paste this entire document as your first message in Cursor, Antigravity, or Cline. Its first instruction tells the agent to save itself into your repo — that's what makes it survive a tool switch. From then on, start every new session (in any tool) with just this line:

> Read PROJECT_SPEC.md and PROGRESS.md fully before writing any code. Continue exactly from where PROGRESS.md left off. Do not restart or re-architect what's already built.

---

## 0. First actions (do this before anything else)

1. Save this entire document as `PROJECT_SPEC.md` in the project root.
2. Create an empty `PROGRESS.md` with just a title line.
3. Before starting Phase 2 or Phase 3 in Section 8, make sure the human has completed the account setup in Section 7 — the agent cannot create Instamojo or Google accounts on their behalf.
4. Work through Section 8 in order, one phase at a time. **Stop after each phase** and output the summary in the exact format in Section 11 — both in chat and appended to `PROGRESS.md`. Do not start the next phase until told to continue.
5. Don't re-decide architecture, colors, copy tone, or file structure mid-build — they're fixed below. If something genuinely isn't specified, make the smallest reasonable choice, log it as a "decision made" in the phase summary, and keep moving. Don't stop to ask unless it would block a later phase.

---

## 1. Costs — what you'll actually pay

**Domain:** ~₹700–1,200/year for a .com or .in. This is the one certain, upfront cost. Everything else below is free or comes out of revenue rather than your pocket — with two honest caveats worth knowing now rather than discovering later.

**Instamojo:** free to sign up, no monthly or setup fee. They deduct a transaction fee automatically from each payment before it reaches your bank — for digital goods, 5% + ₹3, plus 18% GST on that fee. A ₹49 sale nets roughly ₹41–42. This is never a bill you pay out of pocket; it's taken from money you've already received.

**Vercel hosting:** the free "Hobby" plan technically covers this whole build. Caveat: Vercel's terms restrict Hobby to personal, non-commercial use, and a site that charges money is technically commercial under their definition. Enforcement has reportedly been inconsistent for small solo projects, and plenty of tiny revenue sites run on it anyway — but strictly by the rules, there's a $20/month Pro plan that applies once you're monetizing, or automatically once you outgrow Hobby's usage caps (100GB bandwidth/month, roughly 1M function calls — high for launch-scale traffic). Realistic read: start on Hobby, but budget mentally for a possible $20/month later rather than assuming $0 forever.

**LLM (optional, if you use one):** Google's Gemini API has a genuine no-credit-card free tier — see Section 7b. "Free" here means rate-limited and changeable by Google at any time, not a contractual guarantee. The build is designed so the site works perfectly at $0 LLM spend regardless — it falls back to the template engine automatically.

**Bottom line:** your one guaranteed cost is the domain. Nothing else requires spending money upfront at launch scale — but "Vercel commercial-use terms" and "free API tiers aren't forever" are the two asterisks worth remembering, not promises that nothing will ever cost anything.

---

## 2. Product summary

PalmPyaar is a no-signup, static entertainment website. Users enter DOB, birthplace, name, pick a reading style (Western / Vedic / Hellenic), optionally add a photo. A free one-line teaser is shown immediately.₹49 payment unlocks the complete personalized reading, relationship notes, and all supported traditions in a single purchase. PalmPyaar currently offers one simple pricing plan. Framed explicitly as entertainment throughout — never as factual prediction.

---

## 3. Tech stack — fixed, do not add frameworks

- **Frontend:** plain HTML/CSS/vanilla JS. No React/Next/Vue — unneeded for this scope and costs credits to scaffold and maintain.
- **Backend:** Vercel Serverless Functions only, in `/api`, Node.js.
- **No database.** All state travels in a signed URL token (Phase 3).
- **Hosting:** Vercel, deployed from a GitHub repo (connect once in Vercel dashboard, auto-deploys on push). No custom domain yet — ship on the free `*.vercel.app` URL; a domain can be attached later with zero code changes. See Section 1 for the Hobby-plan commercial-use caveat.
- **Payment:** Instamojo Payment Requests API. See Section 7a for account setup.
- **Reading generation:** template-based by default; optional free LLM path via Google Gemini's free tier (Section 7b) behind an `AI_READING` flag, with automatic fallback to templates on any error or quota limit — the user should never see a raw API failure.

---

## 4. File structure — create exactly this

```
/
├── index.html
├── result.html
├── refund-policy.html
├── privacy.html
├── /css/style.css
├── /js/teaser.js        (client-side: DOB→sign, free one-liner, photo→hash)
├── /js/checkout.js       (client-side: collects inputs, calls /api/create-payment)
├── /js/reveal.js         (client-side: calls /api/generate-reading with the token)
├── /api/create-payment.js
├── /api/verify-payment.js
├── /api/generate-reading.js
├── /content/templates.js (template fragment library / LLM prompt text)
├── PROJECT_SPEC.md
├── PROGRESS.md
├── .env.example
└── .gitignore
```

---

## 5. Design system — fixed tokens, do not invent alternatives

**Direction:** confident and dark for the mystical/reveal moments (palm + zodiac), switching to a clean warm-light panel specifically during checkout, where clarity matters more than mood. Avoid the generic purple-gradient-with-stars look common to this niche — it reads as low-trust.

**Color tokens:**
- `--night` `#14111F` — primary background (deep indigo-black)
- `--gold` `#E8A33D` — primary accent: CTAs, "unlock" button, Pro-tier markers
- `--rose` `#B5555C` — secondary accent: palm-line graphic strokes, non-CTA highlights
- `--ivory` `#F7ECE4` — checkout/trust panel background only (not the global background)
- `--text-on-dark` `#EFEAE2` — body text on `--night`
- `--text-on-light` `#14111F` — body text on `--ivory`
- `--verified` `#4E9F73` — payment-confirmed checkmark only

**Typography:**
- Display face (headlines): **Fraunces** — warm, editorial, some personality. Used with restraint.
- Body face: **Manrope** — clean, mobile-legible, loads fast.
- Fallback stack for user-entered names (must render Indian-script input correctly): `'Manrope', 'Noto Sans', system-ui, sans-serif`.
- Only these two font families. No third decorative face.

**Signature element:** one continuous SVG line that begins tracing a palm's heart-line/head-line curve and resolves into a constellation (straight segments connecting star points) — literally fusing "palm" and "zodiac" into a single mark. Draws itself once on page load; respect `prefers-reduced-motion` (show static, no animation). This is the one bold visual moment on the page — everything else stays quiet.

**Layout concept (hero):**
```
┌─────────────────────────────┐
│   [signature line-drawing]   │
│      PalmPyaar               │
│   one-line entertainment      │
│   disclaimer, visible here    │
│                               │
│   [ name / DOB / birthplace ] │
│   [ tradition: W / V / H ]    │
│   [ optional photo upload ]   │
│   → your free line appears    │
│   [ Unlock full reading ₹49 ] │
└─────────────────────────────┘
```
Checkout switches the panel background to `--ivory`; price, what's included, and the refund-policy link are all stated in the same view — nothing about the transaction is hidden a click away.

**"How it works" section:** numbered 01/02/03 is appropriate here — it's a real sequence (enter details → see free line → unlock full reading), not decoration.

**Performance:** two font families max, no animation libraries, no build step for CSS. Many users will be on constrained mobile data — keep the initial page weight small.

---

## 6. Copy rules — apply to every template fragment and any LLM prompt

- Frame everything as entertainment: "a personalized reading, for fun" — never "prediction" used as a claim of fact.
- Hedge language always: "this suggests," "may indicate," "tends to." Never "you will," never absolute claims about marriage, health, money, or death.
- Photo: never claim to "read" or "analyze" palm lines. Say "personalized using your photo." The photo is hashed client-side and never uploaded — the copy should say so, because it's true and it's a trust signal.
- The entertainment disclaimer and a refund-policy link must be visible on the page before payment — not buried in a ToS link.
- If using the Gemini path (Section 7b), these rules go into the prompt sent to the model on every single call — never rely on the model's default tone.

---

## 7. Account setup — do this before Phase 2 (7a) and before Phase 3 if using AI readings (7b)

### 7a. Instamojo — payment account + API keys

1. Go to instamojo.com and sign up with your email/phone — individual account, no company or GST needed.
2. Verify your email and phone number.
3. Complete KYC: PAN card, a bank account for payouts (a cancelled cheque or bank statement may be requested), and basic personal details. This is the individual-PAN path — no business registration required.
3a. **Business Details form:** category "Services – Others" → subcategory **Astrology** is the correct, already-supported fit (Instamojo explicitly onboards this category). For "Do you have a website?" — answer honestly based on current status; "No" is normal at this stage, or give your `*.vercel.app` URL if Phase 1 is already deployed (this field is typically editable later once you have a real domain). For "Describe your Product or Service in detail," use: *"PalmPyaar is a digital entertainment website. Users enter their date of birth, birthplace, and optionally a photo, and instantly receive a personalized zodiac/palm-style reading and light relationship notes, generated and delivered entirely online. Content is presented for fun and entertainment, not as professional advice or guaranteed prediction. No physical goods, no live consultations or calls — a short free preview is shown, and a one-time ₹49 payment unlocks the full reading immediately on the same page."*
4. KYC review can take a day or two. While waiting, build against a **sandbox account**: sign up separately at test.instamojo.com (no documents needed) and grab test credentials instantly at test.instamojo.com/developers/. Get the whole payment flow working against this first.
5. Once approved, log in at instamojo.com and go to **Developers** (also labeled "API & Plugins" or "Integrations" in some account views). You'll see your live **API Key**, **Auth Token**, and a **Private Salt**. These are confidential — never put them in code or commit them to GitHub.
6. Add them to your Vercel project under **Settings → Environment Variables** as `INSTAMOJO_API_KEY` and `INSTAMOJO_AUTH_TOKEN` (names must match Section 9). Set these in the Vercel dashboard, never in a file.
7. When you go live, point your serverless functions at the production base URL instead of `test.instamojo.com`, and swap the test keys for the live ones.

### 7b. Google Gemini — free LLM for nicer-sounding readings

Genuinely free, no credit card — this is why it's the default for `AI_READING=true`. Two honest caveats: (1) the free tier is rate-limited — a handful of requests per minute, up to roughly 1,000/day on the cheapest model, and Google can change these limits without notice; (2) content sent on the free tier may be used by Google to improve their models, so don't send anything you wouldn't want seen there. Neither breaks the site: if a call fails or the quota's used up, `generate-reading.js` catches it and silently falls back to `templates.js` — the user never sees an error.

1. Go to Google AI Studio (aistudio.google.com), sign in with any Google account.
2. Click **Get API Key → Create API key**. No billing setup needed for the free tier.
3. Copy the key. Add it to Vercel under **Settings → Environment Variables** as `GEMINI_API_KEY`.
4. In `generate-reading.js`, when `AI_READING=true`, call Gemini's REST endpoint directly with `fetch` — no SDK needed, one less dependency:
   `POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=` + `GEMINI_API_KEY`
   Use the `flash-lite` model specifically — it currently carries the highest free daily request allowance in Google's lineup, which matters most if the site actually gets traffic.
5. Wrap the call in try/catch. On any error or non-200 response, fall back to `templates.js` immediately.
6. Every call must include the Section 6 copy rules as an instruction to the model — hedged language, entertainment framing, no absolute claims. Don't trust the model's default tone to comply on its own.

---

## 8. Functional phases

### Phase 1 — Static shell + free teaser (no payment)
- `index.html` form: name, DOB, birthplace, tradition select, optional photo upload.
- `teaser.js`: DOB → zodiac sign (real calendar logic, not random). Photo → SHA-256 hash via the browser's Web Crypto API — **never upload the raw image, anywhere, ever.**
- Combine sign + hash into a seed, show one free teaser line from a small public template set in `templates.js`.
- "Unlock full reading — ₹49" button, wired to Phase 2 later (stub link for now).
- Mobile-first. Test the layout at 375px width minimum before calling this phase done.
- **Stop. Output the Section 11 summary.**

### Phase 2 — Payment integration
- Confirm Section 7a is complete (real or sandbox Instamojo credentials exist) before starting.
- `/api/create-payment.js`: accepts `{name, dob, birthplace, tradition, photoHash}`, calls the Instamojo Payment Requests API, returns the Instamojo-hosted checkout URL. Pass those fields through Instamojo's `redirect_url` param so they come back on return; Instamojo also collects the buyer's email/phone at checkout — no separate form needed for that.
- `/api/verify-payment.js`: on return from Instamojo, calls Instamojo's Payment Detail API **server-side** with the private API key to confirm `status === "Credit"`. Never trust the redirect's query params alone — they can be typed into a browser by hand.
- On confirmed payment: compute `token = HMAC-SHA256(name+dob+birthplace+tradition+photoHash+tier+orderId, TOKEN_SECRET)`.
- Redirect to `/result.html?name=...&dob=...&...&token=...`.
- **Stop. Output the Section 11 summary.**

### Phase 3 — Gated full reading (this is the actual paywall — get it right)
- Confirm Section 7b is complete if `AI_READING=true`; otherwise this phase runs on templates only.
- `result.html` loads; `reveal.js` sends all URL params to `/api/generate-reading.js`.
- `generate-reading.js` **recomputes the HMAC over the received params and compares to the token.** Reject on mismatch. This — not hidden CSS, not client-side logic — is what makes the paywall real.
- If valid: return the full reading — from `templates.js`, or a Gemini call per Section 7b if `AI_READING=true`, with automatic fallback to `templates.js` on any error or quota limit. Sectioned — love/relationship notes, and for Pro tier: all three traditions' one-line verdicts plus a 12-month outlook.
- Render in the dark theme from Section 5.
- Add a "save this link — it's your permanent access" notice and a WhatsApp share button (`wa.me/?text=<link>`), which also solves couples-bundle sharing across two phones.
- **Stop. Output the Section 11 summary.**

### Phase 4 — Trust & compliance pages
- `refund-policy.html`: plain language, consistent with Section 6.
- `privacy.html`: states what's collected (name, DOB, birthplace, a photo *hash* — never the image itself), a consent line, an explicit "we don't store this anywhere, there's no database" statement (true — say it), and a contact channel.
- Visible WhatsApp or email contact link in the footer of every page.
- Entertainment disclaimer visible above the fold on `index.html`, not just in the footer.
- **Stop. Output the Section 11 summary.**

### Phase 5 — Deploy
- Confirm zero-config deploy works on the default `*.vercel.app` URL.
- List required env vars in `PROGRESS.md` with instructions to set them in the Vercel dashboard (never commit real values — `.env.example` holds names only).
- Note explicitly: custom domain can be attached later with no code changes.
- **Stop. Output the Section 11 summary.**

---

## 9. Environment variables (names only — real values go in the Vercel dashboard, never in code or git)

```
INSTAMOJO_API_KEY
INSTAMOJO_AUTH_TOKEN
TOKEN_SECRET
GEMINI_API_KEY     
```

---

## 10. Credit-saving rules for the agent

- Don't run the dev server or a build after every single file edit — batch a phase's files, test once at the end of the phase.
- No testing frameworks, linters, or CI setup for this MVP scope.
- No external "best practice" research — this spec is the source of truth.
- Don't refactor a previous phase's working code unless a later phase explicitly requires it.
- If genuinely blocked, make the smallest reasonable call, log it, keep moving — don't pause to ask unless it would break a later phase.

---

## 11. Required summary format — output in chat AND append to PROGRESS.md after every phase

```
### Phase [N] — [name] — [date]
Files created/modified: (exact paths)
Key decisions made: (anything not explicitly specified in this doc that had to be chosen)
Env vars now required: (names only)
Deviations from spec, if any:
What's next: (next phase number + first task)
To resume in a different tool: "Read PROJECT_SPEC.md and PROGRESS.md, then continue Phase [N+1]."
```
