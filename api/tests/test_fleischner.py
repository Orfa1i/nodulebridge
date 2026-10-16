"""Fleischner 2017 engine tests. Expected values are an independent transcription of the phase 5
table; if a rule in app/rules/fleischner2017.py is mistyped, these tests fail."""

import copy
import json
from datetime import date
from pathlib import Path

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st
from jsonschema import Draft202012Validator

from app.rules.dates import attach_dates
from app.rules.fleischner2017 import RULES, find_rule, recommend, round_half_up

ROOT = Path(__file__).resolve().parents[2]
SCHEMA = json.loads((ROOT / "shared" / "schemas" / "followup-recommendation.schema.json").read_text(encoding="utf-8"))
VALIDATOR = Draft202012Validator(SCHEMA)
TODAY = date(2026, 10, 16)
OK = {"age_years": 58, "known_cancer": False, "immunocompromised": False, "is_screening_exam": False, "analysis_date": TODAY}


def nodule(**kw):
    base = {
        "id": "n1", "count_context": "single", "size_text": None, "dimensions_mm": [], "size_basis": "stated_single",
        "attenuation": "solid", "solid_component_mm": None, "side": "right", "lobe": "upper", "morphology": [],
        "benign_features": [], "stability_text": None, "assertion": "present", "evidence": [],
        "mean_diameter_mm": 9.0,
    }  # fmt: skip
    return base | kw


def run(*nodules, **ctx):
    result = recommend(list(nodules), OK | ctx)
    assert list(VALIDATOR.iter_errors(result)) == []
    return result


def sig(actions):
    """Comparable form of an action list, dates removed."""
    return [
        (a["type"], tuple(a["window_months"]) if a["window_months"] else None, a["optional"], a["condition"],
         a["repeat_every_months"], a["until_months"], sig(a["then"]))
        for a in actions
    ]  # fmt: skip


def A(kind, window=None, optional=False, condition=None, repeat=None, until=None, then=()):
    return (kind, window, optional, condition, repeat, until, list(then))


NONE = [A("NONE")]
OPT12 = [A("CT", (12, 12), optional=True)]

# rule id -> (family, count, mm inside the band, low-risk actions, high-risk actions or None for "same")
EXPECTED = {
    "FL17-S1-LT6": ("solid", "single", 5, NONE, OPT12),
    "FL17-S1-6TO8": ("solid", "single", 7, [A("CT", (6, 12), then=[A("CT", (18, 24), optional=True)])], [A("CT", (6, 12), then=[A("CT", (18, 24))])]),
    "FL17-S1-GT8": ("solid", "single", 9, [A("CT", (3, 3), optional=True), A("PET_CT", optional=True), A("TISSUE_SAMPLING", optional=True)], None),
    "FL17-SM-LT6": ("solid", "multiple", 5, NONE, OPT12),
    "FL17-SM-6TO8": ("solid", "multiple", 7, [A("CT", (3, 6), then=[A("CT", (18, 24), optional=True)])], [A("CT", (3, 6), then=[A("CT", (18, 24))])]),
    "FL17-SM-GT8": ("solid", "multiple", 12, [A("CT", (3, 6), then=[A("CT", (18, 24), optional=True)])], None),
    "FL17-GGN1-LT6": ("ground_glass", "single", 5, NONE, None),
    "FL17-GGN1-GE6": ("ground_glass", "single", 6, [A("CT", (6, 12), then=[A("CT", (24, 24), repeat=24, until=60, condition="if the area is still there")])], None),
    "FL17-PS1-LT6": ("part_solid", "single", 5, NONE, None),
    "FL17-PS1-GE6": ("part_solid", "single", 6, [A("CT", (3, 6), then=[A("CT", (12, 12), repeat=12, until=60, condition="if unchanged and the solid part stays under 6 mm")])], None),
    "FL17-SSM-LT6": ("part_solid", "multiple", 5, [A("CT", (3, 6), then=[A("CT", (24, 24), optional=True, condition="if stable"), A("CT", (48, 48), optional=True, condition="if stable")])], None),
    "FL17-SSM-GE6": ("part_solid", "multiple", 6, [A("CT", (3, 6))], None),
}  # fmt: skip


def finding_for(family, count, mm):
    return nodule(attenuation=family, count_context=count, mean_diameter_mm=float(mm), dimensions_mm=[mm])


def test_every_rule_in_the_table_has_an_expected_row():
    assert {r["id"] for r in RULES} == set(EXPECTED)


