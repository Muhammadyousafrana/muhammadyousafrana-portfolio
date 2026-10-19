# Set Up Your AI Portfolio

**You are an AI coding agent (Claude Code or OpenAI Codex) helping the repository owner turn this
template into their own personalized, deployed portfolio.** Read this guide top to bottom and run
the user-facing conversation described at each stage. The person you are talking to is "the user"
below.

This template is an AI-powered personal portfolio: a single-page site with an AI "recruiter chat"
that answers questions about the user's experience, plus a JD (job description) fit-check, deployed
on Cloudflare Workers. Your job is to interview the user, ingest their resume, write the content,
validate it, preview it, and deploy it, over a few collaborative rounds.

## How to use this guide (portability)

- This flow uses only **shell commands and file edits**, so it runs identically under Claude Code
  or OpenAI Codex. Do not rely on any tool-specific feature.
- Use **Bun** for everything: `bun install`, `bun run <script>`, `bunx <cli>`. Do not use
  `npm`/`npx`.
- Stages marked **USER ACTION** are hard gates: stop and ask the user to do that step themselves
  (browser sign-in, dashboard clicks, token creation, entering secrets). Do not try to automate
  them.
- **Secret policy:** you never ask the user to paste a secret value into the chat, and you never
  write a secret value into a file or into `wrangler.jsonc`. The user puts local secrets into the
  gitignored `.dev.vars` themselves, and sets production secrets with `bunx wrangler secret put ...`
  themselves. You only tell them which secret to set.
- Bun is required. Do not assume or invent a minimum version; if `bun` is missing, ask the user to
  install it.

---

## Stage 1 - Orient

Tell the user, briefly, what you are about to do together:

> This is an AI-powered portfolio template. It renders a single-page site with an AI assistant that
> answers recruiter questions about your experience and a job-description fit-check, all deployed on
> Cloudflare Workers. I'll interview you, turn your resume into the site's content, validate it,
> show you a local preview to refine, and then walk you through deploying it. We'll do this over a
> few rounds and you can course-correct at any point.

Then move to the interview.

---

## Stage 2 - Interview

Collect the core identity and copy. Ask in plain language; you do not need every answer at once, but
confirm each before writing. Collect:

- **Full name** (e.g. "Jordan Ellis")
- **Short / first name** used casually in UI copy (e.g. "Jordan"). Ask explicitly rather than
  parsing the full name, so preferred and compound names stay correct.
- **Assistant name** for the AI proxy. Default to `Robo-<first>` (e.g. `Robo-Jordan`); let them
  override.
- **Headline / title** (e.g. "Full-Stack Software Engineer")
- **Header label**, a short badge shown in the site header (e.g. "Full-Stack Portfolio")
- **Target roles** they are pursuing (a short list). Ask this deliberately: it tunes both the chat
  and the fit-check.
- **Location** (e.g. "Austin, TX")
- **Email** and **LinkedIn** path (e.g. `linkedin.com/in/jordanellis`)
- **SEO title** and **SEO description** for search and social cards

You will **draft** the remaining homepage copy (hero headline, CTA text, "open to" label, role
focus) and the chat **starter prompts** in Stage 4 from the confirmed resume facts, and refine them
in the Stage 6 preview. For the SEO social fields (`ogTitle`, `ogDescription`, `themeColor`), propose
sensible defaults (e.g. `ogTitle` = "`<name>` | `<title>`", `themeColor` = `#0f172a`) and confirm.

---

## Stage 3 - Ingest the resume

Ask the user to provide their resume in whichever form is easiest:

- a **PDF path inside the repo** (e.g. `./my-resume.pdf`),
- a **Markdown or plain-text paste**, or
- a **link**.

Then parse it into structured facts. The resume used for ingestion and the optional PDF published
on the site are separate concerns: Markdown supplies facts but is not compiled into a new PDF. If
the user wants a downloadable resume, publish their original PDF in Stage 4 after getting consent.

**Fallbacks (portability):**

