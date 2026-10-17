"""Assemble the folder that becomes the Hugging Face Space repo.

Usage (repo root, after `STATIC_EXPORT=1 NEXT_PUBLIC_API_BASE_URL= pnpm --dir web build`):
    python deploy/assemble_space.py [--with-cases] [--out build/space]

The Space gets: Dockerfile and README.md (deploy/space), the API code, its lockfile and the stored model answers, the shared
content, and the exported web app as static/. The example scans (static/cases) are NOT part of what the workflow pushes:
they are uploaded once with deploy/upload_cases.py and stay in the Space repo. --with-cases copies them in for a local
rehearsal of the container.
"""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="build/space")
    ap.add_argument("--with-cases", action="store_true")
    args = ap.parse_args()
    out = (ROOT / args.out).resolve()
    web_out = ROOT / "web" / "out"
    if not (web_out / "index.html").exists():
        print("web/out is missing: run  STATIC_EXPORT=1 NEXT_PUBLIC_API_BASE_URL= pnpm --dir web build  first")
        return 2
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)

    for name in ("Dockerfile", "README.md"):
        shutil.copyfile(ROOT / "deploy" / "space" / name, out / name)
    (out / "api").mkdir()
    for name in ("pyproject.toml", "uv.lock"):
        shutil.copyfile(ROOT / "api" / name, out / "api" / name)
    ignore = shutil.ignore_patterns("__pycache__", "*.pyc")
    shutil.copytree(ROOT / "api" / "app", out / "api" / "app", ignore=ignore)
    shutil.copytree(ROOT / "api" / "seed", out / "api" / "seed")
    shutil.copytree(ROOT / "shared", out / "shared")
    shutil.copytree(web_out, out / "static", ignore=None if args.with_cases else shutil.ignore_patterns("cases"))
    if not args.with_cases:
        # the web build copies web/public/cases when it exists; the Space keeps its own copy of the scans
        shutil.rmtree(out / "static" / "cases", ignore_errors=True)
    files = [p for p in out.rglob("*") if p.is_file()]
    size = sum(p.stat().st_size for p in files) / 1e6
    print(f"assembled {len(files)} files, {size:.1f} MB, into {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
