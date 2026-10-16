"""Fleischner Society 2017 guideline for incidental pulmonary nodules, as data plus a small matcher.

MacMahon H, Naidich DP, Goo JM, et al. Guidelines for Management of Incidental Pulmonary Nodules
Detected on CT Images: From the Fleischner Society 2017. Radiology 2017;284(1):228-243.

Pure and deterministic: no network, no model, no clock (dates come in through the context).
The rules are encoded, not copied from the paper. TODO-VERIFY: a clinician must check every row
against Table 1 of the paper and tick docs/build/fleischner-checklist.md before the demo video.
"""

from __future__ import annotations

from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from .dates import attach_dates

ENGINE_VERSION = "fleischner2017-1.0.0"
CITATION = {
    "text": (
        "MacMahon H, Naidich DP, Goo JM, et al. Guidelines for Management of Incidental Pulmonary "
        "Nodules Detected on CT Images: From the Fleischner Society 2017. "
        "Radiology 2017;284(1):228-243."
    ),
    # TODO-VERIFY: DOI written from memory; confirm it resolves to the paper before the demo.
    "url": "https://doi.org/10.1148/radiol.2017161659",
}
MIN_AGE = 35
SOLID_COMPONENT_CONCERN_MM = 6

LABEL_LOW = "If your doctor considers your risk low"
LABEL_HIGH = "If your doctor considers your risk higher"


def action(kind, window=None, *, optional=False, condition=None, repeat=None, until=None, then=()):
    return {
        "type": kind,
        "window_months": list(window) if window else None,
        "optional": optional,
        "condition": condition,
        "repeat_every_months": repeat,
        "until_months": until,
        "window_start": None,
        "window_end": None,
        "then": list(then),
    }


def option(headline, actions, mode="sequence"):
    return {"headline": headline, "mode": mode, "actions": actions}


NO_FOLLOW_UP = option("No routine follow-up scan is suggested by this guideline.", [action("NONE")])
OPTIONAL_12 = option("A CT scan at about 12 months is optional.", [action("CT", (12, 12), optional=True)])
THEN_18_24_OPTIONAL = action("CT", (18, 24), optional=True)
THEN_18_24 = action("CT", (18, 24))

