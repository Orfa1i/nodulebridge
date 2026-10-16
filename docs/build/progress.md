# Build progress

## Phase 1 — Foundation and Asklevia shell (done)

**Built**
- Repo layout per master brief section 3; private GitHub repo `nodulebridge` (origin/main).
- Next.js app (App Router, TS, CSS only, no Tailwind): App bar, persistent safety banner, routes `/`, `/passport`, `/about`, `/dev/kit`, `LocaleProvider`.
- FastAPI skeleton: `GET /health` -> `{status, version, model}`, CORS for `http://localhost:3000`, pydantic-settings, 3 pytest tests.
- Shared schema placeholders + generation (`pnpm schemas`) to `web/src/types/generated/*.d.ts` and `api/app/schemas/generated/*.py`.
- Hex-colour lint: Stylelint `color-no-hex` (kit files excluded) + vitest scan of `.tsx` files. Verified fail on `#ff0000`, pass after removal.
- Playwright smoke spec `web/tests/e2e/shell.spec.ts` (8 tests: shell on every route, fonts, Arabic RTL, focus ring, spectrum usage, nav).

**Versions (pinned in lockfiles)**
- Node 22.19.0, pnpm 11.21.0, Python 3.11.9 (uv 0.12.13 venv resolved 3.11.15).
- Next.js 16.4.2, React 19.3.1, lucide-react 1.57.0, TypeScript 6.0.3, ESLint 10.12.0, Stylelint 17.16.0, Vitest 5.0.5, Playwright 1.64.1, json-schema-to-typescript 16.0.0.
- FastAPI 0.143.2, uvicorn 0.54.0, pydantic 2.14.1, pydantic-settings 2.16.0, pytest 9.1.1, httpx 0.28.1, ruff 0.17.1, datamodel-code-generator 0.84.0.

**Fonts**: Funnel Display, Host Grotesk, Geist Mono from `web/public/fonts` via `@font-face` in `tokens.css` (URLs fixed to `/fonts/...`). IBM Plex Sans Arabic 400/500/600 via `next/font/google`, exposed as `--font-arabic` on `<html>`.

**Deviations**
- No `make` on Windows: `pnpm dev|test|lint|schemas` replace `make` targets (allowed by the phase file).
- TypeScript pinned to 6.0.3, not 7.0.2: typescript-eslint does not support TS 7 yet. Revisit when it does.
- `next lint` no longer exists in Next 16; lint is `eslint .` + stylelint + hex test.
- Port 8000 on the dev machine is held by an unrelated project (`backend.main:app`). `pnpm dev` reads `API_PORT` (default 8000) and sets `NEXT_PUBLIC_API_BASE_URL` for the web app. Acceptance was run with the API on 8001.
- Kit README mentions `components/bundle.css`; the kit ships a flat `bundle.css`.
- Added `body { margin: 0 }` in `web/src/app/shell.css`; the kit does not reset the default body margin, which left an 8px gap round the App bar and banner.
- Skip-to-content link added to the shell (accessibility).

**ak- classes**: all used classes behaved as the README says, apart from the body margin above. `ak-alert` icons are plain child svg elements.

**Open TODO-VERIFY**
- Arabic banner text, reviewed by a bilingual clinician (`SafetyBanner.tsx`, `SAFETY_BANNER_AR` is null until then).
- Full TCIA LIDC-IDRI citation text and team names (`/about`).

**Next phase must know**
- Run web tests with `pnpm --dir web e2e` while `pnpm dev` is running (`WEB_URL` overrides the base URL).
- Generated schema files are committed; re-run `pnpm schemas` after editing `/shared/schemas`.
- Next dev writes `web/AGENTS.md`; it is git-ignored.
