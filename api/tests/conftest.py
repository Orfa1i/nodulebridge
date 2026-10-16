import sys
from pathlib import Path

API = Path(__file__).resolve().parents[1]
# `app` imports from api/, `api.eval...` from the repo root
for path in (API, API.parent):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))
