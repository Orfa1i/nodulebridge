# NoduleBridge API. Build from the repository root:  docker build -f api/Dockerfile -t nodulebridge-api .
# Includes Chromium for POST /passport/pdf and ffmpeg for live speech. Case files are NOT in the image: they are served
# from object storage (DATA_BASE_URL), and the example extractions ship as api/seed/extract.
FROM python:3.11-slim-bookworm

ENV PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    CHROMIUM_NO_SANDBOX=true \
    API_PORT=8000

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:0.12.13 /uv /uvx /bin/

WORKDIR /app
COPY api/pyproject.toml api/uv.lock api/
RUN uv sync --project api --frozen --no-dev
RUN uv run --project api playwright install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/*

COPY api/app api/app
COPY api/seed api/seed
COPY shared shared

# a normal user, and a data folder it can write to (extraction cache, speech cache, mock outbox)
RUN useradd --create-home --uid 10001 app && mkdir -p /app/data && chown -R app:app /app/data /ms-playwright
USER app

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD curl -fsS http://localhost:${API_PORT}/health || exit 1
CMD ["sh", "-c", "uv run --project api --no-sync uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-${API_PORT}} --app-dir api"]
