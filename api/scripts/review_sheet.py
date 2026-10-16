"""Write docs/build/clinician-review-sheet.md: every draft string used by Cases A to C, English beside Arabic, with a tick box.

Usage (repo root): uv run --project api python -m api.scripts.review_sheet

The reviewer edits the Arabic (and English) in shared/content/*.json, then sets status to "reviewed" (templates: review.status,
reviewer, date) and runs `pnpm voices` and `pnpm check-content`. This sheet only lists what has to be read; it changes nothing.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import ROOT
from app.services.explain import load_content
from app.services.passport import PassportPayload, booking_request

from .case_content import CASES, case_explanation, case_passport

OUT = ROOT / "docs" / "build" / "clinician-review-sheet.md"
FIELDS = ("found", "reassure", "why", "todo", "when", "who", "voice", "voice_append")
CAL = ("ics.book_summary", "ics.window_summary", "ics.caregiver_summary", "ics.description")


def cell(text: str | None) -> str:
    return (text or "").replace("|", "\\|").replace("\n", " ") or "(empty)"


def main() -> int:
    c = load_content()
    passport = json.loads((ROOT / "shared" / "content" / "passport.json").read_text(encoding="utf-8"))["strings"]
    templates: set[str] = set()
    terms: set[str] = set()
    engine: set[str] = set()
    pdq: set[str] = set()
    pkeys: set[str] = set(CAL)
    for letter in CASES:
        payload = PassportPayload.model_validate(case_passport(letter, c))
        for locale in ("en", "ar"):
            used = case_explanation(letter, locale, c)["review_status"]["used"]
            for key, status in used.items():
                if status == "reviewed":
                    continue
                if key.startswith("template:"):
                    templates.add(key.split(":")[2])
                elif key.startswith("term:"):
                    terms.add(key[5:])
                elif key.startswith("engine:"):
                    prefix = key[7:]
                    engine.update(e for e in c.engine if e.startswith(prefix))
                elif key.startswith("pdq:"):
                    pdq.add(key.split(":")[1])
            for k in booking_request(payload, locale)["review_status"]["draft_items"]:
                pkeys.add(k.split(":", 2)[2])

    lines = [
        "# Clinician review sheet",
        "",
        "Every string below is used by Cases A to C and is still `draft`. Read each English line and its Arabic line, correct the Arabic (and the English if it is wrong) in the file named in each heading, then set the status to `reviewed` with your name and the date. Then run `pnpm voices` (the spoken clips are made from the voice lines) and `pnpm check-content`, which must pass before the video.",
        "",
        "Rules that apply to all text: finding first, no hype, no exclamation marks, never the word diagnosis (except the fixed line \"not a diagnosis\"), no health claim except the verbatim NCI excerpts. Numbers use Western digits in both languages. Measurements keep Latin \"mm\".",
        "",
        "## 1. Patient templates (`shared/content/patient-templates.en.json` and `.ar.json`)",
        "",
        "Set `review.status` to `reviewed`, `review.reviewer` and `review.date` for each template id.",
        "",
    ]
    for tid in sorted(templates):
        lines += [f"### {tid}", "", "| Field | English | Arabic | OK |", "|---|---|---|---|"]
        for f in FIELDS:
            en, ar = c.templates["en"].get(tid, {}).get(f), c.templates["ar"].get(tid, {}).get(f)
            if en or ar:
                lines.append(f"| {f} | {cell(en)} | {cell(ar)} | [ ] |")
        lines.append("")
    lines += ["## 2. Controlled terms (`shared/content/anatomy-terms.json`)", "", "Set `status` to `reviewed`.", "", "| Key | English | Arabic | OK |", "|---|---|---|---|"]
    lines += [f"| {k} | {cell(c.terms[k].get('en'))} | {cell(c.terms[k].get('ar'))} | [ ] |" for k in sorted(terms)]
    lines += ["", "## 3. Guideline sentences (`shared/content/engine-strings.json`)", "", "Set `status` to `reviewed`.", "", "| English | Arabic | OK |", "|---|---|---|"]
    lines += [f"| {cell(e)} | {cell(c.engine[e].get('ar'))} | [ ] |" for e in sorted(engine)]
    lines += ["", "## 4. NCI PDQ excerpts (`shared/content/pdq-snippets.json`)", "", "English must be a verbatim copy of the NCI page (check the link and date). Set `status` to `reviewed` for the source and for the Arabic.", ""]
    for sid in sorted(pdq):
        s = c.pdq[sid]
        lines += [f"### {sid}", "", f"Source: {s['url']} (retrieved {s['retrieved_on']}), topic: {s['topic']}", "", f"- English (verbatim): {cell(s['text'])}", f"- Arabic: {cell((s.get('ar') or {}).get('text'))}", "- [ ] English matches the NCI page   - [ ] Arabic is faithful", ""]
    lines += ["## 5. Booking request and calendar text (`shared/content/passport.json`)", "", "Set `status` to `reviewed`. The Arabic safety statement (`ics.statement`) is NOT drafted: write it here.", "", "| Key | English | Arabic | OK |", "|---|---|---|---|"]
    lines += [f"| {k} | {cell(passport[k]['en'])} | {cell(passport[k]['ar'])} | [ ] |" for k in sorted(pkeys) if k in passport]
    lines += ["", "## 6. Other Arabic text to check", "", "- Safety banner (Arabic): `web/src/components/shell/SafetyBanner.tsx` (`SAFETY_BANNER_AR` is empty on purpose; no Arabic ships until you write it). [ ] written",
              "- Arabic button and label texts in the voice player: `web/src/components/report/PatientSummaryCard.tsx` (`UI.ar`). [ ] reviewed",
              "- Arabic banned-word list: `shared/content/banned-words.json`. [ ] extended", "- Listen to the three Arabic voice clips (`data/cases/case-*/voice.ar.mp3`). [ ] a, [ ] b, [ ] c", ""]
    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}: {len(templates)} templates, {len(terms)} terms, {len(engine)} guideline sentences, {len(pdq)} PDQ excerpts, {len([k for k in pkeys if k in passport])} passport strings")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
