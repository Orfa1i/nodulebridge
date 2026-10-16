"""Pre-generate the voice summaries of Cases A to C (English and Arabic) into the case folders.

Usage (repo root): uv run --project api python -m api.scripts.make_voices [--only a] [--locale ar]

Writes data/cases/case-x/voice.en.mp3 and voice.ar.mp3 plus a .json sidecar holding the exact text that is spoken and
its SHA-256. The UI plays a file only if the sidecar hash equals the hash of the text on screen, so the spoken words
always match the written words. The UI labels these files "Pre-computed for demo".
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import get_settings
from app.services.tts import TtsFailed, TtsUnavailable, make_tts, write_audio

from .case_content import CASES, case_dir, case_explanation

TARGET = (12.0, 18.0)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", choices=CASES)
    ap.add_argument("--locale", choices=("en", "ar"))
    ap.add_argument("--pause", type=float, default=21.0, help="seconds between calls (free tiers rate-limit speech)")
    args = ap.parse_args()
    try:
        tts = make_tts(get_settings())
    except TtsUnavailable as exc:
        print(f"CANNOT RUN: {exc}")
        return 2
    problems = 0
    for letter in [args.only] if args.only else CASES:
        for locale in [args.locale] if args.locale else ("en", "ar"):
            exp = case_explanation(letter, locale)
            text = exp["voice_text"]
            try:
                audio = tts.synthesize(text, locale)
            except TtsFailed as exc:
                print(f"case {letter} {locale}: FAILED {exc.detail or exc}")
                problems += 1
                continue
            write_audio(case_dir(letter) / f"voice.{locale}.mp3", audio, text, exp["review_status"]["status"])
            ok = TARGET[0] <= audio.duration_s <= TARGET[1]
            problems += 0 if ok else 1
            print(f"case {letter} {locale}: {audio.duration_s:5.1f} s {'ok' if ok else 'OUTSIDE 12-18 s'} · {len(text.split())} words · cached={audio.cached} · {text[:70]}...")
            if not audio.cached:
                time.sleep(args.pause)
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