@pytest.mark.parametrize("rule_id", sorted(EXPECTED))
@pytest.mark.parametrize("tier", ["low", "high", "unknown"])
def test_each_rule_for_each_risk_tier(rule_id, tier):
    family, count, mm, low, high = EXPECTED[rule_id]
    r = run(finding_for(family, count, mm), risk_tier=tier)
    assert r["applies"] is True and r["rule_id"] == rule_id and r["count"] == count
    assert r["risk_tier_used"] == tier and r["citation"]["text"].startswith("MacMahon H")
    options = r["options"]
    if tier == "low" or (tier == "unknown" and high is None) or (tier == "high" and high is None):
        assert len(options) == 1 and options[0]["label"] is None
        assert sig(options[0]["actions"]) == low
    elif tier == "high":
        assert len(options) == 1 and options[0]["label"] is None
        assert sig(options[0]["actions"]) == high
    else:  # unknown tier, rows differ: both shown with labels
        assert [o["label"] for o in options] == ["If your doctor considers your risk low", "If your doctor considers your risk higher"]
        assert sig(options[0]["actions"]) == low and sig(options[1]["actions"]) == high
    assert r["headline"] == options[0]["headline"]


def test_gt8_solid_is_an_any_of_choice_and_other_rules_are_sequences():
    assert run(finding_for("solid", "single", 9))["options"][0]["mode"] == "any_of"
    assert run(finding_for("solid", "single", 7))["options"][0]["mode"] == "sequence"


# ----- size bands and rounding -----


@pytest.mark.parametrize(
    ("mm", "rule"),
    [(1, "FL17-S1-LT6"), (5, "FL17-S1-LT6"), (6, "FL17-S1-6TO8"), (8, "FL17-S1-6TO8"), (9, "FL17-S1-GT8"), (30, "FL17-S1-GT8")],
)
def test_solid_size_boundaries(mm, rule):
    assert run(finding_for("solid", "single", mm))["rule_id"] == rule


@pytest.mark.parametrize(
    ("mm", "rule"),
    [(5, "FL17-SM-LT6"), (6, "FL17-SM-6TO8"), (8, "FL17-SM-6TO8"), (9, "FL17-SM-GT8")],
)
def test_multiple_solid_boundaries(mm, rule):
    assert run(finding_for("solid", "multiple", mm))["rule_id"] == rule


@pytest.mark.parametrize(("family", "mm", "rule"), [
    ("ground_glass", 5, "FL17-GGN1-LT6"), ("ground_glass", 6, "FL17-GGN1-GE6"),
    ("part_solid", 5, "FL17-PS1-LT6"), ("part_solid", 6, "FL17-PS1-GE6"),
])  # fmt: skip
def test_subsolid_boundaries(family, mm, rule):
    assert run(finding_for(family, "single", mm))["rule_id"] == rule


@pytest.mark.parametrize(
    ("value", "expected", "rule"),
    [(5.4, 5, "FL17-S1-LT6"), (5.5, 6, "FL17-S1-6TO8"), (8.4, 8, "FL17-S1-6TO8"), (8.5, 9, "FL17-S1-GT8"), (6.5, 7, "FL17-S1-6TO8")],
)
def test_rounding_is_half_up_not_bankers(value, expected, rule):
    assert round_half_up(value) == expected
    r = run(nodule(mean_diameter_mm=value))
    assert r["size_mm"] == expected and r["rule_id"] == rule


def test_python_round_would_have_been_wrong_here():
    assert round(8.5) == 8 and round_half_up(8.5) == 9  # the reason round_half_up exists
    assert round(6.5) == 6 and round_half_up(6.5) == 7


def test_find_rule_returns_none_only_for_impossible_input():
    assert find_rule("solid", "single", 9)["id"] == "FL17-S1-GT8"
    assert find_rule("part_solid", "multiple", 7)["id"] == "FL17-SSM-GE6"
    assert find_rule("ground_glass", "multiple", 7)["id"] == "FL17-SSM-GE6"
    assert find_rule("solid", "single", 0)["id"] == "FL17-S1-LT6"
    assert find_rule("solid", "none", 7) is None and find_rule("part_solid", "none", 7) is None


# ----- gates -----


@pytest.mark.parametrize(("age", "applies"), [(34, False), (35, True), (36, True), (18, False)])
def test_age_gate(age, applies):
    r = run(nodule(), age_years=age)
    assert r["applies"] is applies
    if not applies:
        assert r["rule_id"] is None and r["headline"] is None and r["options"] == []
        assert "The guideline is for adults aged 35 or older." in r["not_applicable_reasons"]


def test_unknown_age_is_conditional_with_a_question():
    r = run(nodule(), age_years=None)
    assert r["applies"] == "conditional" and r["rule_id"] == "FL17-S1-GT8"
    assert "Are you 35 years or older?" in r["questions_for_doctor"]


