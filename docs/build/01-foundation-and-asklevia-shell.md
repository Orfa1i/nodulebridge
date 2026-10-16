# Phase 1 — Foundation and the Asklevia app shell

**Time budget:** 3 hours · **Needs:** `00-master-brief.md` read · **Produces:** a running web app and API with the Asklevia look, empty screens and the safety banner.

## Goal

Two processes start with one command, the web app shows the Asklevia App bar, the persistent safety banner and the four empty screens, and every style comes from Asklevia tokens.

## Steps

1. **Scaffold the repo** with the layout in master brief section 3. Add a root `README.md` (one paragraph + how to run), `.gitignore` (ignore `/data/**` except `*.json` under `/data/cases/*/`), `.env.example` from section 8, and a root `Makefile` or `package.json` scripts: `dev` (web + api together), `test`, `lint`.
2. **Copy the kit.** Copy `docs/build/asklevia-kit/` to `/asklevia/`. In `/web`, copy `tokens.css`, `bundle.css`, `nodulebridge-extensions.css` into `web/src/styles/` and `fonts/` into `web/public/fonts/`. Fix the `@font-face` URLs in `tokens.css` to `/fonts/...`. Import the three CSS files in the root layout in this order: tokens, bundle, extensions. Copy `logos/` to `web/public/brand/` and set `favicon.svg` as the favicon.
3. **Arabic font.** Load IBM Plex Sans Arabic (weights 400, 500, 600) with `next/font/google` and expose it as the CSS variable `--font-arabic`, overriding the fallback in `nodulebridge-extensions.css`.
4. **Root layout.** `<html lang="en">`, `<body class="ak-app">`. Add a `LocaleProvider` (React context) holding `patientLocale: "en" | "ar"`. The app chrome stays English; only patient-facing panels switch language and direction (`lang="ar" dir="rtl"` on that panel only).
5. **App bar** (`components/shell/AppBar.tsx`) per the Asklevia App bar spec: 64px, White, bottom hairline, sticky. Left: `asklevia-logo-horizontal.svg` at 28px tall (alt “Asklevia”), a 1px × 24px `border-default` divider, then “NoduleBridge” in Funnel Display 20/28. Nav: “Case”, “Passport”, “About”. Right: an `ak-badge--outline` reading “Hackathon prototype”.
6. **Safety banner** (`components/shell/SafetyBanner.tsx`): `ak-alert ak-alert--info nb-safety-banner`, `role="status"`, info icon (Lucide `Info`), title “Decision and adherence support only — not a diagnosis.” body “Follow-up decisions belong to your doctor.” Shown on every route, not dismissible. Leave an Arabic string slot: `TODO-VERIFY: Arabic banner text, reviewed`.
7. **Routes** (all empty states using `ak-empty`):
   - `/` → Case workspace: left column 7/12 for the viewer card, right column 5/12 for report + findings cards. Empty state: “Upload a chest CT and its report to begin.”
   - `/passport` → “No passport yet. Analyse a case first.”
   - `/about` → product summary, data credits (LIDC-IDRI, TCIA, CC BY 3.0 citation placeholder), the non-diagnostic statement, team.
   - `/dev/kit` → a kitchen-sink page rendering every `ak-` component you will use (button variants, badges incl. `--ai`, alert variants, spectrum progress bar, steps, card, tabs, upload zone, confidence list). This is your visual regression page; keep it out of the nav.
8. **API skeleton** in `/api`: FastAPI app with `GET /health` returning `{status, version, model: ANTHROPIC_MODEL or null}`, CORS for the web origin, `pydantic-settings` for env, `pytest` with one passing test. Structure: `api/app/main.py`, `api/app/routers/`, `api/app/services/`, `api/app/schemas/`, `api/tests/`.
9. **Shared schemas.** Create `/shared/schemas/` with empty placeholders `nodule-finding.schema.json`, `extraction-result.schema.json`, `followup-recommendation.schema.json`, `case-manifest.schema.json` (filled in later phases). Generate TypeScript types from them with `json-schema-to-typescript` and Python models with `datamodel-code-generator`, wired to one script `make schemas`.
10. **Lint rule for hex colours.** Add a Stylelint rule (`color-no-hex`) for `web/src/**/*.css` excluding the three kit files, and an ESLint rule (or simple grep test) that fails on `#[0-9a-fA-F]{3,6}` inside `.tsx` files. This enforces “never hard-code a hex value”.

## Acceptance checks

- `make dev` (or `pnpm dev`) starts web on :3000 and api on :8000; `/health` returns 200.
- Every route shows the App bar with the colour logo, “NoduleBridge”, and the safety banner.
- `/dev/kit` renders all listed components; the spectrum appears only on the AI progress bar and the AI badge.
- Fonts: headings render in Funnel Display, body in Host Grotesk, a sample “9 mm · slice 114/247” in Geist Mono with tabular figures. A sample Arabic paragraph in a `lang="ar" dir="rtl"` box renders in IBM Plex Sans Arabic, right-aligned.
- `make lint` fails if you add `color: #ff0000` to any product CSS or TSX file, and passes when you remove it.
- Keyboard: Tab reaches every nav item and shows the 2px indigo focus ring.

## Do not

- Add Tailwind colour utilities or any palette other than Asklevia tokens. (Tailwind for layout only is allowed if you map its theme to the CSS variables; plain CSS modules are fine too.)
- Add dark mode or a theme toggle.
- Put the logo on the dark viewport or recolour it.

## Hand-off note must include

Chosen versions of Next.js, React, FastAPI, Python; how fonts are loaded; any `ak-` class that did not behave as its README says.
