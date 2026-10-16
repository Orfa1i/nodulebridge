"""Run the extraction evaluation against the REAL model and check the release thresholds.

Usage (repo root):  uv run --project api python -m api.eval.run [--fresh] [--workers 4]
Needs ANTHROPIC_API_KEY and ANTHROPIC_MODEL in .env. Results are cached in data/eval/ so a
rerun is free; --fresh clears that cache and calls the model again.

Fails (exit 1) if: any negation case is wrong, an injection changes the output, size accuracy
< 95%, side accuracy < 95%, or lobe accuracy < 95%.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import ROOT, Settings, get_settings
from app.services.cache import cache_key
from app.services.extract_service import ExtractService
from app.services.extractor import PROMPT_VERSION, ExtractionFailed, ExtractionUnavailable
from app.services.providers import make_extractor, model_id
from app.services.report_text import read_pdf, read_text

from .scoring import FIELDS, mentions_follow_up, merge, pct, score_case, signature

CASES_DIR = ROOT / "api" / "tests" / "eval" / "cases"
EVAL_DATA = ROOT / "data" / "eval"
ATTENUATION = {"solid": "solid", "part-solid": "part_solid", "ground-glass": "ground_glass"}
PHASE2_PATIENT = {  # from the report headers written in Phase 2 (fictional, labelled)
    "case-a": {"smoking_history": "former", "known_cancer": False, "immunocompromised": None},
    "case-b": {"smoking_history": "never", "known_cancer": False, "immunocompromised": None},
    "case-c": {"smoking_history": None, "known_cancer": False, "immunocompromised": False},
}
THRESHOLDS = {"size": 95.0, "side": 95.0, "lobe": 95.0}


def phase2_cases() -> list[dict]:
    cases = []
    for letter in ("a", "b", "c"):
        folder = ROOT / "data" / "cases" / f"case-{letter}"
        manifest = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
        n = manifest["nodules"][0]
        lobe = n["lobe_estimate"]
        word = lobe["label"].split()[1]  # "upper" / "lower" / "mid-lung"
        cases.append(
            {
                "id": f"p2-case-{letter}",
                "tags": ["phase2"],
                "pdf": folder / "report.pdf",
                "nodules": [
                    {
                        "assertion": "present", "dimensions_mm": [n["fleischner_size_mm"]],
                        "attenuation": ATTENUATION[n["attenuation"]], "side": lobe["side"],
                        "lobe": word if word in {"upper", "middle", "lower"} else None,
                        "count_context": "single", "solid_component_mm": None, "benign_features": [],
                        "has_stability_text": False,
                    }
                ],
                "patient": {
                    "age_years": manifest["scenario"]["age_years"],
                    "is_screening_exam": False,
                    **PHASE2_PATIENT[f"case-{letter}"],
                },
                "other_findings_any": ["rib"] if letter == "a" else [],
            }
        )
    return cases


def describe(result: dict) -> str:
    nodules = "; ".join(
        f"{n['assertion']} {n['dimensions_mm']} {n['attenuation']} {n['side']}/{n['lobe']} {n['count_context']}" for n in result["nodules"]
    )
    pc = result["patient_context"]
    patient = {k: pc[k]["value"] for k in pc} | {"screening": result["study"]["is_screening_exam"]}
    return f"{nodules or 'no nodules'} | {patient}"


def describe_gold(case: dict) -> str:
    nodules = "; ".join(
        f"{n['assertion']} {n['dimensions_mm']} {n['attenuation']} {n['side']}/{n['lobe']} {n['count_context']}" for n in case["nodules"]
    )
    return f"{nodules} | {case['patient']}"


def load_cases() -> list[dict]:
    cases = []
    for gold_path in sorted(CASES_DIR.glob("*.gold.json")):
        gold = json.loads(gold_path.read_text(encoding="utf-8"))
        gold["id"] = gold_path.name.removesuffix(".gold.json")
        gold["text"] = (CASES_DIR / f"{gold['id']}.txt").read_text(encoding="utf-8")
        cases.append(gold)
    return cases + phase2_cases()


def run_case(service: ExtractService, case: dict) -> dict:
    t = time.monotonic()
    report = read_pdf(case["pdf"].read_bytes()) if "pdf" in case else read_text(case["text"])
    intake_ms = (time.monotonic() - t) * 1000
    return service.run(report, intake_ms)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fresh", action="store_true", help="clear the eval cache and call the model again")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--rpm", type=float, default=0, help="max live model calls per minute (free tiers allow as few as 5); 0 = no limit")
    args = ap.parse_args()

    base = get_settings()
    settings = Settings(**{**base.model_dump(), "data_dir": EVAL_DATA, "extract_timeout_s": 60.0})
    if args.fresh:
        shutil.rmtree(EVAL_DATA / "cache", ignore_errors=True)
    try:
        extractor = make_extractor(settings)
    except ExtractionUnavailable as exc:
        print(f"CANNOT RUN: {exc}\nSet it in .env (see .env.example) and run again.")
        return 2
    service = ExtractService(settings, lambda: extractor)

    cases = load_cases()
    print(f"{len(cases)} cases · model {model_id(settings)} · running with {args.workers} workers\n")
    outputs: dict[str, dict] = {}
    errors: dict[str, str] = {}

    gate = threading.Lock()
    state = {"next": 0.0}
    key_model = model_id(settings)

    def pace(case) -> None:
        """Wait so live calls stay under --rpm. Cache hits never wait."""
        if not args.rpm:
            return
        report = read_pdf(case["pdf"].read_bytes()) if "pdf" in case else read_text(case["text"])
        if service.cache.get(cache_key(report.normalised, PROMPT_VERSION, key_model)) is not None:
            return
        with gate:
            wait = state["next"] - time.monotonic()
            state["next"] = max(state["next"], time.monotonic()) + 60.0 / args.rpm
        if wait > 0:
            time.sleep(wait)

    def work(case):
        try:
            pace(case)
            return case["id"], run_case(service, case), None
        except (ExtractionFailed, ExtractionUnavailable) as exc:
            return case["id"], None, f"{exc} {getattr(exc, 'detail', '') or ''}".strip()

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        for cid, out, err in pool.map(work, cases):
            if out is not None:
                outputs[cid] = out
            else:
                errors[cid] = err or "unknown error"
                print(f"ERROR {cid}: {err}")

    totals: dict[str, list[int]] = {}
    failures: list[str] = []
    negation_ok = True
    for case in cases:
        out = outputs.get(case["id"])
        if out is None:
            failures.append(f"{case['id']}: no result ({errors.get(case['id'])})")
            if "negation" in case["tags"]:
                negation_ok = False
            continue
        part = score_case(case, out["result"])
        merge(totals, part)
        wrong = [f for f, (c, n) in part.items() if c < n]
        if wrong:
            failures.append(
                f"{case['id']}: wrong {', '.join(wrong)}\n"
                f"        got:  {describe(out['result'])}\n"
                f"        gold: {describe_gold(case)}"
            )
        if "negation" in case["tags"] and part["present_count"][0] != part["present_count"][1]:
            negation_ok = False
        if mentions_follow_up(out["result"]):
            failures.append(f"{case['id']}: output mentions follow-up or advice")
            negation_ok = False

    injection_ok = True
    for case in cases:
        twin = case.get("twin")
        if twin:
            a, b = outputs.get(case["id"]), outputs.get(twin)
            same = a is not None and b is not None and signature(a["result"]) == signature(b["result"])
            injection_ok &= same
            print(f"injection {case['id']} vs {twin}: {'identical output' if same else 'OUTPUT CHANGED'}")

    print(f"\n{'field':22} {'correct':>8} {'total':>6} {'accuracy':>9}")
    for field in ["present_count", "negation_recorded", *FIELDS, *sorted(k for k in totals if k.startswith("patient.")), "other_findings"]:
        if field in totals:
            c, n = totals[field]
            print(f"{field:22} {c:8d} {n:6d} {pct(c, n):8.1f}%")
    if failures:
        print("\nper-case problems:")
        for line in failures:
            print(f"  - {line}")

    checks = {
        "negation cases all correct": negation_ok,
        "injection leaves output unchanged": injection_ok,
        **{f"{k} accuracy >= {v:g}%": pct(*totals.get(k, [0, 0])) >= v for k, v in THRESHOLDS.items()},
        "no case errored": not errors,
    }
    print()
    for name, ok in checks.items():
        print(f"{'PASS' if ok else 'FAIL'}  {name}")
    latencies = [o["timings"]["total_ms"] for o in outputs.values() if not o["cached"]]
    if latencies:
        print(f"\nlive calls {len(latencies)}, mean {sum(latencies) / len(latencies):.0f} ms, max {max(latencies):.0f} ms")
    print(f"cached {sum(o['cached'] for o in outputs.values())}/{len(outputs)} · prompt {next(iter(outputs.values()))['prompt_version'] if outputs else '-'}")
    return 0 if all(checks.values()) else 1


if __name__ == "__main__":
    raise SystemExit(main())
