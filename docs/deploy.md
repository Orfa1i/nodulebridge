# Deploying NoduleBridge

## Free live demo: Hugging Face Space (deployed by GitHub Actions)

GitHub Actions cannot host a running app, so the live demo runs in a free **Hugging Face Space** (Docker) and a GitHub workflow keeps it up to date. One container serves everything on one address: the API, the exported web app and the example scans. It runs **without a language-model key**: the 18 examples come from stored model answers (`api/seed/extract`) and voice works for studies A to C (pre-made clips); reading a new report of your own and live voice for the other studies answer "not available" in plain words. Free Spaces sleep after inactivity and take about a minute to wake on the first visit.

How the pieces fit: `deploy/space/` (the Space's Dockerfile and README), `deploy/assemble_space.py` (collects what the Space needs), `deploy/push_space.py` (one atomic commit to the Space, never touching the scans), `deploy/upload_cases.py` (uploads the scans once), `.github/workflows/deploy-space.yml` (builds the web app as static files with `STATIC_EXPORT=1` and pushes on every push to `main`). The API serves the web app when `STATIC_DIR` is set (`api/app/webstatic.py`); `LLM_PROVIDER=gemini` with no key makes the stored answers match.

One-time setup:

1. Make a free Hugging Face account and a **write** access token (Settings, Access Tokens).
2. Log in locally: `uvx --from huggingface_hub hf auth login` (paste the token in your terminal).
3. Create the Space (public, Docker): `uvx --from huggingface_hub hf repo create <you>/nodulebridge --repo-type space --space-sdk docker`.
4. Upload the example scans once: `uv run --with huggingface_hub python deploy/upload_cases.py <you>/nodulebridge` (about 560 MB; needs `pnpm sync:cases` first).
5. In the GitHub repository add the secret `HF_TOKEN` (`gh secret set HF_TOKEN`) and the variable `HF_SPACE` (`gh variable set HF_SPACE --body <you>/nodulebridge`).
6. Run the workflow ("Deploy the live demo", Run workflow) or push to `main`. The Space builds (about 10 minutes the first time). Its address is `https://<you>-nodulebridge.hf.space`.

Rehearse it locally with no account: `STATIC_EXPORT=1 NEXT_PUBLIC_API_BASE_URL= pnpm --dir web build`, `python deploy/assemble_space.py --with-cases`, `docker build -t nodulebridge-space:local build/space`, `docker run -p 7860:7860 nodulebridge-space:local`, then `WEB_URL=http://127.0.0.1:7860 pnpm --dir web exec playwright test`. That full suite passes against this exact image (the timings tests use `?timings` because the panel is hidden in production builds).

---

## Other hosts (Google Cloud, Render and similar)

Three pieces: the web app (Vercel), the API (any container host), and the prepared case files (object storage). Nothing here has been run on a public host yet: the steps need your accounts. Everything below except the hosting accounts was tested locally (API image built and run, PDF made inside the container, `pnpm warm` run against it).

## 1. Case files (object storage)

The CT volumes are about 560 MB for the 18 studies (20 to 60 MB each) and are not in git. Upload `web/public/cases/` (made by `pnpm sync:cases`) to a bucket (Cloudflare R2, S3 or Vercel Blob) so the layout is `<base>/case-a/ct.nii.gz`, `<base>/index.json`, and so on.

- CORS: allow `GET` and `HEAD` from the web origin (and your preview origins).
- Cache: `Cache-Control: public, max-age=31536000, immutable` on `*.nii.gz`, `*.mp3` and `*.pdf`; a short cache on `manifest.json`, `index.json` and the voice `.json` files.
- Set `NEXT_PUBLIC_DATA_BASE_URL=<base>` on the web project (it is read at build time).

## 2. API (container)

```
docker build -f api/Dockerfile -t nodulebridge-api .
docker run -p 8000:8000 --env-file api.env nodulebridge-api
```

The image holds Chromium (PDF endpoint), ffmpeg (live speech) and the seed extractions of Cases A to C, which are copied into the cache on start so the examples are served pre-computed. Run it on Render, Fly.io, Modal (CPU) or Cloud Run. Give it a persistent disk at `/app/data` if you want caches to survive restarts (optional: the seed refills the example cache).

Environment (names only; set the values in the host's secret store, never in git):

| Variable | Purpose |
|---|---|
| `GOOGLE_API_KEY` (or `ANTHROPIC_API_KEY` + `ANTHROPIC_MODEL`) | extraction and speech |
| `GEMINI_MODEL`, `TTS_MODEL` | defaults are fine; the seed only matches the model it was made with (`gemini-3.5-flash-lite`, prompt `extract_v4`) |
| `WEB_ORIGIN` | the web URL(s), comma separated, for CORS |
| `WEB_BASE_URL` | the same public web URL; the PDF endpoint opens `/passport/print` there |
| `TRUST_PROXY=true` | count the real caller behind the platform proxy (needed for the rate limit) |
| `RATE_LIMIT_EXTRACT_PER_HOUR` (20), `RATE_LIMIT_TTS_PER_HOUR` (60), `RATE_LIMIT_PDF_PER_HOUR` (30) | `0` turns a limit off. The counter is per instance; use one instance, or the platform limiter |
| `CHROMIUM_NO_SANDBOX=true` | already set in the image |

Monitor `GET /health` (status, version, provider, model).

## 3. Web (Vercel)

Project root `web/`. Install `pnpm install`, build `pnpm build` (runs `next build --webpack`). Environment: `NEXT_PUBLIC_API_BASE_URL=<api url>`, `NEXT_PUBLIC_DATA_BASE_URL=<data url>`. The git commit shown in the verification drawer comes from the build.

## 4. Warm and check

```
API_BASE=<api url> NEXT_PUBLIC_DATA_BASE_URL=<data url> WEB_ORIGIN=<web url> pnpm warm
```

`pnpm warm` (also `make warm`) checks `/health` and CORS, runs the three examples through `/extract`, `/recommend` and `/explain`, and downloads every case file once, reporting sizes, timings and cache headers. Then open the public URL in a fresh browser and run Case A; the target is under 8 s from click to highlight.

## Known limits of this guide

- The container was built and tested locally against a production build of the web app. The Next dev server cannot be used by the PDF endpoint from another host name.
- Free tiers of the speech and language APIs are rate limited (the speech model allows about ten requests a day per model); the voice clips for Cases A to C are pre-made files, so the demo does not depend on it.
