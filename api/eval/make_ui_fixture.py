"""Write UI test fixtures: /extract responses for the three Phase 2 reports.

THE MODEL IS MOCKED HERE. Intake (PDF -> sentences) and verification are the real code; only the
LLM step is replaced by an answer built from the Phase 2 manifest. The fixtures exist so the
Playwright UI tests can run without an API key. They are not evidence that the real model works:
that is what `python -m api.eval.run` is for.

Usage (repo root): uv run --project api python -m api.eval.make_ui_fixture
"""

from __future__ import annotations

import json
import re
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import ROOT, Settings
from app.services.extract_service import ExtractService
from app.services.extractor import LlmOutput
from app.services.report_text import read_pdf

OUT = ROOT / "web" / "tests" / "e2e" / "fixtures"
ATT = {"solid": "solid", "part-solid": "part_solid", "ground-glass": "ground_glass"}


class MockModel:
    model = "mock-model (UI fixture)"

    def __init__(self, manifest: dict):
        self.manifest = manifest

    def extract(self, sentences, deadline):
        n = self.manifest["nodules"][0]
        lobe = n["lobe_estimate"]
        word = lobe["label"].split()[1]
        sentence = next(s for s in sentences if "nodule is seen" in s.text)
        quote = re.search(r"(an? \d+ mm [\w-]+ nodule is seen in the [\w -]+)\.", sentence.text).group(1)
        scenario = self.manifest["scenario"]
        age_sentence = next(s for s in sentences if f"{scenario['age_years']}-year-old" in s.text)
        history = next(s for s in sentences if "No known cancer" in s.text)
        immune_sentence = next((s for s in sentences if "Not immunocompromised" in s.text), None)
        immune = (
            {"value": False, "evidence_sentence_ids": [immune_sentence.id]}
            if immune_sentence
            else {"value": None, "evidence_sentence_ids": []}
        )
        result = {
            "study": {"exam_type": None, "indication_text": scenario["indication"], "is_screening_exam": False, "study_date": None},
            "patient_context": {
                "age_years": {"value": scenario["age_years"], "evidence_sentence_ids": [age_sentence.id]},
                "known_cancer": {"value": False, "evidence_sentence_ids": [history.id]},
                "immunocompromised": immune,
                "smoking_history": {"value": None, "evidence_sentence_ids": []},
            },
            "nodules": [
                {
                    "id": "n1", "count_context": "single", "size_text": f"{n['fleischner_size_mm']} mm",
                    "dimensions_mm": [n["fleischner_size_mm"]], "size_basis": "stated_single",
                    "attenuation": ATT[n["attenuation"]], "solid_component_mm": None, "side": lobe["side"],
                    "lobe": word if word in {"upper", "middle", "lower"} else None, "morphology": [],
                    "benign_features": [], "stability_text": None, "assertion": "present",
                    "evidence": [{"sentence_id": sentence.id, "quote": quote}],
                }
            ],
            "other_findings": ["healing rib fracture"] if self.manifest["case_id"] == "case-a" else [],
        }  # fmt: skip
        return LlmOutput(result=result, model=self.model)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    shutil.rmtree(ROOT / "data" / "eval-fixture", ignore_errors=True)  # never reuse a stale mock answer
    for letter in "abc":
        folder = ROOT / "data" / "cases" / f"case-{letter}"
        manifest = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
        settings = Settings(data_dir=ROOT / "data" / "eval-fixture", anthropic_model="mock-model")
        service = ExtractService(settings, lambda m=manifest: MockModel(m))
        report = read_pdf((folder / "report.pdf").read_bytes())
        payload = service.run(report, 1.0)
        payload["cached"] = False
        (OUT / f"extract-case-{letter}.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        print(f"wrote extract-case-{letter}.json")


if __name__ == "__main__":
    main()
