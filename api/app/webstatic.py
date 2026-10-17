"""Static file serving for the exported web app, with the one rule Next.js's static export needs.

Next.js asks for page data at  /passport/__next.passport.__PAGE__.txt  but its export stores the file at
/passport/__next.passport/__PAGE__.txt  (the first dotted part stays with "__next.", the rest become folders). Plain
static servers answer 404, and the browser falls back to a slow full page load. This maps the name, so moving between
pages stays instant. Everything else is ordinary StaticFiles behaviour (index.html for folders, byte ranges, 404).
"""

from __future__ import annotations

from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException
from starlette.responses import Response
from starlette.types import Scope


def export_data_path(path: str) -> str | None:
    """'passport/__next.passport.__PAGE__.txt' -> 'passport/__next.passport/__PAGE__.txt'; None when the name does not follow the pattern."""
    folder, _, name = path.replace(chr(92), "/").rpartition("/")  # Starlette hands over OS separators (backslashes on Windows)
    if not (name.startswith("__next.") and name.endswith(".txt")):
        return None
    parts = name[len("__next.") : -len(".txt")].split(".")
    if len(parts) < 2 or not all(parts):
        return None
    mapped = f"__next.{parts[0]}/{'/'.join(parts[1:])}.txt"
    return f"{folder}/{mapped}" if folder else mapped


class WebStaticFiles(StaticFiles):
    async def get_response(self, path: str, scope: Scope) -> Response:
        # a missing file is either a raised 404 or, when the export has a 404.html, a 404 response: handle both
        try:
            response = await super().get_response(path, scope)
        except HTTPException as exc:
            if exc.status_code != 404 or export_data_path(path) is None:
                raise
            response = None
        if response is not None and response.status_code != 404:
            return response
        alt = export_data_path(path)
        if alt is not None:
            try:
                mapped = await super().get_response(alt, scope)
                if mapped.status_code == 200:
                    return mapped
            except HTTPException:
                pass
        if response is None:
            raise HTTPException(status_code=404)
        return response
