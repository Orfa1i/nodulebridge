"""Deterministic verification of an LLM extraction. Runs on every result.

Confidence comes only from here, never from the model:
- every evidence quote must appear verbatim in the sentence with that id, otherwise it is dropped;
- every number in dimensions_mm must appear in an evidence quote, otherwise it is dropped;
- a nodule with no surviving evidence is removed;
- an independent regex pass over the evidence sentences re-reads size, side and lobe, and the
  nodule is "checked" only when it agrees with the model.
"""

from __future__ import annotations

import copy
import math
import re
from dataclasses import dataclass, field

from .report_text import Sentence

SIZE_NOTE_SINGLE = "Report gives one dimension; Fleischner uses the mean of long and short axis."
NUMBER = r"\d+(?:\.\d+)?"
# two or more axes "9 x 7 mm", "9 × 7 × 5 mm", "1.2 x 0.8 cm", or a single size "9 mm"
MULTI_AXIS = re.compile(rf"({NUMBER}(?:\s*[x×]\s*{NUMBER})+)\s*(mm|cm)\b", re.IGNORECASE)
SINGLE = re.compile(rf"(?<![\d.x×])({NUMBER})\s*(mm|cm)\b", re.IGNORECASE)
SIDE_WORDS = {"right": "right", "left": "left"}
LOBE_PATTERNS = [
    ("upper", re.compile(r"\bupper\s+lobe\b", re.IGNORECASE)),
    ("middle", re.compile(r"\bmiddle\s+lobe\b", re.IGNORECASE)),
    ("lower", re.compile(r"\blower\s+lobe\b", re.IGNORECASE)),
    ("lingula", re.compile(r"\blingula(?:r)?\b", re.IGNORECASE)),
]


@dataclass
class Verification:
    issues: list[str] = field(default_factory=list)
    quotes_checked: int = 0
    quotes_dropped: int = 0
    nodules_removed: int = 0

    def as_dict(self) -> dict:
        return {
            "issues": self.issues,
            "quotes_checked": self.quotes_checked,
            "quotes_dropped": self.quotes_dropped,
            "nodules_removed": self.nodules_removed,
        }


def round_half_up(x: float) -> int:
    return math.floor(x + 0.5)


def numbers_in(text: str) -> list[float]:
    return [float(m) for m in re.findall(NUMBER, text)]


def regex_sizes_mm(text: str) -> list[list[float]]:
    """Every size group in the text, in mm. One group = one stated size (one or more axes)."""
    groups: list[list[float]] = []
    consumed: list[tuple[int, int]] = []
    for m in MULTI_AXIS.finditer(text):
        factor = 10.0 if m.group(2).lower() == "cm" else 1.0
        groups.append([round(float(v) * factor, 2) for v in re.findall(NUMBER, m.group(1))])
        consumed.append(m.span())
    for m in SINGLE.finditer(text):
        if any(a <= m.start() < b for a, b in consumed):
            continue
        factor = 10.0 if m.group(2).lower() == "cm" else 1.0
        groups.append([round(float(m.group(1)) * factor, 2)])
    return groups


def regex_side(text: str) -> set[str]:
    return {SIDE_WORDS[w.lower()] for w in re.findall(r"\b(right|left)\b", text, re.IGNORECASE)}


def regex_lobes(text: str) -> set[str]:
    return {name for name, pat in LOBE_PATTERNS if pat.search(text)}


def _close(a: float, b: float) -> bool:
    return abs(a - b) < 0.051


def _mean_diameter(dimensions: list[float]) -> tuple[float | None, str | None, str]:
    """(mean diameter in mm, note, size_basis)."""
    if not dimensions:
        return None, None, "unspecified"
    if len(dimensions) == 1:
        return float(round_half_up(dimensions[0])), SIZE_NOTE_SINGLE, "stated_single"
    two = sorted(dimensions, reverse=True)[:2]  # long and short axis if a third is given
    return float(round_half_up(sum(two) / 2)), None, "two_axes"


