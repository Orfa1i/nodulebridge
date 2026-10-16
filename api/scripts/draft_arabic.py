"""Draft the Arabic patient content from the English content, ONCE, offline.

Usage (repo root): uv run --project api python -m api.scripts.draft_arabic [--model gemini-3.5-flash] [--only-missing]

What it does
- translates every English template field, heading, engine string and PDQ excerpt with a Gemini model;
- forces the controlled glossary in shared/content/anatomy-terms.json (the model must use those Arabic terms);
- keeps placeholders such as {size_mm} and {pdq:ID} exactly as written (checked after the call, retried if altered);
- writes everything with status "draft". A bilingual clinician then edits the files by hand and sets
  review.status to "reviewed". Nothing from this script may be used in the video until that is done.

The output is never shown to a patient without the "Translation not yet reviewed" warning while it is draft.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import ROOT, get_settings

CONTENT = ROOT / "shared" / "content"
PLACEHOLDER = re.compile(r"\{[^{}]+\}")
FIELDS = ["found", "reassure", "why", "todo", "when", "who", "voice", "voice_append"]
VOICE_WORDS = {"voice": 23, "voice_append": 7}  # spoken Arabic is slower: keep the clip near 15 s
# the safety statement is never machine-translated: its Arabic wording must come from a clinician (master brief 5.1)
NOT_DRAFTED = {"ics.statement"}
ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

SYSTEM = """You translate short patient-facing health text from English to Modern Standard Arabic for a hospital app.
Rules:
- Calm, plain, respectful tone. Short sentences. Write for an adult with no medical training.
- Use EXACTLY the Arabic terms of the glossary below whenever the English term appears.
- Keep every placeholder exactly as written, character for character, for example {size_mm}, {location}, {type}, {type_short}, {window_start}, {window_end}, {action_list}, {questions}, {reasons}, {pdq:abnormal_no_cancer}. Do not translate or move the braces. A placeholder may sit anywhere the grammar needs it.
- Keep "mm" in Latin letters. Keep numbers and dates as Western digits (0-9).
- Keep "Fleischner Society 2017" and "CT" / "PET-CT" as written only where the glossary does not give an Arabic term.
- No exclamation marks, no emoji, no hype, and never write the word diagnosis. Do not add or remove information.
- A string that is empty in English stays empty.
- If an item has max_words, the Arabic MUST have between 85% and 100% of that many words (a spoken clip of about 14 seconds): condense by dropping filler, but keep the size, the place, the next step and the line telling the patient to talk to their doctor.
Return JSON: {"translations": [{"id": "...", "ar": "..."}]} with one item per input id, in the same order."""


def glossary() -> str:
    terms = json.loads((CONTENT / "anatomy-terms.json").read_text(encoding="utf-8"))["terms"]
    lines = [f"- {t['en']} => {t['ar']}" for k, t in terms.items() if t["en"] and t["ar"] and not k.startswith(("cond.", "ui."))]
    return "\n".join(lines)


def call(model: str, key: str, items: list[dict], attempts: int = 6) -> dict[str, str]:
    body = {
        "systemInstruction": {"parts": [{"text": SYSTEM + "\n\nGlossary (English => Arabic):\n" + glossary()}]},
        "contents": [{"role": "user", "parts": [{"text": json.dumps(items, ensure_ascii=False)}]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "temperature": 0,
            "responseJsonSchema": {
                "type": "object",
                "properties": {
                    "translations": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {"id": {"type": "string"}, "ar": {"type": "string"}},
                            "required": ["id", "ar"],
                        },
                    }
                },
                "required": ["translations"],
            },
        },
    }
    last = ""
    for attempt in range(1, attempts + 1):
        r = httpx.post(
            ENDPOINT.format(model=model),
            headers={"x-goog-api-key": key, "content-type": "application/json"},
            json=body,
            timeout=180,
        )
        if r.status_code == 200:
            text = "".join(p.get("text", "") for p in r.json()["candidates"][0]["content"]["parts"] if not p.get("thought"))
            out = {t["id"]: t["ar"] for t in json.loads(text)["translations"]}
            bad = [
                i["id"]
                for i in items
                if i["id"] not in out or sorted(PLACEHOLDER.findall(i["en"])) != sorted(PLACEHOLDER.findall(out[i["id"]]))
            ]
            if not bad:
                return out
            last = f"placeholders altered or missing for: {bad}"
            body["contents"][0]["parts"][0]["text"] = json.dumps(items, ensure_ascii=False) + f"\nFix: {last}. Keep placeholders exactly."
        else:
            last = f"HTTP {r.status_code}: {r.text[:300]}"
            if r.status_code in (400, 401, 403, 404):
                break
        time.sleep(10 * attempt)
    raise SystemExit(f"translation failed: {last}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="gemini-3.5-flash")
    ap.add_argument("--only-missing", action="store_true", help="keep existing Arabic strings, translate only what is empty")
    args = ap.parse_args()
    key = get_settings().google_api_key
    if not key:
        raise SystemExit("GOOGLE_API_KEY is not set in .env")

    en = json.loads((CONTENT / "patient-templates.en.json").read_text(encoding="utf-8"))
    ar_path = CONTENT / "patient-templates.ar.json"
    ar = json.loads(ar_path.read_text(encoding="utf-8")) if (ar_path.exists() and args.only_missing) else {"templates": {}, "headings": {}}
    engine = json.loads((CONTENT / "engine-strings.json").read_text(encoding="utf-8"))
    pdq = json.loads((CONTENT / "pdq-snippets.json").read_text(encoding="utf-8"))
    passport = json.loads((CONTENT / "passport.json").read_text(encoding="utf-8"))

    items: list[dict] = []
    for k, v in en["headings"].items():
        if not (args.only_missing and ar["headings"].get(k)):
            items.append({"id": f"heading.{k}", "en": v})
    for tid, t in en["templates"].items():
        for f in FIELDS:
            if t.get(f) and not (args.only_missing and ar["templates"].get(tid, {}).get(f)):
                item = {"id": f"tpl.{tid}.{f}", "en": t[f]}
                if f in VOICE_WORDS:
                    limit = 27 if tid == "FL17-S1-GT8" and f == "voice" else VOICE_WORDS[f]
                    if tid == "CONDITIONAL" and f == "voice":
                        limit = 14
                    item["max_words"] = limit
                items.append(item)
    for s, v in engine["strings"].items():
        if not (args.only_missing and v["ar"]):
            items.append({"id": f"engine.{s}", "en": s})
    for sid, v in pdq["snippets"].items():
        if not (args.only_missing and v["ar"]["text"]):
            items.append({"id": f"pdq.{sid}", "en": v["text"]})

    for k, v in passport["strings"].items():
        if k not in NOT_DRAFTED and not (args.only_missing and v["ar"]):
            items.append({"id": f"passport.{k}", "en": v["en"]})

    print(f"translating {len(items)} strings with {args.model} in batches of 40")
    done: dict[str, str] = {}
    for i in range(0, len(items), 40):
        done.update(call(args.model, key, items[i : i + 40]))
        print(f"  {min(i + 40, len(items))}/{len(items)}")

    ar["locale"] = "ar"
    ar["_note"] = (
        "DRAFT Arabic generated by api/scripts/draft_arabic.py with a forced glossary. Not reviewed. "
        "A bilingual clinician edits this file by hand and sets review.status to reviewed for each template."
    )
    for k in en["headings"]:
        ar["headings"][k] = done.get(f"heading.{k}", ar["headings"].get(k, ""))
    for tid, t in en["templates"].items():
        entry = ar["templates"].setdefault(tid, {})
        for f in FIELDS:
            if f in t:
                entry[f] = done.get(f"tpl.{tid}.{f}", entry.get(f, "")) if t[f] else ""
        entry["review"] = entry.get("review") or {"status": "draft", "reviewer": None, "date": None}
    ar_path.write_text(json.dumps(ar, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    for s, v in engine["strings"].items():
        if f"engine.{s}" in done:
            v["ar"], v["status"] = done[f"engine.{s}"], "draft"
    (CONTENT / "engine-strings.json").write_text(json.dumps(engine, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    for sid, v in pdq["snippets"].items():
        if f"pdq.{sid}" in done:
            v["ar"] = {"text": done[f"pdq.{sid}"], "status": "draft"}
    (CONTENT / "pdq-snippets.json").write_text(json.dumps(pdq, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    for k, v in passport["strings"].items():
        if f"passport.{k}" in done:
            v["ar"], v["status"] = done[f"passport.{k}"], "draft"
    (CONTENT / "passport.json").write_text(json.dumps(passport, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("wrote patient-templates.ar.json, engine-strings.json, pdq-snippets.json, passport.json (all status draft)")


if __name__ == "__main__":
    main()
