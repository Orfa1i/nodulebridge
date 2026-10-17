# NoduleBridge on a Hugging Face Space: one container, the API serving the exported web app and the example scans on port 7860.
# Built by Hugging Face from the files deploy/assemble_space.py puts in the Space repo. No API key is baked in.
FROM python:3.11-slim-bookworm

ENV PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    CHROMIUM_NO_SANDBOX=true \
    STATIC_DIR=/app/static \
    WEB_BASE_URL=http://127.0.0.1:7860 \
    LLM_PROVIDER=gemini \
    TRUST_PROXY=true \
    PORT=7860

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
COPY static static

# Hugging Face runs Spaces as user 1000
RUN useradd --create-home --uid 1000 user && mkdir -p /app/data && chown -R user:user /app/data /ms-playwright
USER user

EXPOSE 7860
CMD ["sh", "-c", "uv run --project api --no-sync uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --app-dir api --proxy-headers --forwarded-allow-ips='*'"]