def test_user_confirmed_age_flag():
    assert run(nodule(), age_years=None, age_at_least_35=True)["applies"] is True
    r = run(nodule(), age_years=None, age_at_least_35=False)
    assert r["applies"] is False
    assert run(nodule(), age_years=58, age_at_least_35=False)["applies"] is False  # either source can exclude


@pytest.mark.parametrize(
    ("key", "text"),
    [
        ("known_cancer", "known cancer"),
        ("immunocompromised", "immune system is weakened"),
        ("is_screening_exam", "lung cancer screening"),
    ],
)
def test_other_gates(key, text):
    r = run(nodule(), **{key: True})
    assert r["applies"] is False and any(text in x for x in r["not_applicable_reasons"])
    r = run(nodule(), **{key: None})
    assert r["applies"] == "conditional" and len(r["questions_for_doctor"]) == 1
    assert run(nodule(), **{key: False})["applies"] is True


def test_several_failed_gates_are_all_listed_and_beat_unknowns():
    r = run(nodule(), age_years=30, known_cancer=True, immunocompromised=True, is_screening_exam=True)
    assert r["applies"] is False and len(r["not_applicable_reasons"]) == 4
    r = run(nodule(), known_cancer=True, immunocompromised=None)
    assert r["applies"] is False and r["questions_for_doctor"] == []


# ----- cases the table does not cover -----


def test_no_nodules_or_only_negated():
    assert recommend([], OK)["applies"] is False
    r = run(nodule(assertion="negated", mean_diameter_mm=None))
    assert r["applies"] is False and "does not describe a pulmonary nodule" in r["not_applicable_reasons"][0]


@pytest.mark.parametrize("change", [{"benign_features": ["benign_calcification"]}, {"benign_features": ["fat"]}, {"attenuation": "calcified"}])
def test_benign_features_mean_not_applicable(change):
    r = run(nodule(**change))
    assert r["applies"] is False and r["rule_id"] is None
    assert r["not_applicable_reasons"][0].startswith("The report describes features usually seen in benign nodules.")


def test_benign_nodule_is_skipped_when_another_nodule_is_not_benign():
    benign = nodule(id="n1", attenuation="calcified", mean_diameter_mm=12.0)
    other = nodule(id="n2", mean_diameter_mm=7.0)
    r = run(benign, other)
    assert r["driving_nodule_id"] == "n2" and r["rule_id"] == "FL17-SM-6TO8"


def test_hedged_only_is_conditional_and_gives_no_interval():
    r = run(nodule(assertion="hedged", mean_diameter_mm=4.0))
    assert r["applies"] == "conditional" and r["rule_id"] is None and r["options"] == [] and r["headline"] is None
    assert "not certain" in r["not_applicable_reasons"][0]
    assert r["questions_for_doctor"][0] == "Ask your doctor whether this finding needs follow-up."
    r = run(nodule(assertion="hedged"), known_cancer=True)
    assert r["applies"] is False and len(r["not_applicable_reasons"]) == 2


def test_a_present_nodule_beats_a_hedged_one():
    r = run(nodule(id="n1", assertion="hedged", mean_diameter_mm=15.0), nodule(id="n2", mean_diameter_mm=7.0, count_context="single"))
    assert r["driving_nodule_id"] == "n2" and r["rule_id"] == "FL17-S1-6TO8"


def test_stability_statement_gives_no_new_interval():
    r = run(nodule(stability_text="stable since 2023"))
    assert r["applies"] == "conditional" and r["rule_id"] is None and r["options"] == []
    assert r["not_applicable_reasons"] == ["The report compares with an earlier scan. Ask your doctor whether more scans are needed."]


def test_missing_size_is_conditional():
    r = run(nodule(mean_diameter_mm=None))
    assert r["applies"] == "conditional" and r["rule_id"] is None
    assert "does not give a size" in r["not_applicable_reasons"][0]


def test_unknown_attenuation_uses_the_solid_table_conditionally():
    r = run(nodule(attenuation="unknown"))
    assert r["applies"] == "conditional" and r["rule_id"] == "FL17-S1-GT8"
    assert "The report does not say whether the nodule is solid." in r["notes"]
    assert "type not stated, solid table used" in r["why"]


def test_unclear_count_with_one_nodule_is_conditional():
    r = run(nodule(count_context="unclear"))
    assert r["applies"] == "conditional" and r["count"] == "single"
    assert "The report does not say whether there are other nodules." in r["notes"]


# ----- multiple nodules -----


