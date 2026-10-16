"""Per-IP request limits so a public link cannot run up the model, speech or Chromium bill.

A sliding window kept in memory per process, which is enough for one API instance (the demo). With several instances
each keeps its own count, so the real limit is the number of instances times the setting; use the platform's limiter
or Redis for a real deployment (see docs/deploy.md).

Only requests that cost something are counted: /extract when the report is not already cached, /tts, /passport/pdf.
Localhost is never limited, so development and the test suite are not affected.
"""

from __future__ import annotations

import ipaddress
import threading
import time
from collections import deque
from collections.abc import Callable

from fastapi import Request

LOCAL = {"127.0.0.1", "::1", "localhost"}


class RateLimiter:
    def __init__(self, limit: int, window_s: float = 3600.0, clock: Callable[[], float] = time.monotonic):
        self.limit, self.window_s, self.clock = limit, window_s, clock
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def hit(self, key: str) -> tuple[bool, int]:
        """Count one request. Returns (allowed, seconds until a slot frees up). limit 0 means no limit."""
        if self.limit <= 0:
            return True, 0
        now = self.clock()
        with self._lock:
            q = self._hits.setdefault(key, deque())
            while q and now - q[0] >= self.window_s:
                q.popleft()
            if len(q) >= self.limit:
                return False, max(1, int(self.window_s - (now - q[0])) + 1)
            q.append(now)
            if len(self._hits) > 10_000:  # forget old addresses so the table cannot grow without bound
                for k in [k for k, v in self._hits.items() if not v or now - v[-1] >= self.window_s]:
                    del self._hits[k]
            return True, 0


def client_ip(request: Request, trust_proxy: bool) -> str:
    """The caller's address. Behind a proxy the first X-Forwarded-For entry is the caller (only if the proxy is trusted)."""
    if trust_proxy:
        forwarded = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
        if forwarded:
            try:
                return str(ipaddress.ip_address(forwarded))
            except ValueError:
                pass
    return request.client.host if request.client else "unknown"


def is_local(ip: str) -> bool:
    if ip in LOCAL:
        return True
    try:
        return ipaddress.ip_address(ip).is_loopback
    except ValueError:
        return False


_limiters: dict[str, RateLimiter] = {}
_PLAIN = "Too many requests from this address. Please try again later."


def limiter_for(name: str, limit: int) -> RateLimiter:
    current = _limiters.get(name)
    if current is None or current.limit != limit:
        current = _limiters[name] = RateLimiter(limit)
    return current


def reset_limiters() -> None:
    """Forget every count (used by tests)."""
    _limiters.clear()


def too_many(request: Request, name: str, limit: int, trust_proxy: bool):
    """None when the request may go ahead; otherwise a 429 JSON response with Retry-After and a plain message."""
    from fastapi.responses import JSONResponse

    ip = client_ip(request, trust_proxy)
    if is_local(ip):
        return None
    allowed, retry_after = limiter_for(name, limit).hit(ip)
    if allowed:
        return None
    minutes = max(1, round(retry_after / 60))
    return JSONResponse(
        status_code=429,
        headers={"Retry-After": str(retry_after)},
        content={"error": {"code": "rate_limited", "message": _PLAIN, "detail": f"Limit reached for {name}. Try again in about {minutes} minute{'s' if minutes != 1 else ''}."}},
    )
