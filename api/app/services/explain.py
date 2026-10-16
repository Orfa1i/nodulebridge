"""Patient explainer: reviewed templates filled with data. No language model is involved, ever.

`explain(recommendation, finding, locale)` turns the output of the Fleischner engine into short sections in
English or Arabic plus a spoken version. Every sentence comes from shared/content/*.json, keyed by the rule id
and filled with values from the data. Nothing in this module (or anything it imports) may call an LLM API:
a test checks that.

Decisions recorded here
- Numbers, measurements and dates use Western digits (0-9) in BOTH languages. Arabic-Indic digits that Babel
  produces for dates are converted. Measurements keep Latin "mm"; the UI isolates them with <bdi>.
- Dates use an explicit Gregorian format. (Intl.DateTimeFormat("ar-SA") would default to the Islamic calendar.)
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import date
from functools import lru_cache
from pathlib import Path
from typing import Any

from babel.dates import format_date

from app.config import ROOT

CONTENT_DIR = ROOT / "shared" / "content"
LOCALES = ("en", "ar")
SECTIONS = ("found", "reassure", "why", "todo", "when", "who")
BABEL_LOCALE = {"en": "en", "ar": "ar_SA"}
ARABIC_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")
PLACEHOLDER = re.compile(r"\{([^{}]+)\}")
SOURCE_URL_LABEL = {"en": "ui.source", "ar": "ui.source"}


class ContentError(Exception):
    """The content files do not cover what the engine produced. Fix the content, never show a half sentence."""


@dataclass
class Content:
    templates: dict[str, dict[str, Any]]
    headings: dict[str, dict[str, str]]
    terms: dict[str, dict[str, str]]
    engine: dict[str, dict[str, Any]]
    pdq: dict[str, dict[str, Any]]
    banned: dict[str, Any]
    directory: Path = field(default=CONTENT_DIR)


@lru_cache(maxsize=4)
def load_content(directory: str | None = None) -> Content:
    d = Path(directory) if directory else CONTENT_DIR
    read = lambda name: json.loads((d / name).read_text(encoding="utf-8"))
    en, ar = read("patient-templates.en.json"), read("patient-templates.ar.json")
    return Content(
        templates={"en": en["templates"], "ar": ar["templates"]},
        headings={"en": en["headings"], "ar": ar["headings"]},
        terms=read("anatomy-terms.json")["terms"],
        engine=read("engine-strings.json")["strings"],
        pdq=read("pdq-snippets.json")["snippets"],
        banned=read("banned-words.json"),
        directory=d,
    )


def western_digits(text: str) -> str:
    return text.translate(ARABIC_DIGITS)


class Used:
    """Records every piece of reviewable content that ended up in an output."""

    def __init__(self) -> None:
        self.items: dict[str, str] = {}  # key -> review status

    def add(self, key: str, status: str) -> None:
        self.items[key] = status


class Renderer:
    def __init__(self, content: Content, locale: str):
        if locale not in LOCALES:
            raise ValueError(f"locale must be one of {LOCALES}")
        self.c, self.locale, self.used = content, locale, Used()
        self.sources: list[dict[str, str]] = []

    # ----- content lookups -----
    def term(self, key: str, **fmt: str) -> str:
        t = self.c.terms.get(key)
        if t is None or (key != "type_short.unknown" and not t.get(self.locale)):
            raise ContentError(f"missing term {key!r} for {self.locale}")
        self.used.add(f"term:{key}", t["status"])
        text = t.get(self.locale) or ""
        return text.format(**fmt) if fmt else text

    def engine_string(self, english: str) -> str:
        if self.locale == "en":
            if english not in self.c.engine:
                raise ContentError(f"engine string not in engine-strings.json: {english!r}")
            return english
        entry = self.c.engine.get(english)
        if entry is None or not entry.get("ar"):
            raise ContentError(f"no Arabic for engine string: {english!r}")
        self.used.add(f"engine:{english[:48]}", entry["status"])
        return entry["ar"]

    def pdq_quote(self, snippet_id: str) -> str:
        s = self.c.pdq.get(snippet_id)
        if s is None:
            raise ContentError(f"unknown PDQ snippet {snippet_id!r}")
        # the English excerpt is verbatim from NCI; it counts as reviewed once the team has confirmed it against the page
        self.used.add(f"pdq:{snippet_id}:source", s["status"])
        if self.locale == "en":
            text = s["text"]
        else:
            text = (s["ar"] or {}).get("text")
            if not text:
                raise ContentError(f"no Arabic for PDQ snippet {snippet_id!r}")
            self.used.add(f"pdq:{snippet_id}:ar", s["ar"]["status"])
        if not any(x["id"] == snippet_id for x in self.sources):
            self.sources.append({"id": snippet_id, "url": s["url"], "retrieved_on": s["retrieved_on"], "topic": s["topic"], "text": s["text"]})
        return f"\u201c{text}\u201d"

    # ----- formatting -----
    def date(self, iso: str) -> str:
        return western_digits(format_date(date.fromisoformat(iso), format="d MMMM y", locale=BABEL_LOCALE[self.locale]))

    def window(self, a: dict[str, Any]) -> str | None:
        if not a.get("window_start"):
            return None
        if a["window_start"] == a["window_end"]:
            return self.term("phrase.around", start=self.date(a["window_start"]))
        return self.term("phrase.between", start=self.date(a["window_start"]), end=self.date(a["window_end"]))

    def action_phrase(self, a: dict[str, Any], *, show_optional: bool) -> str:
        if a["type"] == "NONE":
            return self.term("action.none").rstrip(".")
        base = self.term({"CT": "action.ct", "PET_CT": "action.pet_ct", "TISSUE_SAMPLING": "action.biopsy"}[a["type"]])
        parts = [base]
        w = self.window(a)
        if w:
            parts.append(w)
        if a.get("repeat_every_months"):
            months, until = a["repeat_every_months"], a["until_months"]
            if months % 12 == 0 and until % 12 == 0:
                key = "phrase.every_year" if months == 12 else "phrase.every_years"
                parts.append(self.term(key, every=str(months // 12), until=str(until // 12)))
            else:
                parts.append(self.term("phrase.every_months", every=str(months), until=str(until)))
        if a.get("condition"):
            parts.append(f"({self.term('cond.' + a['condition'])})")
        if show_optional and a.get("optional"):
            parts.append(f"({self.term('phrase.optional')})")
        return " ".join(parts)

    def option_text(self, opt: dict[str, Any]) -> str:
        sentences: list[str] = []
        if opt["mode"] == "any_of":
            items = [self.action_phrase(a, show_optional=False) for a in opt["actions"]]
            joined = ", ".join(items[:-1]) + f" {self.term('phrase.or')} {items[-1]}" if len(items) > 1 else items[0]
            sentences.append(f"{self.term('phrase.consider_one')} {joined}.")
        else:
            def walk(actions: list[dict[str, Any]], first: bool) -> None:
                for a in actions:
                    s = self.action_phrase(a, show_optional=True)
                    if not first:
                        s = f"{self.term('phrase.then')} {s}"
                    sentences.append(s[0].upper() + s[1:] + "." if self.locale == "en" else s + ".")
                    walk(a["then"], False)

            walk(opt["actions"], True)
        text = " ".join(sentences)
        if opt.get("label"):
            key = "phrase.risk_low" if "low" in opt["label"] else "phrase.risk_high"
            text = f"{self.term(key)}: {text}"
        return text

    def action_list(self, options: list[dict[str, Any]]) -> str:
        return " ".join(self.option_text(o) for o in options)

    def fill(self, text: str, values: dict[str, str]) -> str:
        def sub(m: re.Match[str]) -> str:
            key = m.group(1)
            if key.startswith("pdq:"):
                return self.pdq_quote(key[4:])
            if key not in values:
                raise ContentError(f"placeholder {{{key}}} has no value")
            return values[key]

        out = PLACEHOLDER.sub(sub, text)
        return re.sub(r"\s{2,}", " ", out).strip().replace(" .", ".").replace(" ,", ",")


def first_window(options: list[dict[str, Any]]) -> dict[str, Any] | None:
    def walk(actions: list[dict[str, Any]]) -> dict[str, Any] | None:
        for a in actions:
            if a.get("window_start"):
                return a
            hit = walk(a["then"])
            if hit:
                return hit
        return None

    for opt in options:
        hit = walk(opt["actions"])
        if hit:
            return hit
    return None


def template_ids(rec: dict[str, Any], matched: bool | None) -> list[str]:
    if rec["applies"] is False and rec.get("driving_nodule_id") is None:
        ids = ["NO_FINDING"]  # the report names no nodule at all: say that, do not quote anything about abnormal results
    elif rec["applies"] is False:
        ids = ["NOT_APPLICABLE"]
    elif rec["rule_id"] is None:
        ids = ["CONDITIONAL"]
    else:
        ids = [rec["rule_id"]] + (["CONDITIONAL"] if rec["applies"] == "conditional" else [])
    if matched is False and ids != ["NO_FINDING"]:  # with no finding there is nothing to match to the scan
        ids.append("NO_MATCH")
    return ids


def explain(
    recommendation: dict[str, Any],
    finding: dict[str, Any] | None,
    locale: str,
    *,
    matched: bool | None = None,
    content: Content | None = None,
) -> dict[str, Any]:
    """Render the patient explanation. Raises ContentError if the content does not cover the case."""
    c = content or load_content()
    r = Renderer(c, locale)
    rec, finding = recommendation, finding or {}
    ids = template_ids(rec, matched)
    for tid in ids:
        if tid not in c.templates[locale]:
            raise ContentError(f"no {locale} template for {tid}")

    side, lobe = finding.get("side"), finding.get("lobe")
    loc_key = f"location.{side}.{lobe}" if side and lobe and f"location.{side}.{lobe}" in c.terms else (f"location.{side}.lung" if side else "location.unknown")
    attenuation = finding.get("attenuation") or "unknown"
    win = first_window(rec["options"])
    questions = [r.engine_string(q) for q in rec["questions_for_doctor"]]
    reasons = [r.engine_string(x) for x in rec["not_applicable_reasons"]]
    values = {
        "size_mm": str(rec["size_mm"]) if rec["size_mm"] is not None else "",
        "location": r.term(loc_key),
        "type": r.term(f"type.{attenuation}"),
        "type_short": r.term(f"type_short.{attenuation}"),
        "side": r.term(f"location.{side}.lung") if side else "",
        "lobe": lobe or "",
        "questions": " ".join(questions),
        "reasons": " ".join(reasons),
        "action_list": r.action_list(rec["options"]) if rec["options"] else "",
    }
    if win:
        values["window_start"] = r.date(win["window_start"])
        values["window_end"] = r.date(win["window_end"])

    def render(tid: str, field_name: str) -> str:
        raw = c.templates[locale][tid][field_name]
        if not raw:
            return ""
        if ("{window_start}" in raw or "{window_end}" in raw) and not win:
            return r.term("phrase.no_date")  # e.g. a low-risk row with no follow-up scan has no date
        return r.fill(raw, values)

    reviewers: set[str] = set()
    for tid in ids:
        review = c.templates[locale][tid]["review"]
        r.used.add(f"template:{locale}:{tid}", review["status"])
        if review["status"] == "reviewed" and review.get("reviewer"):
            reviewers.add(review["reviewer"])

    notes = [r.engine_string(n) for n in rec["notes"] if n in c.engine]
    unknown_notes = [n for n in rec["notes"] if n not in c.engine]
    if unknown_notes:
        raise ContentError(f"engine notes not in engine-strings.json: {unknown_notes}")

    primary = ids[0]
    sections: list[dict[str, Any]] = []
    for key in SECTIONS:
        parts = [render(primary, key)]
        if key == "found" and "NO_MATCH" in ids and primary != "NO_MATCH":
            parts.append(render("NO_MATCH", "found"))
        if key == "todo" and primary != "CONDITIONAL" and "CONDITIONAL" in ids:
            parts.append(render("CONDITIONAL", "todo"))
        if key == "todo":
            parts.extend(notes)
        text = " ".join(p for p in parts if p).strip()
        if not text:
            continue
        before = len(r.sources)
        sections.append({"key": key, "heading": c.headings[locale][key], "text": western_digits(text) if locale == "ar" else text})
        if key in ("reassure", "why") and len(r.sources) > before:
            sections[-1]["sources"] = r.sources[before:]
    # sources used by a section but already listed earlier must still be attached to that section
    for section in sections:
        if section["key"] in ("reassure", "why") and "sources" not in section:
            used = [s for s in r.sources if f"\u201c{(c.pdq[s['id']]['text'] if locale == 'en' else c.pdq[s['id']]['ar']['text'])}\u201d" in section["text"]]
            if used:
                section["sources"] = used

    voice_parts = [render(tid, "voice_append" if tid != primary and c.templates[locale][tid].get("voice_append") else "voice") for tid in ids]
    voice = western_digits(" ".join(p for p in voice_parts if p)) if locale == "ar" else " ".join(p for p in voice_parts if p)
    statuses = r.used.items
    drafts = sorted(k for k, v in statuses.items() if v != "reviewed")
    return {
        "locale": locale,
        "sections": sections,
        "voice_text": voice,
        "template_ids": ids,
        "questions": questions,
        # pieces reused by the booking request: the options in words, the due window as written dates, the place
        "action_text": values["action_list"],
        "window": {"start": values["window_start"], "end": values["window_end"], "same_day": win["window_start"] == win["window_end"]} if win else None,
        "location_text": values["location"],
        "type_text": values["type"],
        "source_label": r.term("ui.source"),
        "review_status": {
            "status": "reviewed" if not drafts else "draft",
            "draft_items": drafts,
            "used": statuses,
            "reviewers": sorted(reviewers),
        },
    }


def banned_hits(text: str, content: Content | None = None) -> list[str]:
    """Words or symbols from banned-words.json that appear in a patient-facing text (case-insensitive)."""
    c = content or load_content()
    lowered = text.lower()
    hits = [w for w in c.banned["en"] + c.banned["ar"] if w.lower() in lowered]
    if c.banned.get("emoji") and re.search(r"[\U0001F300-\U0001FAFF☀-➿]", text):
        hits.append("emoji")
    return hits