def verify(result: dict, sentences: list[Sentence]) -> tuple[dict, Verification]:
    """Return (verified copy of result, verification summary). The input is not modified."""
    out = copy.deepcopy(result)
    by_id = {s.id: s.text for s in sentences}
    ver = Verification()
    kept: list[dict] = []

    for nodule in out.get("nodules", []):
        nid = nodule.get("id", "?")
        nodule_issues: list[str] = []
        reasons: list[str] = []

        # 1. quotes must be verbatim in their sentence
        surviving = []
        for ev in nodule.get("evidence", []):
            ver.quotes_checked += 1
            sentence = by_id.get(ev.get("sentence_id", ""))
            quote = ev.get("quote", "")
            if sentence is not None and quote and quote in sentence:
                surviving.append({"sentence_id": ev["sentence_id"], "quote": quote})
            else:
                ver.quotes_dropped += 1
                nodule_issues.append("quote_not_found")
                ver.issues.append(f"quote_not_found: {nid} {ev.get('sentence_id')!r}")
        nodule["evidence"] = surviving

        # 2. a nodule without evidence is removed
        if not surviving:
            ver.nodules_removed += 1
            ver.issues.append(f"nodule_removed_no_evidence: {nid}")
            continue

        # 3. every dimension must appear in an evidence quote
        quote_numbers = [v for ev in surviving for v in numbers_in(ev["quote"])]
        cm_numbers = [round(v * 10, 2) for v in quote_numbers]
        supported = []
        for d in nodule.get("dimensions_mm", []):
            if any(_close(d, q) for q in quote_numbers + cm_numbers):
                supported.append(d)
            else:
                nodule_issues.append("dimension_not_in_quote")
                ver.issues.append(f"dimension_not_in_quote: {nid} {d}")
        nodule["dimensions_mm"] = supported

        # 4. independent regex cross-check on the evidence sentences
        text = " ".join(by_id[ev["sentence_id"]] for ev in surviving)
        groups = regex_sizes_mm(text)
        flat = sorted({v for g in groups for v in g})
        llm_dims = sorted(set(nodule["dimensions_mm"]))
        if llm_dims:
            if not groups:
                reasons.append("size_not_found_by_regex")
            elif not all(any(_close(d, r) for r in flat) for d in llm_dims):
                reasons.append(f"size_mismatch: model {llm_dims}, text {flat}")
            elif len(groups) > 1 and nodule.get("assertion") == "present":
                multi_distinct = {tuple(g) for g in groups}
                if len(multi_distinct) > 1 and not any(sorted(g) == llm_dims for g in groups):
                    reasons.append("several_sizes_in_evidence")
        elif groups and nodule.get("assertion") != "negated":
            reasons.append(f"size_in_text_not_extracted: {flat}")

        sides = regex_side(text)
        side = nodule.get("side")
        if side and side not in sides:
            reasons.append(f"side_not_in_text: model {side}")
        elif not side and len(sides) == 1:
            reasons.append(f"side_in_text_not_extracted: {min(sides)}")
        elif len(sides) > 1:
            reasons.append("both_sides_in_evidence")

        lobes = regex_lobes(text)
        lobe = nodule.get("lobe")
        if lobe and lobe not in lobes:
            reasons.append(f"lobe_not_in_text: model {lobe}")
        elif not lobe and len(lobes) == 1:
            reasons.append(f"lobe_in_text_not_extracted: {min(lobes)}")
        elif len(lobes) > 1:
            reasons.append("several_lobes_in_evidence")

        # 5. computed fields
        mean, note, basis = _mean_diameter(nodule["dimensions_mm"])
        nodule["mean_diameter_mm"] = mean
        nodule["size_note"] = note
        nodule["size_basis"] = basis
        nodule["issues"] = sorted(set(nodule_issues))
        nodule["confidence_reasons"] = reasons
        nodule["confidence"] = "needs_review" if (reasons or nodule_issues) else "checked"
        kept.append(nodule)

    out["nodules"] = kept
    if len({n["id"] for n in kept}) != len(kept):
        ver.issues.append("duplicate_nodule_ids")
        for i, n in enumerate(kept, start=1):
            n["id"] = f"n{i}"
    return out, ver
