import copy

from app.services.report_text import read_text
from app.services.verify_extraction import SIZE_NOTE_SINGLE, regex_sizes_mm, verify

TEXT = (
    "There is no pleural effusion.\n"
    "However, a 9 x 7 mm solid nodule is seen in the right upper lobe.\n"
    "A 1.2 cm nodule is seen in the left lung."
)
QUOTE = "a 9 x 7 mm solid nodule is seen in the right upper lobe"


def nodule(**kw):
    base = {
        "id": "n1",
        "count_context": "single",
        "size_text": "9 x 7 mm",
        "dimensions_mm": [9, 7],
        "size_basis": "two_axes",
        "attenuation": "solid",
        "solid_component_mm": None,
        "side": "right",
        "lobe": "upper",
        "morphology": [],
        "benign_features": [],
        "stability_text": None,
        "assertion": "present",
        "evidence": [{"sentence_id": "s002", "quote": QUOTE}],
    }
    return base | kw


def run(*nodules):
    report = read_text(TEXT)
    return verify({"nodules": list(nodules)}, report.sentences)


def test_good_nodule_is_checked_and_mean_is_computed():
    result, ver = run(nodule())
    n = result["nodules"][0]
    assert n["confidence"] == "checked" and n["confidence_reasons"] == []
    assert n["mean_diameter_mm"] == 8.0 and n["size_note"] is None and n["size_basis"] == "two_axes"
    assert ver.quotes_dropped == 0


def test_quote_altered_by_one_character_is_dropped_and_nodule_removed():
    bad = nodule(evidence=[{"sentence_id": "s002", "quote": QUOTE.replace("solid", "solud")}])
    result, ver = run(bad)
    assert result["nodules"] == []
    assert ver.quotes_dropped == 1 and ver.nodules_removed == 1
    assert any(i.startswith("quote_not_found") for i in ver.issues)


def test_one_bad_quote_is_dropped_but_a_good_one_keeps_the_nodule():
    ev = [
        {"sentence_id": "s002", "quote": "9 x 7 mm solid nodule"},
        {"sentence_id": "s002", "quote": "9 x 7 mm solid noduleE"},
        {"sentence_id": "s099", "quote": "does not exist"},
    ]
    result, ver = run(nodule(evidence=ev))
    assert [e["quote"] for e in result["nodules"][0]["evidence"]] == ["9 x 7 mm solid nodule"]
    assert ver.quotes_dropped == 2
    assert "quote_not_found" in result["nodules"][0]["issues"]
    assert result["nodules"][0]["confidence"] == "needs_review"  # an issue was recorded


def test_dimension_not_in_any_quote_is_dropped():
    ev = [{"sentence_id": "s002", "quote": "9 x 7 mm solid nodule"}]
    result, ver = run(nodule(dimensions_mm=[9, 7, 12], evidence=ev))
    assert result["nodules"][0]["dimensions_mm"] == [9, 7]
    assert any(i.startswith("dimension_not_in_quote") for i in ver.issues)


def test_single_dimension_uses_it_and_sets_the_note():
    ev = [{"sentence_id": "s002", "quote": "9 x 7 mm solid nodule"}]
    result, _ = run(nodule(dimensions_mm=[9], size_basis="two_axes", evidence=ev))
    n = result["nodules"][0]
    assert n["mean_diameter_mm"] == 9.0
    assert n["size_basis"] == "stated_single" and n["size_note"] == SIZE_NOTE_SINGLE


def test_cm_is_converted_and_unsupported_numbers_are_dropped():
    ev = [{"sentence_id": "s003", "quote": "A 1.2 cm nodule"}]
    result, _ = run(nodule(dimensions_mm=[12], size_text="1.2 cm", side="left", lobe=None, evidence=ev))
    n = result["nodules"][0]
    assert n["mean_diameter_mm"] == 12.0 and n["confidence"] == "checked"
    result, _ = run(nodule(dimensions_mm=[9, 8], evidence=[{"sentence_id": "s002", "quote": "9 x 7 mm"}]))
    assert result["nodules"][0]["dimensions_mm"] == [9]  # 8 is not in the quote


def test_half_up_rounding():
    report = read_text("A 8.5 mm solid nodule is seen. A 7 x 6 mm solid nodule is seen.")
    one = nodule(dimensions_mm=[8.5], size_text="8.5 mm", side=None, lobe=None,
                 evidence=[{"sentence_id": "s001", "quote": "A 8.5 mm solid nodule"}])
    two = nodule(id="n2", dimensions_mm=[7, 6], side=None, lobe=None,
                 evidence=[{"sentence_id": "s002", "quote": "A 7 x 6 mm solid nodule"}])
    result, _ = verify({"nodules": [one, two]}, report.sentences)
    assert result["nodules"][0]["mean_diameter_mm"] == 9.0  # 8.5 rounds half up
    assert result["nodules"][1]["mean_diameter_mm"] == 7.0  # (7 + 6) / 2 = 6.5 rounds half up


def test_regex_disagreement_gives_needs_review_with_reason():
    result, _ = run(nodule(side="left"))  # text says right
    n = result["nodules"][0]
    assert n["confidence"] == "needs_review"
    assert any(r.startswith("side_not_in_text") for r in n["confidence_reasons"])
    result, _ = run(nodule(lobe=None))  # text says upper lobe
    reasons = result["nodules"][0]["confidence_reasons"]
    assert any(r.startswith("lobe_in_text_not_extracted") for r in reasons)
    result, _ = run(nodule(side=None))  # text says right
    reasons = result["nodules"][0]["confidence_reasons"]
    assert any(r.startswith("side_in_text_not_extracted") for r in reasons)


def test_negated_nodule_without_size_is_checked():
    report = read_text("No pulmonary nodules.")
    n = nodule(
        count_context="unclear",
        size_text=None,
        dimensions_mm=[],
        size_basis="unspecified",
        attenuation="unknown",
        side=None,
        lobe=None,
        assertion="negated",
        evidence=[{"sentence_id": "s001", "quote": "No pulmonary nodules."}],
    )
    result, ver = verify({"nodules": [n]}, report.sentences)
    out = result["nodules"][0]
    assert out["confidence"] == "checked"
    assert out["mean_diameter_mm"] is None and out["size_basis"] == "unspecified"
    assert ver.issues == []


def test_input_is_not_modified():
    report = read_text(TEXT)
    original = {"nodules": [nodule(dimensions_mm=[9, 7, 12])]}
    snapshot = copy.deepcopy(original)
    verify(original, report.sentences)
    assert original == snapshot


def test_regex_sizes():
    assert regex_sizes_mm("a 9 x 7 mm nodule and a 4 mm nodule") == [[9.0, 7.0], [4.0]]
    assert regex_sizes_mm("1.2 × 0.8 cm") == [[12.0, 8.0]]
    assert regex_sizes_mm("no size here") == []
