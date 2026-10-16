"""The words of the three original example reports must never change: the cached model extractions, the voice clips and
the seed files are all keyed on them. Regenerating a report from its manifest must give the same Markdown, byte for byte."""

import json
from pathlib import Path

import pytest

from pipeline import reports

CASES = Path(__file__).resolve().parents[2] / "data" / "cases"


@pytest.mark.parametrize("letter", ["a", "b", "c"])
def test_original_reports_regenerate_identically(letter):
    folder = CASES / f"case-{letter}"
    if not (folder / "manifest.json").exists():
        pytest.skip("prepared case files are not present")
    m = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
    lines = reports.build_lines(letter.upper(), m["label"], m["lidc_patient_id"], m["nodules"][0], m["selection"]["contrast_used"], m["geometry"]["spacing"][2])
    assert reports.to_markdown(lines) == (folder / "report.md").read_text(encoding="utf-8")