# Each rule: id, family, count, size bounds in whole mm (inclusive, None = open), low-risk option and
# high-risk option (None = same as low). Tables 1 and 2 of the paper, as transcribed in the phase file.
RULES: list[dict[str, Any]] = [
    # --- solid, single ---
    {"id": "FL17-S1-LT6", "family": "solid", "count": "single", "size": (None, 5), "low": NO_FOLLOW_UP, "high": OPTIONAL_12},
    {
        "id": "FL17-S1-6TO8", "family": "solid", "count": "single", "size": (6, 8),
        "low": option(
            "Consider a CT in 6 to 12 months, then possibly another in 18 to 24 months.",
            [action("CT", (6, 12), then=[THEN_18_24_OPTIONAL])],
        ),
        "high": option(
            "A CT in 6 to 12 months, then another in 18 to 24 months.",
            [action("CT", (6, 12), then=[THEN_18_24])],
        ),
    },
    {
        "id": "FL17-S1-GT8", "family": "solid", "count": "single", "size": (9, None),
        "low": option(
            "Consider a CT in about 3 months, a PET-CT, or a biopsy.",
            [
                action("CT", (3, 3), optional=True),
                action("PET_CT", None, optional=True),
                action("TISSUE_SAMPLING", None, optional=True),
            ],
            mode="any_of",
        ),
        "high": None,
    },
    # --- solid, multiple ---
    {"id": "FL17-SM-LT6", "family": "solid", "count": "multiple", "size": (None, 5), "low": NO_FOLLOW_UP, "high": OPTIONAL_12},
    {
        "id": "FL17-SM-6TO8", "family": "solid", "count": "multiple", "size": (6, 8),
        "low": option(
            "A CT in 3 to 6 months, then consider another in 18 to 24 months.",
            [action("CT", (3, 6), then=[THEN_18_24_OPTIONAL])],
        ),
        "high": option(
            "A CT in 3 to 6 months, then another in 18 to 24 months.",
            [action("CT", (3, 6), then=[THEN_18_24])],
        ),
    },
    {
        "id": "FL17-SM-GT8", "family": "solid", "count": "multiple", "size": (9, None),
        "low": option(
            "A CT in 3 to 6 months, then consider another in 18 to 24 months.",
            [action("CT", (3, 6), then=[THEN_18_24_OPTIONAL])],
        ),
        "high": None,
    },
    # --- subsolid ---
    {"id": "FL17-GGN1-LT6", "family": "ground_glass", "count": "single", "size": (None, 5), "low": NO_FOLLOW_UP, "high": None},
    {
        "id": "FL17-GGN1-GE6", "family": "ground_glass", "count": "single", "size": (6, None),
        "low": option(
            "A CT in 6 to 12 months to check the area is still there, then a CT every 2 years until 5 years.",
            [action("CT", (6, 12), then=[action("CT", (24, 24), repeat=24, until=60, condition="if the area is still there")])],
        ),
        "high": None,
    },
    {"id": "FL17-PS1-LT6", "family": "part_solid", "count": "single", "size": (None, 5), "low": NO_FOLLOW_UP, "high": None},
    {
        "id": "FL17-PS1-GE6", "family": "part_solid", "count": "single", "size": (6, None),
        "low": option(
            "A CT in 3 to 6 months to check the area is still there. If it is unchanged and the solid part "
            "stays under 6 mm, a CT every year for 5 years.",
            [
                action(
                    "CT", (3, 6),
                    then=[action("CT", (12, 12), repeat=12, until=60, condition="if unchanged and the solid part stays under 6 mm")],
                )
            ],
        ),
        "high": None,
    },
    {
        "id": "FL17-SSM-LT6", "family": "subsolid_multiple", "count": "multiple", "size": (None, 5),
        "low": option(
            "A CT in 3 to 6 months. If stable, consider a CT at 2 and 4 years.",
            [
                action(
                    "CT", (3, 6),
                    then=[
                        action("CT", (24, 24), optional=True, condition="if stable"),
                        action("CT", (48, 48), optional=True, condition="if stable"),
                    ],
                )
            ],
        ),
        "high": None,
    },
    {
        "id": "FL17-SSM-GE6", "family": "subsolid_multiple", "count": "multiple", "size": (6, None),
        "low": option(
            "A CT in 3 to 6 months. Next steps depend on the most suspicious nodule.",
            [action("CT", (3, 6))],
        ),
        "high": None,
    },
]

TYPE_RANK = {"solid": 0, "ground_glass": 1, "part_solid": 2}  # at equal size, more suspicious wins
TYPE_LABEL = {"solid": "solid", "ground_glass": "ground-glass", "part_solid": "part-solid"}


def round_half_up(x: float | str) -> int:
    return int(Decimal(str(x)).quantize(Decimal(1), rounding=ROUND_HALF_UP))


def find_rule(family: str, count: str, size_mm: int) -> dict[str, Any] | None:
    """Match one row of the table. `family` is solid, ground_glass or part_solid."""
    for rule in RULES:
        lo, hi = rule["size"]
        if lo is not None and size_mm < lo:
            continue
        if hi is not None and size_mm > hi:
            continue
        if rule["count"] != count:
            continue
        if family == "solid":
            if rule["family"] == "solid":
                return rule
        elif count == "single" and rule["family"] == family or count == "multiple" and rule["family"] == "subsolid_multiple":
            return rule
    return None


def size_band(rule: dict[str, Any]) -> str:
    return rule["id"].rsplit("-", 1)[1].lower()


# ----- gates -----


