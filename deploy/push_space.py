"""Push the assembled folder to the Hugging Face Space as ONE commit: add or update every file, delete files that no longer exist.

Usage: HF_TOKEN=... python deploy/push_space.py <owner/space-name> [--folder build/space]

Never touches static/cases (the example scans, uploaded once with deploy/upload_cases.py). The token is read from the
environment only and is never printed.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from huggingface_hub import CommitOperationAdd, CommitOperationDelete, HfApi

MANAGED = ("static/", "api/", "shared/", "Dockerfile", "README.md")
KEEP = ("static/cases/",)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("repo_id")
    ap.add_argument("--folder", default="build/space")
    ap.add_argument("--message", default="Deploy from GitHub")
    args = ap.parse_args()
    token = os.environ.get("HF_TOKEN")
    if not token:
        print("HF_TOKEN is not set")
        return 2
    folder = Path(args.folder).resolve()
    local = {p.relative_to(folder).as_posix(): p for p in folder.rglob("*") if p.is_file()}
    if "Dockerfile" not in local:
        print(f"{folder} does not look like an assembled Space (no Dockerfile)")
        return 2

    api = HfApi(token=token)
    remote = set(api.list_repo_files(args.repo_id, repo_type="space"))
    stale = sorted(f for f in remote if f.startswith(MANAGED) and not f.startswith(KEEP) and f not in local)
    ops = [CommitOperationAdd(path_in_repo=rel, path_or_fileobj=str(path)) for rel, path in sorted(local.items())]
    ops += [CommitOperationDelete(path_in_repo=f) for f in stale]
    print(f"{len(local)} files to add or update, {len(stale)} stale files to delete, {len(remote & {f for f in remote if f.startswith(KEEP)})} scan files kept")
    info = api.create_commit(repo_id=args.repo_id, repo_type="space", operations=ops, commit_message=args.message)
    print(f"pushed: {info.commit_url}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
