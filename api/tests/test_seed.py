from pathlib import Path

import pytest

from app.config import Settings
from app.services.extract_service import ExtractService
from app.services.report_text import read_pdf
from app.services.seed import SEED_DIR, seed_extract_cache

ROOT = Path(__file__).resolve().parents[2]


def test_seed_files_are_real_extractions_without_patient_data():
    files = sorted(SEED_DIR.glob("*.json"))
    assert len(files) >= 3  # the three original cases at least; every prepared case once it has been read
    for f in files:
        text = f.read_text(encoding="utf-8")
        assert '"llm_result"' in text and '"nodules"' in text
        assert "AIza" not in text and "api_key" not in text.lower()


def test_seeding_copies_missing_files_once_and_never_overwrites(tmp_path):
    settings = Settings(_env_file=None, data_dir=tmp_path)
    n = len(list(SEED_DIR.glob("*.json")))
    assert seed_extract_cache(settings) == n
    assert seed_extract_cache(settings) == 0
    target = tmp_path / "cache" / "extract"
    first = min(target.glob("*.json"))
    first.write_text("{}", encoding="utf-8")
    assert seed_extract_cache(settings) == 0 and first.read_text(encoding="utf-8") == "{}"


@pytest.mark.parametrize("letter", ["a", "b", "c"])
def test_after_seeding_an_example_report_is_a_cache_hit_for_the_default_model(tmp_path, letter):
    pdf = ROOT / "data" / "cases" / f"case-{letter}" / "report.pdf"
    if not pdf.exists():
        pytest.skip("prepared case files are not present")
    settings = Settings(_env_file=None, data_dir=tmp_path, google_api_key="test-key", anthropic_api_key=None, anthropic_model=None)
    seed_extract_cache(settings)
    service = ExtractService(settings, lambda: (_ for _ in ()).throw(AssertionError("the model must not be called")))
    result = service.run(read_pdf(pdf.read_bytes()), 0.0)
    assert result["cached"] is True and result["result"]["nodules"]


def test_a_different_model_does_not_use_the_seed(tmp_path):
    pdf = ROOT / "data" / "cases" / "case-a" / "report.pdf"
    if not pdf.exists():
        pytest.skip("prepared case files are not present")
    settings = Settings(_env_file=None, data_dir=tmp_path, google_api_key="test-key", gemini_model="some-other-model")
    seed_extract_cache(settings)
    service = ExtractService(settings, lambda: None)
    assert service.is_cached(read_pdf(pdf.read_bytes())) is False
