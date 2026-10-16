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

## Phase 2 — LIDC-IDRI case preparation (done)

**Built**
- `/pipeline` (own uv env, Python 3.11): `select_cases.py`, `fetch_series.py`, `volume.py`, `measure.py`, `texture_map.py`, `export.py`, `reports.py`, `build_case.py`, `build_all.py`, `evidence.py`, 38 pytest tests.
- `python -m pipeline.build_all` rebuilds all three cases from the downloaded DICOM in about 20 s (`pnpm build:cases`). `pnpm fetch:cases` downloads the three series from the public TCIA NBIA REST API (no login).
- `/data/cases/case-{a,b,c}/`: `ct.nii.gz`, `mask.nii.gz`, `report.md`, `report.pdf`, `manifest.json` (CT and mask are git-ignored; manifest and report files are committed).
- `shared/schemas/case-manifest.schema.json` defined; TS and Pydantic types regenerated.

**Chosen cases (all values measured from the exported mask; mask = radiologists' 50% consensus, not AI)**

| Case | LIDC patient | Slice (0-based) | Long x short | Mean | Size for Fleischner | Attenuation (ratings) | Lobe estimate (height fraction) | Export |
|---|---|---|---|---|---|---|---|---|
| A | LIDC-IDRI-0213 | 71 of 104 | 9.4 x 8.2 mm | 8.8 mm | 9 mm | solid (5,5,5,5) | right upper lobe (0.73) | 19.8 MB |
| B | LIDC-IDRI-0184 | 55 of 121 | 7.8 x 5.9 mm | 6.9 mm | 7 mm | solid (5,5,5,5) | right mid-lung zone (0.45) | 21.7 MB |
| C | LIDC-IDRI-0497 | 115 of 210 | 17.9 x 13.5 mm | 15.7 mm | 16 mm | ground-glass (1,1,1,1) | right mid-lung zone (0.55) | 37.7 MB |

Full ranked candidate table: `docs/build/evidence/phase-02/candidates.txt`. Overlay PNGs (read from the exported NIfTI at `slice_index`): `docs/build/evidence/phase-02/case-{a,b,c}-overlay.png`.

**Why these cases**
- Filters: slice thickness <= 2.5 mm; >= 3 radiologists on the nodule; no other cluster >= 3 mm marked by 2+ radiologists (single nodule); sizes MEASURED with the build's own method (not pylidc `diameter`, which is the longest width and overstated every candidate).
- Ranking: strongest rater agreement on texture, then closest to 9 / 7 / 8 mm.
- A: first ranked with estimated height >= 0.55 of the scan. Real lung fraction after download is 0.73 (upper third starts at 0.67), so it is in the upper third but not deep in it. A had 9 candidates; B 16; C 8.
- B: requires a contrast-enhanced scan (scenario is a CT pulmonary angiogram). Series <= 300 images to stay near the size target.
- C: pure ground-glass, median texture 1, all four raters agree. 15.7 mm is larger than the 6-12 mm typical; the subsolid >= 6 mm branch still applies. Non-contrast scan; the report says "without intravenous contrast".
- First attempt (0227, 0633, picked from pylidc diameters) failed after measurement (A measured 8 mm, left mid-lung; B 5 mm). Their raw downloads were deleted.

**Format and size**: option 1, NIfTI. CT int16 HU (below -1024 clipped to -1024), mask uint8. Cropped to both lungs + 10 mm in plane + 25 mm in z; CT and mask use one box; `slice_index`, centroids and geometry are computed AFTER the crop. Lung voxel coverage of the crop: A 1.0, B 0.9993, C 1.0. Each case is well under 60 MB. No voxel downsampling.

**Conventions Phase 3 must follow**
- `slice_index` is 0-based along the third array axis; slices are sorted by ImagePositionPatient z ascending. UI "slice 72/104" must display `slice_index + 1`.
- NIfTI affine is RAS; manifest `origin`, `direction`, `centroid_mm` are DICOM LPS. `geometry.direction` columns are the LPS unit vectors of (row, column, slice).
- Case B slice spacing is 2.5 mm (CT) but pixel spacing 0.625 mm; case C is 1.25 mm slices.

**Measurement rule** (`measure.py`): long axis = longest diameter of the convex hull of the mask pixel corners on the max-area axial slice; short axis = longest chord perpendicular to it; size = mean of the two rounded half-up to the whole mm. Hull-based, so irregular edges inflate slightly.

**Reports**: one sentence per line, 36-38 lines, nodule sentence on line 32 (after "There is no pleural effusion."). Headers state "Example report written for this demo. Not a real patient." and "Fictional age and history written for this demo." Age and history as you specified. No risk level is written. All findings other than the measured nodule (rib fracture in A, "no pulmonary embolism" in B, etc.) are fictional scenario text.

**Deviations**
- Selection ranks on measured size and scan height, not pylidc `diameter` (see above).
- `pylidc.conf` (Windows) is written to the home folder (`%USERPROFILE%\pylidc.conf`), not `~/.pylidcrc`; `build_all` creates it if missing.
- Downloaded 2 extra series (0227, 0633) before the proxy proved unreliable; deleted. Extra download per candidate swap is the cost of needing the images for lung position.
- Pipeline pins: numpy 1.23.5, SQLAlchemy 1.4.54, scipy < 1.12, scikit-image < 0.22, matplotlib < 3.9, setuptools < 81 (pylidc needs pkg_resources). `SimpleITK` is installed per the phase file but unused; NIfTI is written with nibabel.
- Evidence screenshots are matplotlib overlays from the exported files. 3D Slicer check is yours (see below).

**Open TODO-VERIFY**
- Clinician to confirm each lobe estimate (A is upper-lobe; B and C are only "mid-lung zone", lobe not determined).
- Exact TCIA citation text (manifest `attribution`, `/about`). The DOI in the manifest came from TCIA's own metadata.
- Team names on `/about`.
- Arabic safety banner text (Phase 1).

**Next phase must know**
- Phase 3 loads `ct.nii.gz` and `mask.nii.gz` from `DATA_BASE_URL`; both are git-ignored and must be served from `data/cases/<id>/`.
- Fleischner engine inputs per case are in the manifest: `fleischner_size_mm`, `attenuation`, `scenario.age_years`; risk is unknown by design.
- The report PDF text is plain: the extraction step reads `report.md` and the PDF.

## Phase 3 — The CT viewer (done)

**Built**
- `web/src/components/viewer/CaseViewer.tsx` (Cornerstone3D, one axial ORTHOGRAPHIC volume viewport), `ViewerCard.tsx` (ak-card wrapper), `viewer.css`.
- `web/src/lib/cases.ts` (manifest and file URLs, world <-> slice-index helpers from the manifest geometry), `lib/viewer/{cornerstone,css,store}.ts`.
- Route `/dev/viewer?case=A|B|C` (not in the nav). The viewer is not on `/` yet: Phase 6 wires it into the case workspace.
- `pnpm sync:cases` copies `data/cases/*/{manifest.json, ct.nii.gz, mask.nii.gz, report.md, report.pdf}` into `web/public/cases/` (git-ignored; Windows symlinks need admin). `NEXT_PUBLIC_DATA_BASE_URL` overrides the base for production (added to `.env.example`).
- Playwright `web/tests/e2e/viewer.spec.ts` (6 tests). Full e2e: 14/14 on `next dev`; the 6 viewer tests also pass on the production build.

**Versions (pinned)**: @cornerstonejs/core, tools, nifti-volume-loader 5.12.1; zustand 5.0.15. (Cornerstone 5.x differs from older docs: the NIfTI loader is image-id based, see below.)

**What had to be configured**
- Viewer is client-only: `dynamic(() => import("./CaseViewer"), { ssr: false })` in `ViewerCard`. No worker or WASM config was needed: the NIfTI path uses no image codecs. `next.config.ts` is unchanged.
- NIfTI in v5: `imageLoader.registerImageLoader("nifti", cornerstoneNiftiImageLoader)`, then `createNiftiImageIdsAndCacheMetadata({ url })` -> `volumeLoader.createAndCacheVolume("cornerstoneStreamingImageVolume:<url>", { imageIds })` -> `volume.load()`. URLs must be ABSOLUTE (the loader calls `new URL(url)`): `caseFileUrl()` prefixes `window.location.origin`.
- Mask: loaded through the same loader (so voxel layout equals the CT), copied with `voxelManager.getCompleteScalarDataArray()` into a derived labelmap (`createAndCacheDerivedLabelmapVolume`) via `setCompleteScalarDataArray`. `getScalarData()` throws for stack-backed volumes in v5.
- Segmentation: `segmentation.addSegmentations` + `addSegmentationRepresentations` with a 2-entry colour LUT; style via `segmentation.segmentationStyle.setStyle` (fillAlpha, outlineWidth 2). Colour read from `--overlay-finding` at runtime (`lib/viewer/css.ts`); no hex anywhere in viewer code (the hex test now scans `.ts` and `.tsx`).
- **Production build must use webpack**: `next build` with Turbopack stalled for 17+ minutes (low CPU) once Cornerstone was imported. `web/package.json` `build` is now `next build --webpack` (30 s, prints a harmless "Circular dependency between chunks with runtime" warning). `next dev` still uses Turbopack and works. Revisit when a newer Next fixes it.

**Design decisions**
- Slice number in the HUD and API is derived from the camera focal point projected on the manifest's own slice axis, not from Cornerstone's internal index. So the display always follows the manifest convention (0-based index, shown as index + 1) and cannot silently flip.
- Slice-order check (step 6): the max-area slice of the loaded mask is converted to world coordinates and projected on the manifest geometry. It must equal `slice_index`; otherwise a dev-only `ak-alert--danger` "Slice order mismatch: manifest X, viewer Y." shows and `console.error` fires. All three cases pass (A 71, B 55, C 115). This also proves Cornerstone's world space equals the manifest's LPS space.
- HUD: `Slice 72 / 104 · 2.5 mm · W 1500 L -600`. The mm value is the slice spacing from the manifest (case B has 0.625 mm pixels and 2.5 mm slices; C has 1.25 mm). The HUD has a viewer-surface backing so it stays readable over bright bone.
- Screen readers: a debounced (350 ms) visually-hidden `aria-live="polite"` mirror says "Slice 72 of 104", instead of live-announcing every slice during a scroll.
- Keyboard: ArrowUp = next slice (towards the head, index + 1), ArrowDown = previous. Wheel scroll, left-drag window/level, right-drag zoom, middle-drag pan.
- `jumpToFinding("n1")`: moves the camera to the nodule's slice, centres on the centroid and zooms to 2x over 320 ms (ease-out), then pulses the fill opacity 0.35 -> 0.6 -> 0.35 over 600 ms. Both are skipped under `prefers-reduced-motion`. The test asserts centring within 3 px, zoom ratio 2.0 and the pulse peak.
- API for Phase 6 (`useViewerStore.getState().api`, set when ready): `jumpToFinding(noduleId)`, `onSliceChange(cb) -> unsubscribe`. In `/dev/viewer` it is also on `window.__nbViewer` with a `debugState()` helper (debug flag only).
- Loading: indigo `ak-progress` (not spectrum) with "Loading CT" and a percentage, shown only after 400 ms.
- Finding label: "Finding 1 · {fleischner_size_mm} mm", pinned from world to canvas, visible only on slices where the mask exists.
- No MedSAM mask exists (skipped in Phase 2), so there is no second segmentation or legend.

**Acceptance results**
- All three cases load. Time to ready, headless Chromium with software WebGL on this machine (localhost): A 2.6 s, B 2.5-3.1 s, C 3.1 s. Second load of case A: 1.7-1.8 s (limit 4 s). On a laptop with a real GPU this should be faster; not measured.
- `jumpToFinding` lands on the manifest slice for A, B, C with the nodule centred (screenshots checked).
- HUD follows scroll (keyboard test: +5 slices, -1), W/L presets change the HUD, announcements fire.
- Outline colour from CSS variables; hex grep over viewer code is empty.
- Playwright: open `/dev/viewer?case=A`, call `jumpToFinding`, HUD shows `Slice 72 / 104` (index 71 + 1).
- `pnpm lint` and `pnpm test` pass (web 17, api 3, pipeline 38).

**Open TODO-VERIFY**: unchanged from Phase 2 (lobe estimates, TCIA citation text, team names, Arabic banner).

**Next phase must know**
- Case files must be synced with `pnpm sync:cases` before the viewer works locally (and after any `pnpm build:cases`).
- Phase 4 reads `report.md` / `report.pdf`; they are copied by the same script to `web/public/cases/<id>/`.
- Phase 6 links report sentences to the viewer through `useViewerStore.getState().api.jumpToFinding("n1")` and `onSliceChange`.
