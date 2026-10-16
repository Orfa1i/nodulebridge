"""Rewrite the `scenario` block of every existing case manifest from reports.SCENARIOS.

Used when a scenario field is added (exam, source): the manifests of cases built earlier gain the new fields without
rebuilding anything (the CT, mask and report stay exactly as they are).
Usage (repo root): python -m pipeline.refresh_scenarios
"""

from __future__ import annotations

import json

from . import reports
from .build_case import CASES_DIR


def main() -> None:
    for path in sorted(CASES_DIR.glob("case-*/manifest.json")):
        m = json.loads(path.read_text(encoding="utf-8"))
        sc = reports.SCENARIOS[path.parent.name.removeprefix("case-").upper()]
        m["scenario"] = {
            "label": m["scenario"]["label"],
            "age_years": sc["age"],
            "sex": sc["sex"],
            "indication": sc["indication"],
            "history": sc["history"],
            "exam": sc["exam"],
            "source": sc["source"],
        }
        path.write_text(json.dumps(m, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"{path.parent.name}: {sc['exam']} · {sc['source']}")


if __name__ == "__main__":
    main()
