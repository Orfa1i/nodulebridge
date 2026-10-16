# 00 — Master brief (give this to the agent at the start of every session)

You are the lead engineer building **NoduleBridge**, a product by **Asklevia**, for an oncology hackathon (track: Detection & Diagnosis). Read this whole file before any phase file. These rules override anything in a phase file that seems to contradict them; if you find a contradiction, stop and say so.

## 1. The product in one paragraph

An emergency CT done for something else (for example rib pain) shows an incidental lung nodule. The finding is buried in an English radiology report, the patient is discharged, and follow-up never happens. NoduleBridge takes the CT (DICOM) and the report, finds the nodule sentence, shows the nodule in a 3D CT viewer linked to that sentence, applies the Fleischner Society 2017 follow-up rules, explains the next step in plain Arabic and English (text and voice), and produces a referral passport (PDF, FHIR summary, calendar reminders). It supports follow-up; it never diagnoses.

## 2. The demo moment everything serves

At about 0:18 in the video: the user drops a chest CT folder and a radiology report PDF into the browser. Within about 4 seconds the viewer jumps to the nodule’s slice, outlines the nodule, highlights the matching report sentence, shows the Fleischner next step with its citation, and plays a 15-second Arabic voice summary. Every number on screen (slice index, size in mm, lobe) must come from the data, never from hard-coded text. Pre-computing heavy steps is allowed and must be disclosed in the UI (see section 6).

## 3. Repository layout (create in Phase 1, keep it)

```
/web         Next.js (App Router, TypeScript), the whole UI
/api         FastAPI (Python 3.11+): extraction, rules, passport
/pipeline    offline Python scripts: LIDC-IDRI case preparation
/shared      JSON Schemas shared by web and api (single source of truth)
/data        prepared demo cases (git-ignored except small JSON)
/docs/build  these phase files + progress.md
/asklevia    the Asklevia kit, copied from docs/build/asklevia-kit
```

Pin every dependency version in lockfiles. Use the current stable release of each library at the time you start, and write the chosen versions into `docs/build/progress.md` in Phase 1. Do not upgrade mid-build.

## 4. Asklevia identity (applies to every screen)

Read `asklevia/ASKLEVIA-README.md` once, fully. Key rules:

- **Light mode only.** Page `bg-page` (Paper #F7F8FB); content on White cards with a `border-default` hairline. The only dark surface is the CT viewport (`.nb-viewport`), and it always sits inside a White card.
- **Indigo (#2B2FD9) is the only interactive colour**: buttons, links, focus, selection.
- **Neural Spectrum** (indigo → violet → azure → teal → verdant) appears in exactly three places: the spectrum Progress bar while AI works, the `ak-badge--ai` badge on AI-produced content, and at most one spectrum Divider per page. Never as decoration. Never to mean “success”.
- **What counts as AI here**: report extraction (LLM), any model segmentation, Arabic translation, the voice. These carry `ak-badge--ai`. The Fleischner recommendation is deterministic code: it carries a `ak-badge--brand` badge reading “Guideline rule”, never the AI badge.
- **Type**: Funnel Display 500 for headings, Host Grotesk for text, Geist Mono with tabular figures for every measurement, ID, slice index, probability and PMID. Never below 12px. Arabic text uses IBM Plex Sans Arabic (see `nodulebridge-extensions.css`).
- **Shape**: buttons, badges, chips and progress bars are pills; inputs 8px, alerts 12px, cards and dialogs 16px. Depth is hairlines, not shadows.
- **Motion**: 120ms hover, 200ms toggles, 320ms dialogs and progress, easing `cubic-bezier(0.2, 0.8, 0.2, 1)`. Respect `prefers-reduced-motion`.
- **Icons**: Lucide, outline, 2px stroke, 16/20/24px, `currentColor`. Icon-only buttons need `aria-label`.
- **Logo**: horizontal colour lockup, 28px tall, in the App bar. Light backgrounds only. Never recolour it. Product name “NoduleBridge” sits beside it after a hairline divider, in Funnel Display 20px.
- **Never hard-code a hex value in product code.** Use the CSS variables from `tokens.css` and `nodulebridge-extensions.css`. Use `ak-` classes before writing new CSS. Any new reusable style goes into `nodulebridge-extensions.css` marked PROPOSED.

### Voice and copy (Asklevia rules, enforced in every string)

- The finding first, the next step second. Short sentences. Sentence case.
- Buttons start with a verb: “Upload scan”, “Start analysis”, “Play summary”, “Download passport”.
- Never overstate the AI: say “AI-assisted”, show confidence, say when confidence is low. Never write “diagnosed by AI”, “detects cancer” or anything similar.
- No exclamation marks, no emoji, no hype words (“revolutionary”, “magic”, “life-saving”).
- Example data is always labelled: “Example patient A · LIDC-IDRI-XXXX”. Never show real patient data.

## 5. Clinical safety rules (non-negotiable)

1. The persistent banner on every screen: **“Decision and adherence support only — not a diagnosis. Follow-up decisions belong to your doctor.”** (English) plus its reviewed Arabic version.
2. The LLM **extracts** facts from the report into a fixed JSON schema. It never chooses the follow-up interval. The interval comes from the deterministic Fleischner engine (Phase 5), which has unit tests for every row of the table.
3. Never invent a clinical value, code (SNOMED, LOINC, RadLex), citation, PMID or statistic. If you need one and do not have it from a source in this brief or the phase file, write `TODO-VERIFY:` with what is needed and continue.
4. Fleischner 2017 does not apply to: patients under 35, lung cancer screening CTs (Lung-RADS applies), patients with known cancer, immunocompromised patients. The engine must check these and say “Guideline does not apply — ask your doctor” when they fail or are unknown.
5. Patient-facing wording is calm. It says most incidental lung nodules are not cancer, and that follow-up is how that is confirmed. Use only wording drawn from the NCI PDQ snippets library (Phase 7) for any health claim.
6. Data: only TCIA LIDC-IDRI images (CC BY 3.0, attribute it) and team-written example reports. No real patient data at any point, including tests.

## 6. Honesty in the demo

- Anything pre-computed (segmentation masks, voice audio) shows a small `ak-badge--outline` “Pre-computed for demo” with a tooltip explaining what ran offline.
- A “Verification” drawer (Phase 9) shows the LIDC-IDRI case ID, the raw extraction JSON, the rule that fired with its table row, and timings.
- Never fake a step with a timer. If a step is cached, say so; if it runs live, it runs live.

## 7. How you work

- One phase at a time. Read the phase file fully, then plan in at most 10 bullet points, then build.
- Commit after each numbered step with a message like `phase-04 step 3: negation tests`.
- Write tests as you go: Python `pytest`, web `vitest` + Playwright for the one end-to-end flow.
- At the end of the phase, run every acceptance check in the phase file, then append to `docs/build/progress.md`: what was built, versions chosen, deviations and why, open `TODO-VERIFY` items, and anything the next phase must know.
- If a step is blocked (missing key, data download too slow, library broken), say so and propose the smallest workaround. Do not silently change scope.

## 8. Environment variables (create `.env.example` in Phase 1)

```
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=            # current Claude Sonnet model id, set by the team
TTS_PROVIDER=               # e.g. azure | google | elevenlabs
TTS_API_KEY=
TTS_VOICE_AR=               # an ar-SA neural voice
TTS_VOICE_EN=
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
DATA_BASE_URL=              # where prepared case files are served from
```
