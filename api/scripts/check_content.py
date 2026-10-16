"""check-content: fail while any patient-facing string used by Cases A to C is still a draft.

Usage (repo root): uv run --project api python -m api.scripts.check_content [--content-dir DIR]

The video may only use reviewed strings. For each of Cases A, B and C and each language this renders the real
explanation and lists every template, controlled term, translated engine sentence and PDQ excerpt it used whose
status is not "reviewed". It also fails if a pre-generated voice file is missing or no longer speaks the current text.
It is expected to FAIL until a bilingual clinician has reviewed the Arabic and the team has reviewed the English and
confirmed the PDQ excerpts: set review.status (templates) or status (terms, engine strings, PDQ) to "reviewed".
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.explain import load_content
from app.services.passport import PassportPayload, booking_request
from app.services.tts import text_sha256

from .case_content import CASES, case_dir, case_explanation, case_passport


def run_check(content_dir: str | None = None, cases: tuple[str, ...] = CASES, voices: bool = True) -> tuple[bool, list[str]]:
    content = load_content(content_dir)
    strings = json.loads((content.directory / "passport.json").read_text(encoding="utf-8"))["strings"]
    lines: list[str] = []
    drafts: set[str] = set()
    for letter in cases:
        passport = PassportPayload.model_validate(case_passport(letter, content))
        for locale in ("en", "ar"):
            exp = case_explanation(letter, locale, content)
            for item in exp["review_status"]["draft_items"]:
                drafts.add(f"{locale}: {item}")
            booking = booking_request(passport, locale, strings)
            for item in booking["review_status"]["draft_items"]:
                drafts.add(f"{locale}: {item}")
            for key in ("ics.book_summary", "ics.window_summary", "ics.caregiver_summary", "ics.description"):
                if strings[key]["status"] != "reviewed":
                    drafts.add(f"{locale}: passport:{locale}:{key}")
            if voices:
                sidecar = case_dir(letter) / f"voice.{locale}.json"
                if not sidecar.exists():
                    lines.append(f"case {letter} {locale}: voice file missing (run: pnpm voices)")
                elif json.loads(sidecar.read_text(encoding="utf-8"))["text_sha256"] != text_sha256(exp["voice_text"]):
                    lines.append(f"case {letter} {locale}: voice file speaks different words than the screen (run: pnpm voices)")
    lines = [f"draft: {d}" for d in sorted(drafts)] + lines
    return (not lines), lines


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--content-dir")
    args = ap.parse_args()
    ok, lines = run_check(args.content_dir)
    if ok:
        print("check-content: PASS. Every string used by Cases A to C is reviewed and every voice file matches its text.")
        return 0
    print(f"check-content: FAIL ({len(lines)} items). The video must not use these yet:")
    for line in lines:
        print(f"  - {line}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
