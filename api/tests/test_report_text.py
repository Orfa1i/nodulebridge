from pathlib import Path

import pytest

from app.services.report_text import ReportReadError, read_pdf, read_text

ROOT = Path(__file__).resolve().parents[2]


def texts(report):
    return [s.text for s in report.sentences]


def test_does_not_split_on_abbreviations_decimals_or_list_numbers():
    r = read_text(
        "Seen by Dr. Smith, e.g. on the prior CT. A 3.5 mm nodule is noted.\n"
        "1. Healing rib fracture.\n2. Pulmonary nodule, see above."
    )
    assert texts(r) == [
        "Seen by Dr. Smith, e.g. on the prior CT.",
        "A 3.5 mm nodule is noted.",
        "1. Healing rib fracture.",
        "2. Pulmonary nodule, see above.",
    ]


def test_splits_after_mm_period_when_a_new_sentence_follows():
    r = read_text("There is a 9 mm. However, the lungs are clear.")
    assert texts(r) == ["There is a 9 mm.", "However, the lungs are clear."]


def test_does_not_split_when_period_is_followed_by_lowercase():
    r = read_text("A nodule of 9 mm. in the right upper lobe is seen.")
    assert len(r.sentences) == 1


def test_wrapped_lines_are_joined_and_headings_stand_alone():
    r = read_text(
        "Lungs and pleura\nThe lungs are well expanded and there is a\nsmall nodule in the right lung.\n"
    )
    assert texts(r) == [
        "Lungs and pleura",
        "The lungs are well expanded and there is a small nodule in the right lung.",
    ]


def test_ids_offsets_and_line_numbers():
    raw = "First sentence here.\n\n   Second   sentence\twith  spaces.\nThird one."
    r = read_text(raw)
    assert [s.id for s in r.sentences] == ["s001", "s002", "s003"]
    for s in r.sentences:
        assert r.normalised[s.start : s.end] == s.text
        # the mapping leads back to the same words in the source
        assert " ".join(raw[s.source_start : s.source_end].split()) == s.text
    assert [s.line for s in r.sentences] == [1, 3, 4]
    assert all(s.page is None for s in r.sentences)
    assert r.sentences[1].text == "Second sentence with spaces."


def test_empty_text_is_rejected():
    with pytest.raises(ReportReadError):
        read_text("   \n  ")


def test_not_a_pdf_is_rejected():
    with pytest.raises(ReportReadError):
        read_pdf(b"hello")


def test_reads_the_phase_2_pdf_with_pages_and_lines():
    pdf = ROOT / "data" / "cases" / "case-a" / "report.pdf"
    if not pdf.exists():
        pytest.skip("case A report.pdf not built")
    r = read_pdf(pdf.read_bytes())
    nodule = next(s for s in r.sentences if "nodule is seen" in s.text)
    assert "9 mm solid nodule" in nodule.text
    assert nodule.page == 1
    assert nodule.line > 20
    assert any("rib" in s.text and "fracture" in s.text for s in r.sentences)
    assert any(s.text == "There is no pleural effusion." for s in r.sentences)