- If you cannot read a PDF directly, try a local extractor such as `pdftotext`. If none is
  available or the extracted layout is unusable, do not install a PDF/LaTeX toolchain or recreate
  the resume. Ask the user to convert it with [LiteDoc](https://litedoc.xyz/), a browser-based PDF to
  Markdown tool ([source](https://github.com/0xovo/LiteDoc)), then copy and paste the generated
  Markdown back into the chat. LiteDoc describes its processing as local to the browser; the user
  should still review the Markdown for missing, reordered, or OCR-corrupted text before sending it.
- If a link is private, blocked, or not directly downloadable, ask for a local file or a paste
  instead.

### GUARD 1 - Never invent facts; confirm before writing

This is the most important rule in the whole flow.

1. Extract structured facts: experience (employer, role, dates, bullets), projects, skills,
   education, plus any leadership / certifications / awards the resume actually states.
2. Show the user a **normalized summary** of what you extracted, grouped by section, including dates
   and any metrics.
3. Separately list the **uncertainties**: anything ambiguous, undated, or that you had to guess.
4. Get **explicit confirmation** before writing anything.

Never invent or silently infer metrics, dates, employers, titles, or skills. If the resume does not
state something, leave it out or ask. Confirmation must cover not just the raw resume facts but also
everything you will derive from them:

- the homepage **proof points** and headline copy,
- the professional **summary** paragraph,
- the **SEO** strings,
- the **skills** you list.

**Absence from a resume is not evidence of a gap.** Do not populate `skills.gaps` from what you
_didn't_ see. Leave it empty unless the user names a genuine growth area themselves.

---

## Stage 4 - Write the content

The site's content lives in exactly two files, which are the single source of truth:

- `content/portfolio.yaml` - structured facts
- `content/prose/summary.md` - the long-form professional summary (one plain paragraph)

Running `bun run content:build` validates the YAML with Zod and regenerates the committed
`shared/content.generated.ts`, which the app, worker, and tests all read (via
`shared/resume-canonical.ts`). You edit the two source files; you never hand-edit
`content.generated.ts`.

> **Only `content/prose/summary.md` is consumed**, and it renders as **plain text** on the homepage.
> Write a normal paragraph. Markdown syntax (bold, lists, headings) would show up literally, so do
> not use it there.

### Content schema (`content/portfolio.yaml`)

**Required, must be non-empty:**

| Key                                                                                                                  | Notes                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `name`, `title`, `assistantName`, `shortName`, `headerLabel`                                                         | Identity strings.                                                                                     |
| `contact.email`, `contact.location`, `contact.linkedinPath`                                                          | `linkedinPath` may omit the scheme; it is normalized to a full URL.                                   |
| `seo.title`, `seo.description`, `seo.ogTitle`, `seo.ogDescription`, `seo.themeColor`                                 | Injected into `index.html` at build time.                                                             |
| `targetRoles`                                                                                                        | List, at least one entry.                                                                             |
| `starterPrompts`                                                                                                     | List, at least one entry. Suggested questions in the empty chat panel.                                |
| `homepage.openToLabel`, `homepage.roleFocus`, `homepage.heroHeadline`, `homepage.ctaHeadline`, `homepage.ctaSubtext` | Homepage copy.                                                                                        |
| `education`                                                                                                          | **A list**, at least one entry. Each entry needs `school` + `degree`. Multiple degrees are supported. |
| `skills`                                                                                                             | The `skills` object is required, but its three arrays default to empty.                               |

**Optional (omit the key, or leave the array empty). Items inside these arrays are still strict:**
each item must have all of its required fields. `resumePdfPath` is a scalar, so **omit it entirely**
(do not set it to an empty string).

| Key                                                 | Behavior when omitted / empty                                                                                  |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `resumePdfPath`                                     | Omit to hide the header "Resume PDF" button. See the PDF note below.                                           |
| `homepage.proofPoints`                              | A list of "at a glance" cards. Each needs `sourceId` + `title` + `detail`; use a distinct `sourceId` per card. |
| `experience`                                        | A list. Each item needs `id`, `company`, `role`, `period`, `description`, and ≥1 `bullets`.                    |
| `projects`                                          | A list. Each item needs `id`, `name`, `period`, `description`, and ≥1 `bullets`.                               |
| `education[].coursework`                            | Per-education list of course names.                                                                            |
| `leadership`                                        | Each item needs `organization`, `role`, `period`; `highlights` optional.                                       |
| `certifications`                                    | Each item needs `name`, `issuer`, `period`; `highlights` optional.                                             |
| `awards`                                            | Each item needs `name`, `period`, `detail`.                                                                    |
| `skills.strong` / `skills.moderate` / `skills.gaps` | Each defaults to empty.                                                                                        |

**Two rules the validator enforces that are easy to miss:**

1. Every `id` across `experience` and `projects` must be **globally unique**.
2. Each `homepage.proofPoints[].sourceId` must reference a **real** `experience` or `project` `id`.
   (This is checked at build time and at compile time.)

**Also required outside the YAML:** `content/prose/summary.md` must be non-empty, and the favicon
`public/icon.svg` must exist (it ships with the template; do not delete it).

**Bring-your-own resume PDF (`resumePdfPath`):** the site serves an existing PDF; it does not compile
one from Markdown. If the user wants the header's "Resume PDF" button, confirm that the exact PDF is
safe to publish, copy it into `public/` with a stable web-safe name (for example,
`public/jordan_ellis_resume.pdf`), and set `resumePdfPath` to the root-relative path **without** the
`public/` prefix (`/jordan_ellis_resume.pdf`). The value must be canonical (no `/public/...`, no
`..`). If the user supplied only Markdown or does not want the original PDF publicly downloadable,
omit `resumePdfPath`; do not generate a replacement PDF.

**Display limits to be aware of:** the homepage does not show every entry. It surfaces only the
**first** education's degree (in the stat box), the first **two** leadership entries, the first
**one** certification, and the first **one** award. Extra entries validate fine but are not all shown.
Put the strongest items first.

### GUARD 2 - Sparse and diverse resumes

Not every user has certifications, awards, leadership, or skill gaps, and that is fine. **Leave
optional sections empty rather than padding them with invented content.**

Be honest about how sparse resumes render so the user knows what to expect:

- **Empty optional sections hide cleanly.** Each optional section and subsection hides when its data
  is empty rather than showing an empty card: the Leadership / Certification / Award cards hide
  individually (and the whole "Leadership And Credentials" section disappears if all three are empty),
  the Skills cards (Core Strengths, Applied / Developing, Growth Areas) hide the same way,
  the Professional Experience and Key Projects blocks each hide when empty, the "At a glance" aside
  hides when there are no proof points, and the header nav link for any hidden section hides too. So
  leaving an optional section empty produces a clean page, not an empty heading, and you never need to
  pad a section with invented content.
- **`education` requires at least one entry.** Ask whether the user has any real education, bootcamp,
  apprenticeship, or training to list. If they genuinely have none, do not coerce or invent an entry;
  tell them the current schema requires at least one education entry, so representing "no education"
  cleanly would need a small code change.

Once the two files are written and confirmed, move on to validation.

---

## Stage 5 - Validate

Run the checks and loop until green. If Bun packages are not installed yet:

```bash
bun install
```

Then:

```bash
bun run content:build   # validate content/portfolio.yaml and regenerate content.generated.ts
bun run check           # content drift + prettier + eslint + typecheck + knip
bun run test            # runs content:build first, then the test suite
bun run build           # production build sanity
```

- Zod validation errors from `content:build` name the problem (missing key, empty list, bad
  `sourceId`, duplicate `id`). Fix the YAML and rerun.
- If `bun run check` fails on formatting, run `bun run format` to auto-fix, then re-run `check`.
- `content:check` (the first step of `bun run check`) fails if `shared/content.generated.ts` is stale.
  Rerun `bun run content:build`. The generated file **is committed** but must **never be hand-edited**;
  keep it tracked and include it whenever you commit your content changes.

> The whole test suite reads identity, contact, and education dynamically from your content, so
> personalizing `content/portfolio.yaml` does not require touching any test. If `bun run test` fails
> after you edit content, investigate the actual failure rather than hunting for a hardcoded sample
> value to update.

---

## Stage 6 - Preview and iterate

Start the local dev server (`bun run dev`) either in the background yourself or by asking the user to
run it. **USER ACTION:** ask the user to open `http://localhost:3000` in their browser to review.

Then iterate with them over a few rounds on the **content and copy**:

- Does the hero headline, "open to" label, and role focus read well?
- Are the "at a glance" proof points the strongest evidence?
- Are the chat **starter prompts** the questions a recruiter would actually ask?
- Do the SEO title/description look right in the browser tab?

> **Testing AI locally:** `.dev.vars.example` selects `google-ai-studio`, which calls Gemini directly
> and does not require a Cloudflare AI Gateway. Create a Google AI Studio API key and put it in the
> gitignored `.dev.vars` as `GOOGLE_GENERATIVE_AI_API_KEY`; also replace the
> `SECURITY_HMAC_SECRET` placeholder. Review Google's free-tier data-use terms before sending
> recruiter or personal data. Gateway-backed providers still require `CF_AI_BASE_URL`.

Refine `content/portfolio.yaml` and `content/prose/summary.md`, rerun `bun run content:build`, and
let the browser hot-reload. Repeat until the user is happy.

---

## Stage 7 - Deploy to Cloudflare

This template deploys as a single Cloudflare Worker, published by default to
`https://<name>.<subdomain>.workers.dev`. A custom domain is optional and comes later.

`DEPLOYMENT.md` is the canonical, detailed Cloudflare procedure (env table, secret reference,
troubleshooting). Your job here is to enforce the ordered gates below and hand the user off to
`DEPLOYMENT.md` for the fine detail. Do not duplicate the full env table into the chat.

### GUARD 3 - Fresh-account deploy, in order

Walk the user through these steps in order. The **USER ACTION** steps are theirs to perform.

1. **Choose the final Worker `name`.** It becomes the site URL
   (`https://<name>.<subdomain>.workers.dev`). It is a DNS label: lowercase letters, digits, and
   hyphens, at most 63 characters, and it cannot start or end with a hyphen. Set it in
   `wrangler.jsonc` (`"name"`). Pick it before setting any secrets.
2. **USER ACTION - create / verify a Cloudflare account** and confirm the account has a `workers.dev`
   subdomain enabled (the dashboard prompts for one on first Workers use).
3. **Choose an AI provider.** For `google-ai-studio`, set `AI_PROVIDER` to that value in
   `wrangler.jsonc` and use a Google API key; no AI Gateway is needed. For the default `workers-ai`
   or optional `google-gateway`, create a Cloudflare AI Gateway and note its **account id** and
   **gateway slug**. `google-gateway` also needs an Authenticated Gateway token and Google AI Studio
   provider key stored in the Gateway. See [`DEPLOYMENT.md`](DEPLOYMENT.md#ai-gateway-setup).
4. **Gateway providers only:** replace the `CF_AI_BASE_URL` sentinel in `wrangler.jsonc` with the
   account id and gateway slug from step 3. Keep `/compat`; direct `google-ai-studio` does not use it.
5. **USER ACTION - authenticate Wrangler:** `bunx wrangler login` (or export `CLOUDFLARE_API_TOKEN`
   for CI).
6. **First publish:** `bun run deploy:init`. This validates config, builds, publishes the Worker
   (creating it), and prints the secret instructions. Note: `deploy:init` publishes **before** secrets
   exist, so the AI chat and fit-check are non-functional until the next steps (the static page still
   renders). It is a one-time bootstrap, not your normal loop.
7. **USER ACTION - set the required secret** (the user enters values at the Wrangler prompt; you
   never see them):

   ```bash
   bunx wrangler secret put SECURITY_HMAC_SECRET # a long random string
   ```

   For `AI_PROVIDER=google-gateway`, also set `CF_AI_GATEWAY_TOKEN`. For
   `AI_PROVIDER=google-ai-studio`, set `GOOGLE_GENERATIVE_AI_API_KEY` instead.

8. **USER ACTION - set optional secrets** only if the user wants those features:
   - **SMS contact handoff (Twilio):** `CONTACT_SMS_TO_NUMBER` (the owner's destination number, E.164),
     `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`. If these are not all set, the
     contact flow safely runs in simulation mode.
   - **Turnstile bot protection:** production requires it by default. Create the widget and provide
     its production site key at build time; after the first Worker deploy, set its secret key before
     exposing AI traffic. Keep the local `.dev.vars` override disabled for local development only.
9. **USER ACTION - verify the required secrets exist.** Under `bunx wrangler login`,
   `predeploy:validate` cannot inspect remote secrets, so confirm by hand before deploying:

   ```bash
   bunx wrangler secret list   # expect SECURITY_HMAC_SECRET and the selected provider key
   ```

10. **Normal deploy:** run it in the same terminal so the env var is in scope (agent shell calls do
    not reliably share state, so pass `SMOKE_BASE_URL` inline). If the user set an `AI_HEALTH_TOKEN`
    secret, prefix the matching `AI_HEALTH_TOKEN=...` too so the smoke probe can authenticate.

    ```bash
    SMOKE_BASE_URL=https://<name>.<subdomain>.workers.dev bun run deploy
    ```

    This revalidates (now that secrets exist), builds, deploys with `--strict`, and runs the
    post-deploy AI health smoke check. Use `bun run deploy:dry-run` anytime to validate + build
    without publishing. From here on, `bun run deploy` is the loop, not `deploy:init`.

    > **Recovery note:** `deploy:init` is fresh-Worker-only. If validation later reports an existing
    > Worker with missing secrets, have the user set the secrets, then use normal `bun run deploy`.

11. **Verify production bot protection:** confirm `REQUIRE_TURNSTILE: "true"`, the production
    `TURNSTILE_SECRET_KEY`, and the matching real (non-test) `VITE_TURNSTILE_SITE_KEY` are set before
    enabling public AI use. See `DEPLOYMENT.md`.
12. **Optional - custom domain:** with the zone already on the user's Cloudflare account, add a
    `routes` block with `custom_domain: true` to `wrangler.jsonc` and redeploy; Cloudflare provisions
    the DNS record and TLS certificate. See the custom-domain section of `DEPLOYMENT.md`.

That is the whole flow: personalize, validate, preview, deploy. Keep the collaboration tight and let
the user confirm at each gate.