def _gates(ctx: dict[str, Any]) -> tuple[list[str], list[str]]:
    """(reasons the guideline does not apply, questions for facts that are unknown)."""
    excluded: list[str] = []
    unknown: list[str] = []

    age, over35 = ctx.get("age_years"), ctx.get("age_at_least_35")
    if (age is not None and age < MIN_AGE) or over35 is False:
        excluded.append("The guideline is for adults aged 35 or older.")
    elif age is None and over35 is None:
        unknown.append("Are you 35 years or older?")

    for key, reason, question in (
        ("known_cancer", "The guideline does not cover people with a known cancer.", "Do you have a known cancer?"),
        ("immunocompromised", "The guideline does not cover people whose immune system is weakened.", "Is your immune system weakened?"),
        (
            "is_screening_exam", "The guideline does not cover lung cancer screening scans. A different guideline applies.",
            "Was this scan done for lung cancer screening?",
        ),
    ):
        value = ctx.get(key)
        if value is True:
            excluded.append(reason)
        elif value is None:
            unknown.append(question)
    return excluded, unknown


def _is_benign(n: dict[str, Any]) -> bool:
    return bool(n.get("benign_features")) or n.get("attenuation") == "calcified"


def _factors(driver: dict[str, Any], ctx: dict[str, Any]) -> list[str]:
    factors = []
    if "spiculated" in (driver.get("morphology") or []):
        factors.append("A spiculated edge (stated in the report)")
    if driver.get("lobe") == "upper":
        factors.append("Upper lobe location (stated in the report)")
    if ctx.get("smoking_history") in {"former", "current"}:
        factors.append(f"{ctx['smoking_history'].capitalize()} smoking (stated in the report)")
    return factors


def _why(driver: dict[str, Any], rule: dict[str, Any], count: str, size: int, family_known: bool) -> str:
    dims = driver.get("dimensions_mm") or []
    if len(dims) >= 2:
        basis = "mean of " + " × ".join(f"{d:g}" for d in dims)
    else:
        basis = "the report gives one dimension"
    if family_known:
        first = f"{count.capitalize()} {TYPE_LABEL[driver['attenuation']]} nodule"
    else:
        first = f"{count.capitalize()} nodule (type not stated, solid table used)"
    return f"{first}, {size} mm ({basis}), Fleischner 2017, rule {rule['id']}."


def _empty(**kw: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "applies": False, "not_applicable_reasons": [], "questions_for_doctor": [], "rule_id": None,
        "driving_nodule_id": None, "nodule_type": None, "count": None, "size_mm": None, "size_band": None,
        "risk_tier_used": "unknown", "headline": None, "why": None, "options": [], "notes": [],
        "factors_to_consider": [], "citation": dict(CITATION), "engine_version": ENGINE_VERSION,
    }  # fmt: skip
    base.update(kw)
    return base


def _finish(result: dict[str, Any], study_date: date | None, analysis_date: date) -> dict[str, Any]:
    index = study_date or analysis_date
    result["index_date"] = index.isoformat()
    result["date_basis"] = "study_date" if study_date else "analysis_date"
    result["options"] = attach_dates(result["options"], index)
    return result