def test_multiple_nodules_the_largest_drives_and_is_recorded():
    r = run(
        nodule(id="n1", mean_diameter_mm=4.0, count_context="multiple"),
        nodule(id="n2", mean_diameter_mm=12.0, count_context="multiple"),
        nodule(id="n3", mean_diameter_mm=3.0, count_context="multiple"),
    )
    assert r["driving_nodule_id"] == "n2" and r["rule_id"] == "FL17-SM-GT8" and r["count"] == "multiple"
    assert any("more than one nodule" in n for n in r["notes"])


@pytest.mark.parametrize(
    ("kinds", "winner"),
    [(("solid", "ground_glass", "part_solid"), "n3"), (("solid", "ground_glass"), "n2"), (("part_solid", "solid"), "n1")],
)
def test_equal_size_ties_go_to_the_more_suspicious_type(kinds, winner):
    findings = [nodule(id=f"n{i}", attenuation=k, mean_diameter_mm=8.0, count_context="multiple") for i, k in enumerate(kinds, start=1)]
    assert run(*findings)["driving_nodule_id"] == winner


def test_more_than_one_present_nodule_means_multiple_even_if_count_says_single():
    r = run(nodule(id="n1", count_context="single"), nodule(id="n2", count_context="single", mean_diameter_mm=7.0))
    assert r["count"] == "multiple"


def test_subsolid_multiple_uses_the_ssm_rows():
    r = run(nodule(id="n1", attenuation="ground_glass", mean_diameter_mm=7.0, count_context="multiple"))
    assert r["rule_id"] == "FL17-SSM-GE6"
    r = run(nodule(id="n1", attenuation="part_solid", mean_diameter_mm=4.0, count_context="multiple"))
    assert r["rule_id"] == "FL17-SSM-LT6"


def test_largest_is_chosen_among_sized_nodules():
    r = run(nodule(id="n1", mean_diameter_mm=None, count_context="multiple"), nodule(id="n2", mean_diameter_mm=7.0, count_context="multiple"))
    assert r["driving_nodule_id"] == "n2"


# ----- part-solid flag, factors, tiers -----


@pytest.mark.parametrize(("solid", "flagged"), [(6.0, True), (7.0, True), (5.9, False), (4.0, False), (None, False)])
def test_solid_component_flag(solid, flagged):
    r = run(finding_for("part_solid", "single", 14) | {"solid_component_mm": solid})
    has = "Solid component of 6 mm or more is a concerning feature; discuss promptly with your doctor." in r["notes"]
    assert has is flagged


def test_flag_is_only_for_part_solid():
    assert run(nodule(solid_component_mm=8.0))["notes"] == []


def test_stated_factors_are_listed_and_never_become_a_tier():
    r = run(nodule(morphology=["spiculated"], lobe="upper"), smoking_history="former")
    assert r["factors_to_consider"] == [
        "A spiculated edge (stated in the report)", "Upper lobe location (stated in the report)", "Former smoking (stated in the report)",
    ]  # fmt: skip
    assert r["risk_tier_used"] == "unknown"
    assert run(nodule(lobe="lower"), smoking_history="never")["factors_to_consider"] == []
    assert run(nodule(lobe=None), smoking_history="current")["factors_to_consider"] == ["Current smoking (stated in the report)"]


def test_why_names_the_finding_the_guideline_and_the_rule():
    r = run(nodule(dimensions_mm=[10, 8], mean_diameter_mm=9.0))
    assert r["why"] == "Single solid nodule, 9 mm (mean of 10 × 8), Fleischner 2017, rule FL17-S1-GT8."
    r = run(nodule(dimensions_mm=[9], mean_diameter_mm=9.0, attenuation="ground_glass"))
    assert r["why"] == "Single ground-glass nodule, 9 mm (the report gives one dimension), Fleischner 2017, rule FL17-GGN1-GE6."


# ----- dates -----


def test_dates_use_the_analysis_date_when_there_is_no_study_date():
    r = run(nodule())
    assert r["date_basis"] == "analysis_date" and r["index_date"] == "2026-10-16"
    ct = r["options"][0]["actions"][0]
    assert (ct["window_start"], ct["window_end"]) == ("2027-01-16", "2027-01-16")  # "CT window opens 16 Jan 2027"
    assert r["options"][0]["actions"][1]["window_start"] is None  # PET-CT has no window


def test_dates_use_the_study_date_when_given_and_cover_then_steps():
    r = run(nodule(mean_diameter_mm=7.0), study_date=date(2026, 8, 31))
    assert r["date_basis"] == "study_date" and r["index_date"] == "2026-08-31"
    first = r["options"][0]["actions"][0]
    assert (first["window_start"], first["window_end"]) == ("2027-02-28", "2027-08-31")  # month-end clamps
    then = first["then"][0]
    assert (then["window_start"], then["window_end"]) == ("2028-02-29", "2028-08-31")


