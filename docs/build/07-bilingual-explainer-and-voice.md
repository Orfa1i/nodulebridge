# Phase 7 — Bilingual patient explainer and voice

**Time budget:** 4 hours · **Needs:** Phase 5 recommendation · **Produces:** a plain-language Arabic and English explanation built from reviewed templates, and a 15-second voice summary.

## Goal

The patient sees and hears, in Arabic or English: what was found, that most such findings are not cancer, why follow-up matters, what to do and by when. The words come from reviewed templates keyed by rule id, filled with values from the data. No free-form LLM text reaches the patient.

## Steps

1. **Content files** in `/shared/content/`:
   - `patient-templates.en.json` and `patient-templates.ar.json`: one entry per Fleischner rule id plus `NOT_APPLICABLE`, `CONDITIONAL`, `NO_MATCH`. Each entry has `found`, `reassure`, `why`, `todo`, `when`, `who`, `voice` (the short spoken version, about 35–40 words) and `review {status: "draft"|"reviewed", reviewer, date}`.
   - Placeholders only: `{size_mm}`, `{side}`, `{lobe}`, `{window_start}`, `{window_end}`, `{action_list}`.
   - `anatomy-terms.json`: the controlled translations, for example right upper lobe → الفص العلوي من الرئة اليمنى, solid → صلبة, ground-glass → زجاجية, part-solid → جزئية الصلابة, CT → الأشعة المقطعية, PET-CT → التصوير المقطعي بالإصدار البوزيتروني, biopsy → خزعة. Mark every Arabic term `TODO-VERIFY` until the clinician reviewer signs it off.
   - `pdq-snippets.json`: short passages copied **verbatim** by the team from NCI PDQ patient summaries on lung nodules and lung cancer screening, each with `id`, `text`, `url`, `retrieved_on`. `TODO-VERIFY:` the team pastes the real passages; do not write them yourself.
2. **Writing rules for the English templates** (Asklevia voice): the finding first, the next step second; sentences of 15 words or fewer; no jargon without a plain gloss (“nodule — a small spot”); calm order: found → reassure → why → what to do → when → who to call. Draft English yourself; mark `status: "draft"`.
3. **Arabic drafts.** Generate Arabic drafts of the English templates with the LLM once, offline (`api/scripts/draft_arabic.py`), using `anatomy-terms.json` as a forced glossary. Save as `status: "draft"`. A bilingual clinician reviews and edits them by hand and sets `status: "reviewed"`. **The video may only use reviewed strings**: add `make check-content`, which fails if any template used by Cases A–C is still `draft`.
4. **Renderer** `api/app/services/explain.py`: `explain(recommendation, finding, locale) -> {sections, voice_text, template_ids, review_status}`. Pure template filling. Dates formatted per locale; numbers stay Western digits in both languages for measurements and dates (decide with the team and record it; if you switch to Arabic-Indic digits, do it everywhere).
   - **Calendar gotcha:** in JavaScript `Intl.DateTimeFormat("ar-SA")` defaults to the Islamic (Umm al-Qura) calendar. Pass `calendar: "gregory"` explicitly, and optionally show the Hijri date after it in brackets. Same care in Python (use Babel with an explicit Gregorian format).
5. **Patient panel** (Case workspace, below the Next step card, and on the Passport):
   - `ak-tabs`: “English” and “العربية”. The Arabic tab panel has `lang="ar" dir="rtl"`; check that `ak-` components render correctly mirrored (icons that imply direction flip; numbers and “9 mm” stay LTR inside `<bdi>`).
   - Sections as short paragraphs with small headings (“What the scan showed”, “What this usually means”, “What to do next”, “By when”, “Who to contact”).
   - A source line under the reassurance section: “Source: NCI’s PDQ cancer information summary for patients on [topic] states: …” following PDQ’s permission rules (it may be quoted as an excerpt; it may not be presented as the full PDQ summary).
   - The `ak-badge--ai` “AI-assisted translation · reviewed by {reviewer}” on the Arabic tab when reviewed; if any string is draft (dev only), an `ak-badge--warning` “Translation not yet reviewed”.
6. **Voice.**
   - `api/app/services/tts.py` with a provider interface; implement one provider from `TTS_PROVIDER` (Arabic `ar-SA` neural voice and an English voice from env).
   - For Cases A–C, pre-generate `voice.ar.mp3` and `voice.en.mp3` with `make voices` into the case folders; the UI marks them “Pre-computed for demo”. For other inputs, generate live and cache by text hash.
   - Player component: `ak-btn--primary` “Play summary” (one primary per view: demote others on this screen to secondary), with pause, a Geist Mono time readout, and the transcript always visible below (accessibility; never voice-only information). The spoken Arabic must match the on-screen Arabic exactly.
   - The voice carries `ak-badge--ai` “AI voice”.
7. **Tests:** every template renders for every Case A–C recommendation in both locales without leftover `{placeholders}`; a banned-words test fails on “diagnos”, “cancer-free”, “guarantee”, “!”, emoji, and their Arabic equivalents you list in `banned-words.json`; the Arabic panel snapshot has `dir="rtl"`.

## Acceptance checks

- Case A shows complete English and Arabic explanations with the correct size, side, lobe and dates; audio plays in both languages, 12–18 seconds long.
- `make check-content` passes only when the strings used by Cases A–C are marked reviewed.
- No patient-facing sentence comes from a live LLM call (grep the explain path: no API client import).