def recommend(findings: list[dict[str, Any]], context: dict[str, Any] | None = None) -> dict[str, Any]:
    """Findings (Phase 4 nodules, verified) + context -> follow-up recommendation.

    context keys, all optional: age_years, age_at_least_35, known_cancer, immunocompromised,
    is_screening_exam, smoking_history, risk_tier (low|high|unknown), study_date, analysis_date.
    """
    ctx = context or {}
    study_date: date | None = ctx.get("study_date")
    analysis_date: date = ctx.get("analysis_date") or date.today()
    risk = ctx.get("risk_tier") or "unknown"

    def done(**kw: Any) -> dict[str, Any]:
        return _finish(_empty(risk_tier_used=risk, **kw), study_date, analysis_date)

    candidates = [n for n in findings if n.get("assertion") in {"present", "hedged"}]
    if not candidates:
        return done(not_applicable_reasons=["The report does not describe a pulmonary nodule."])

    excluded, unknown = _gates(ctx)
    present = [n for n in candidates if n["assertion"] == "present"]

    if not present:  # only hedged mentions: "possible nodule"
        return done(
            applies=False if excluded else "conditional",
            not_applicable_reasons=["The report is not certain that this is a nodule (a possible nodule).", *excluded],
            questions_for_doctor=["Ask your doctor whether this finding needs follow-up.", *unknown],
            driving_nodule_id=candidates[0].get("id"),
        )

    non_benign = [n for n in present if not _is_benign(n)]
    if not non_benign:
        return done(
            applies=False,
            not_applicable_reasons=[
                "The report describes features usually seen in benign nodules. Confirm with your doctor whether follow-up is needed.",
                *excluded,
            ],
            driving_nodule_id=present[0].get("id"),
        )

    sized = [n for n in non_benign if n.get("mean_diameter_mm") is not None]
    pool = sized or non_benign
    driver = max(pool, key=lambda n: (round_half_up(n["mean_diameter_mm"]) if n.get("mean_diameter_mm") is not None else -1, TYPE_RANK.get(n.get("attenuation"), 0)))
    base = {"driving_nodule_id": driver.get("id")}

    if excluded:
        return done(applies=False, not_applicable_reasons=excluded, **base)
    if driver.get("stability_text"):
        reason = "The report compares with an earlier scan. Ask your doctor whether more scans are needed."
        return done(applies="conditional", not_applicable_reasons=[reason], questions_for_doctor=[reason, *unknown], **base)
    if driver.get("mean_diameter_mm") is None:
        return done(
            applies="conditional",
            not_applicable_reasons=["The report does not give a size for the nodule."],
            questions_for_doctor=["Ask your doctor for the size of the nodule.", *unknown],
            **base,
        )

    size = round_half_up(driver["mean_diameter_mm"])
    attenuation = driver.get("attenuation") or "unknown"
    family_known = attenuation in TYPE_RANK
    family = attenuation if family_known else "solid"
    count_ctx = driver.get("count_context")
    count = "multiple" if (count_ctx == "multiple" or len(present) > 1) else "single"
    rule = find_rule(family, count, size)
    if rule is None:  # pragma: no cover - the table covers every size, type and count
        raise ValueError(f"no rule for {family} {count} {size} mm")

    notes: list[str] = []
    conditional = bool(unknown)
    if not family_known:
        conditional = True
        notes.append("The report does not say whether the nodule is solid.")
    if count_ctx == "unclear" and len(present) == 1:
        conditional = True
        notes.append("The report does not say whether there are other nodules.")
        unknown = [*unknown, "Ask your doctor whether the scan shows other nodules."]
    if len(present) > 1:
        notes.append("The report describes more than one nodule. The guideline row was chosen by the largest one.")
    if family == "part_solid":
        solid = driver.get("solid_component_mm")
        if solid is not None and solid >= SOLID_COMPONENT_CONCERN_MM:
            # TODO-VERIFY: exact wording against the paper's remarks.
            notes.append("Solid component of 6 mm or more is a concerning feature; discuss promptly with your doctor.")

    low, high = rule["low"], rule["high"]
    if risk == "low":
        options = [{**low, "label": None}]
    elif risk == "high":
        options = [{**(high or low), "label": None}]
    elif high is None:
        options = [{**low, "label": None}]
    else:
        options = [{**low, "label": LABEL_LOW}, {**high, "label": LABEL_HIGH}]

    return _finish(
        _empty(
            applies="conditional" if conditional else True,
            questions_for_doctor=unknown,
            rule_id=rule["id"],
            driving_nodule_id=driver.get("id"),
            nodule_type=family,
            count=count,
            size_mm=size,
            size_band=size_band(rule),
            risk_tier_used=risk,
            headline=options[0]["headline"],
            why=_why(driver, rule, count, size, family_known),
            options=options,
            notes=notes,
            factors_to_consider=_factors(driver, ctx),
        ),
        study_date,
        analysis_date,
    )
