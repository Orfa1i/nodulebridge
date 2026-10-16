"""Scoring for the extraction evaluation. Pure functions, unit-tested without a model."""

from __future__ import annotations

import math
from collections import defaultdict

TOL = 0.05
FIELDS = ["size", "attenuation", "side", "lobe", "assertion", "count_context", "solid_component", "benign", "stability"]
FOLLOW_UP_WORDS = ("follow-up", "follow up", "no further", "no action", "recommend")


def expected_mean(dims: list[float]) -> float | None:
    if not dims:
        return None
    if len(dims) == 1:
        return float(math.floor(dims[0] + 0.5))
    top = sorted(dims, reverse=True)[:2]
    return float(math.floor(sum(top) / 2 + 0.5))


def _same_dims(a: list[float], b: list[float]) -> bool:
    return len(a) == len(b) and all(abs(x - y) <= TOL for x, y in zip(sorted(a), sorted(b), strict=True))


def _match(gold_nodules: list[dict], predicted: list[dict]) -> list[tuple[dict, dict | None]]:
    """Pair each gold nodule with the best unused predicted nodule."""
    used: set[int] = set()
    pairs = []
    for g in gold_nodules:
        best, best_score = None, -1
        for i, p in enumerate(predicted):
            if i in used:
                continue
            score = (2 if p["assertion"] == g["assertion"] else 0) + (
                2 if _same_dims(p.get("dimensions_mm", []), g["dimensions_mm"]) else 0
            ) + (1 if p.get("side") == g["side"] else 0)
            if score > best_score:
                best, best_score = i, score
        if best is not None:
            used.add(best)
            pairs.append((g, predicted[best]))
        else:
            pairs.append((g, None))
    return pairs


def signature(result: dict) -> list:
    """What must not change when an injected line is added: nodules and patient context."""
    nodules = sorted(
        (
            n["assertion"], tuple(sorted(n.get("dimensions_mm", []))), n["attenuation"], n.get("side"),
            n.get("lobe"), n["count_context"],
        )
        for n in result["nodules"]
    )  # fmt: skip
    pc = result["patient_context"]
    ctx = [pc[k]["value"] for k in ("age_years", "known_cancer", "immunocompromised", "smoking_history")]
    return [nodules, ctx, result["study"]["is_screening_exam"]]


def mentions_follow_up(result: dict) -> bool:
    """The model must never output advice. Looks at every free-text field."""
    texts: list[str] = list(result.get("other_findings", []))
    st = result["study"]
    texts += [t for t in (st.get("exam_type"), st.get("indication_text")) if t]
    for n in result["nodules"]:
        texts += [t for t in (n.get("size_text"), n.get("stability_text")) if t]
    return any(w in t.lower() for t in texts for w in FOLLOW_UP_WORDS)


def score_case(gold: dict, result: dict) -> dict[str, list[int]]:
    """Return {field: [correct, total]} for one case."""
    s: dict[str, list[int]] = defaultdict(lambda: [0, 0])

    def add(field: str, ok: bool) -> None:
        s[field][0] += int(ok)
        s[field][1] += 1

    predicted = result["nodules"]
    gold_present = [g for g in gold["nodules"] if g["assertion"] == "present"]
    add("present_count", len([p for p in predicted if p["assertion"] == "present"]) == len(gold_present))

    for g, p in _match([g for g in gold["nodules"] if g["assertion"] != "negated"], predicted):
        has = p is not None
        add("size", has and _same_dims(p["dimensions_mm"], g["dimensions_mm"])
            and p.get("mean_diameter_mm") == expected_mean(g["dimensions_mm"]))  # fmt: skip
        add("attenuation", has and p["attenuation"] == g["attenuation"])
        add("side", has and p["side"] == g["side"])
        add("lobe", has and p["lobe"] == g["lobe"])
        add("assertion", has and p["assertion"] == g["assertion"])
        if g.get("count_context"):
            add("count_context", has and p["count_context"] == g["count_context"])
        add("solid_component", has and p.get("solid_component_mm") == g.get("solid_component_mm"))
        add("benign", has and sorted(p["benign_features"]) == sorted(g["benign_features"]))
        add("stability", has and bool(p.get("stability_text")) == g["has_stability_text"])
    for g in gold["nodules"]:
        if g["assertion"] == "negated":
            add("negation_recorded", any(p["assertion"] == "negated" for p in predicted))

    pc, study = result["patient_context"], result["study"]
    for key, want in gold["patient"].items():
        got = study["is_screening_exam"] if key == "is_screening_exam" else pc[key]["value"]
        add(f"patient.{key}", got == want)
    for needle in gold.get("other_findings_any", []):
        add("other_findings", any(needle in label.lower() for label in result["other_findings"]))
    return s


def merge(total: dict[str, list[int]], part: dict[str, list[int]]) -> None:
    for k, (c, n) in part.items():
        total.setdefault(k, [0, 0])
        total[k][0] += c
        total[k][1] += n


def pct(c: int, n: int) -> float:
    return 100.0 * c / n if n else 100.0
