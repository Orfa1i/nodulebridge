"""Upload the example scans (web/public/cases, about 560 MB) to the Space repo, once.

Usage (after `hf auth login`, or with HF_TOKEN set): python deploy/upload_cases.py <owner/space-name>

The files go to static/cases in the Space repo (large files are stored with Git LFS automatically). The GitHub workflow
never deletes them. Run it again after a case changes; unchanged files are not uploaded twice. Make them first with
`pnpm fetch:cases`, `pnpm build:cases` and `pnpm sync:cases`.
"""

from __future__ import annotations

import sys
from pathlib import Path

from huggingface_hub import HfApi

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    repo_id = sys.argv[1]
    cases = ROOT / "web" / "public" / "cases"
    if not (cases / "index.json").exists():
        print("web/public/cases/index.json is missing: run pnpm sync:cases first")
        return 2
    api = HfApi()  # uses HF_TOKEN or the saved login
    size = sum(p.stat().st_size for p in cases.rglob("*") if p.is_file()) / 1e6
    print(f"uploading {size:.0f} MB to {repo_id}:static/cases ...")
    info = api.upload_folder(
        repo_id=repo_id,
        repo_type="space",
        folder_path=str(cases),
        path_in_repo="static/cases",
        commit_message="Add the example scans",
    )
    print(f"done: {info.commit_url}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
