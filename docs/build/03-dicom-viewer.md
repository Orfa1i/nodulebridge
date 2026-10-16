# Phase 3 — The CT viewer (Cornerstone3D)

**Time budget:** 3 hours · **Needs:** Phase 2 cases · **Produces:** a viewer card that loads a case, scrolls slices, shows the nodule overlay and can jump to a slice on command.

## Goal

`<CaseViewer caseId>` loads a prepared case in under 4 seconds on the demo laptop (after first load), shows axial slices with window/level for lung, overlays the consensus mask in the finding colour, and exposes `jumpToFinding(noduleId)`.

## Steps

1. **Install Cornerstone3D** in `/web`: `@cornerstonejs/core`, `@cornerstonejs/tools`, and the loader matching Phase 2’s export choice (`@cornerstonejs/nifti-volume-loader` for NIfTI, or `@cornerstonejs/dicom-image-loader` for DICOM). Pin versions. Cornerstone uses web workers and WASM codecs: configure Next.js accordingly (client-only component via `dynamic(() => import(...), { ssr: false })`, worker and WASM asset handling). Write what you had to configure in `progress.md`.
2. **Serve case files.** Locally from `/web/public/cases/` (symlink or copy from `/data/cases/`). In production from `DATA_BASE_URL` with CORS and `Cache-Control: public, max-age=31536000, immutable`. Add a tiny `lib/cases.ts` that fetches `manifest.json` and builds the volume and mask URLs.
3. **Viewer component** `components/viewer/CaseViewer.tsx`:
   - Rendering engine with one axial `ORTHOGRAPHIC` viewport (stack is fine if the volume path is too slow; keep the same API).
   - Lung window: width 1500, level −600. Add a segmented control (`ak-seg`) “Lung | Soft tissue” (soft tissue W 400 / L 40).
   - Tools: stack scroll (mouse wheel), window/level (left drag), zoom (right drag), pan (middle drag). Keyboard: Up/Down arrows change slice; announce slice changes to screen readers via an `aria-live="polite"` HUD.
   - HUD (`.nb-viewport__hud`, Geist Mono): “Slice 114 / 247 · 1.25 mm · W 1500 L −600”, values from the live viewport.
4. **Overlay.** Load `mask.nii.gz` (or the DICOM SEG) as a labelmap segmentation. Style: fill `--overlay-finding` at `--overlay-finding-fill-opacity`, outline `--overlay-finding` at 2px. Read the colour from the CSS variables at runtime (`getComputedStyle`) and convert to RGBA for Cornerstone; do not paste hex values into TS.
   - Overlay toggle button: `ak-btn--secondary ak-btn--sm` “Hide outline” / “Show outline”.
   - A label pinned near the nodule (HTML overlay positioned from world → canvas coordinates): “Finding 1 · 9 mm” in Geist Mono, `--viewer-text` on a `--viewer-bg` pill. Values from the manifest.
   - If Phase 2 produced a MedSAM mask, draw it as a second segmentation in `--overlay-reference` and add a legend: “Radiologist consensus” and “AI-assisted segmentation” (with `ak-badge--ai`).
5. **Imperative API.** Expose through a ref or a small store (Zustand is fine):
   - `jumpToFinding(noduleId)`: sets the slice to `manifest.nodules[i].slice_index`, centres and zooms to 2× on the centroid, animates over 320 ms (skip animation when `prefers-reduced-motion`), then briefly pulses the outline (opacity 0.35 → 0.6 → 0.35 over 600 ms).
   - `onSliceChange(cb)` for Phase 6.
6. **Slice-order check (classic bug).** On load, read the SOPInstanceUID (DICOM path) or recompute the max-area slice from the loaded mask (NIfTI path), and assert it equals the manifest’s `slice_index`. If not, show a `ak-alert--danger` in dev mode: “Slice order mismatch: manifest 114, viewer 133.” Fix ordering before moving on.
7. **Card wrapper.** The viewer sits in an `ak-card` titled “Chest CT” with meta “Example patient A · LIDC-IDRI-XXXX” and an `ak-badge--outline` “Pre-computed for demo” whose tooltip says “The nodule outline is the radiologists’ consensus from LIDC-IDRI, prepared offline.”
8. **Loading state.** While the volume loads, show an `ak-progress` (indigo, not spectrum: loading is not AI) with the label “Loading CT” and the percentage. Never show a progress bar for under 400 ms.
9. **Dev route** `/dev/viewer?case=A` loads any case on its own for testing.

## Acceptance checks

- All three cases load; second load of Case A is under 4 s (record timings in `progress.md`).
- `jumpToFinding` lands on the slice where the outline is largest for every case (visual check plus the step 6 assertion), with the nodule centred.
- HUD values change correctly while scrolling; screen reader announces the slice.
- Outline colour comes from CSS variables (grep shows no hex in the viewer code).
- Playwright test: open `/dev/viewer?case=A`, call `jumpToFinding`, assert the HUD shows the manifest slice index.

## Do not

- Put any patient-facing text or the logo inside the dark viewport.
- Use the spectrum anywhere in the viewer: segmentation display is not “AI working”.