def test_attach_dates_does_not_modify_its_input():
    options = recommend([nodule()], OK)["options"]
    before = copy.deepcopy(options)
    attach_dates(options, date(2030, 1, 1))
    assert options == before


# ----- determinism and properties -----


def test_same_input_same_output_and_input_is_not_modified():
    findings = [nodule(), nodule(id="n2", mean_diameter_mm=7.0)]
    snapshot = copy.deepcopy(findings)
    assert recommend(findings, OK) == recommend(findings, OK)
    assert findings == snapshot


def test_default_context_and_clock_still_validate():
    r = recommend([nodule()])
    assert list(VALIDATOR.iter_errors(r)) == [] and r["date_basis"] == "analysis_date"


nodule_strategy = st.builds(
    lambda i, a, size, count, assertion, benign, stable, dims, solid: nodule(
        id=f"n{i}", attenuation=a, mean_diameter_mm=size, count_context=count, assertion=assertion,
        benign_features=benign, stability_text=stable, dimensions_mm=dims, solid_component_mm=solid,
    ),
    st.integers(1, 4),
    st.sampled_from(["solid", "part_solid", "ground_glass", "calcified", "unknown"]),
    st.one_of(st.none(), st.floats(0.5, 60, allow_nan=False).map(lambda x: round(x, 1))),
    st.sampled_from(["single", "multiple", "unclear"]),
    st.sampled_from(["present", "negated", "hedged"]),
    st.sampled_from([[], ["fat"], ["benign_calcification"], ["perifissural"]]),
    st.sampled_from([None, "stable since 2023"]),
    st.lists(st.floats(1, 40, allow_nan=False).map(lambda x: round(x, 1)), max_size=3),
    st.one_of(st.none(), st.floats(0, 20, allow_nan=False).map(lambda x: round(x, 1))),
)
context_strategy = st.fixed_dictionaries(
    {
        "age_years": st.one_of(st.none(), st.integers(0, 100)),
        "age_at_least_35": st.sampled_from([None, True, False]),
        "known_cancer": st.sampled_from([None, True, False]),
        "immunocompromised": st.sampled_from([None, True, False]),
        "is_screening_exam": st.sampled_from([None, True, False]),
        "risk_tier": st.sampled_from(["low", "high", "unknown"]),
        "smoking_history": st.sampled_from([None, "never", "former", "current"]),
    }
)


@settings(max_examples=400, deadline=None)
@given(st.lists(nodule_strategy, max_size=5), context_strategy)
def test_property_always_a_citation_and_a_rule_or_a_reason(findings, ctx):
    r = recommend(findings, ctx | {"analysis_date": TODAY})
    assert r["citation"]["text"] and r["engine_version"]
    assert r["rule_id"] or r["not_applicable_reasons"]
    assert list(VALIDATOR.iter_errors(r)) == []
    if r["applies"] is False:
        assert r["options"] == [] and r["headline"] is None
    if r["rule_id"]:
        assert r["options"] and r["headline"] and r["why"] and r["size_mm"] is not None
        assert r["applies"] in (True, "conditional")


# ----- the three Phase 2 cases, through the real fixtures -----

FIXTURES = ROOT / "web" / "tests" / "e2e" / "fixtures"


def case_inputs(letter):
    body = json.loads((FIXTURES / f"extract-case-{letter}.json").read_text(encoding="utf-8"))
    r = body["result"]
    pc = r["patient_context"]
    ctx = {k: pc[k]["value"] for k in ("age_years", "known_cancer", "immunocompromised", "smoking_history")}
    ctx["is_screening_exam"] = r["study"]["is_screening_exam"]
    return r["nodules"], ctx | {"analysis_date": TODAY}


@pytest.mark.parametrize(
    ("letter", "rule", "applies"),
    [("a", "FL17-S1-GT8", "conditional"), ("b", "FL17-S1-6TO8", "conditional"), ("c", "FL17-GGN1-GE6", True)],
)
def test_phase_2_cases(letter, rule, applies):
    nodules, ctx = case_inputs(letter)
    r = recommend(nodules, ctx)
    assert r["rule_id"] == rule and r["applies"] == applies
    assert list(VALIDATOR.iter_errors(r)) == []
    if applies == "conditional":  # immune status is not written in these reports
        assert r["questions_for_doctor"] == ["Is your immune system weakened?"]
