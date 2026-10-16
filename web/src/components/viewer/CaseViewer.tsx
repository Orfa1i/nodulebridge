"use client";

import "./viewer.css";
import {
  Enums,
  RenderingEngine,
  eventTarget,
  setVolumesForViewports,
  volumeLoader,
  type Types,
} from "@cornerstonejs/core";
import { Enums as NiftiEnums, createNiftiImageIdsAndCacheMetadata } from "@cornerstonejs/nifti-volume-loader";
import * as csTools from "@cornerstonejs/tools";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { caseUrls, fetchManifest, worldOnSlice, worldToSliceIndex, sliceSpacing } from "@/lib/cases";
import { initCornerstone } from "@/lib/viewer/cornerstone";
import { cssColorRgba255, cssColorUnit, cssNumber, prefersReducedMotion } from "@/lib/viewer/css";
import { resetViewerStore, useViewerStore, type ViewerApi } from "@/lib/viewer/store";
import type { CaseManifest } from "@/types/generated/case-manifest";

const { ToolGroupManager, segmentation, Enums: csToolsEnums } = csTools;
const VOLUME_SCHEME = "cornerstoneStreamingImageVolume";
const WINDOWS = {
  lung: { width: 1500, level: -600, label: "Lung" },
  soft: { width: 400, level: 40, label: "Soft tissue" },
} as const;
type WindowKey = keyof typeof WINDOWS;
const MIN_PROGRESS_MS = 400; // never flash a progress bar for a short load
const JUMP_MS = 320;
const PULSE_MS = 600;
const PULSE_PEAK_ALPHA = 0.6;

type Vec3 = [number, number, number];
let instanceCounter = 0;

const ease = (t: number) => 1 - Math.pow(1 - t, 4); // approximates cubic-bezier(0.2, 0.8, 0.2, 1)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function raf(): Promise<number> {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

export interface CaseViewerProps {
  caseId: string;
  /** Called when the user activates the finding label in the viewer (click, Enter or Space). */
  onFindingClick?: (noduleId: string) => void;
  /** Dev and test only: expose the imperative API on window.__nbViewer. */
  debug?: boolean;
}

export function CaseViewer({ caseId, debug = false, onFindingClick }: CaseViewerProps) {
  const elementRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLButtonElement>(null);
  const viewportRef = useRef<Types.IVolumeViewport | null>(null);
  const segIdRef = useRef<string>("");
  const manifestRef = useRef<CaseManifest | null>(null);
  const maskRangeRef = useRef<[number, number]>([0, 0]);
  const listenersRef = useRef(new Set<(i: number) => void>());
  const aliveRef = useRef(true);
  const baseScaleRef = useRef(1);
  const outlineOnRef = useRef(true);

  const [windowKey, setWindowKey] = useState<WindowKey>("lung");
  const [outlineOn, setOutlineOn] = useState(true);
  const [showProgress, setShowProgress] = useState(false);
  const [announce, setAnnounce] = useState("");

  const status = useViewerStore((s) => s.status);
  const error = useViewerStore((s) => s.error);
  const progress = useViewerStore((s) => s.progress);
  const manifest = useViewerStore((s) => s.manifest);
  const sliceIndex = useViewerStore((s) => s.sliceIndex);
  const sliceCount = useViewerStore((s) => s.sliceCount);
  const win = useViewerStore((s) => s.window);
  const sliceCheck = useViewerStore((s) => s.sliceCheck);

  // ----- HUD and label, driven by the live viewport -----
  const refreshHud = useCallback(() => {
    const vp = viewportRef.current;
    const m = manifestRef.current;
    if (!vp || !m) return;
    const camera = vp.getCamera();
    const idx = worldToSliceIndex(m, camera.focalPoint as Vec3);
    const voi = vp.getProperties()?.voiRange;
    const prev = useViewerStore.getState();
    useViewerStore.setState({
      sliceIndex: idx,
      window: voi
        ? { width: Math.round(voi.upper - voi.lower), level: Math.round((voi.upper + voi.lower) / 2) }
        : prev.window,
    });
    if (idx !== prev.sliceIndex) listenersRef.current.forEach((cb) => cb(idx));

    const label = labelRef.current;
    const nodule = m.nodules[0];
    if (label && nodule) {
      const [lo, hi] = maskRangeRef.current;
      if (idx >= lo && idx <= hi) {
        const canvas = vp.worldToCanvas(worldOnSlice(m, nodule.centroid_mm, idx));
        const el = elementRef.current;
        const w = el?.clientWidth ?? 0;
        const h = el?.clientHeight ?? 0;
        const x = Math.min(Math.max(canvas[0] + 14, 4), Math.max(w - label.offsetWidth - 4, 4));
        const y = Math.min(Math.max(canvas[1] - 34, 4), Math.max(h - label.offsetHeight - 4, 4));
        label.style.transform = `translate(${x}px, ${y}px)`;
        label.style.visibility = "visible";
      } else {
        label.style.visibility = "hidden";
      }
    }
  }, []);

  // Debounced mirror for assistive tech: announces the slice once scrolling settles.
  useEffect(() => {
    if (status !== "ready" || !sliceCount) return;
    const t = window.setTimeout(() => setAnnounce(`Slice ${sliceIndex + 1} of ${sliceCount}`), 350);
    return () => window.clearTimeout(t);
  }, [sliceIndex, sliceCount, status]);

  // Reveal the progress bar only if loading takes longer than the minimum.
  useEffect(() => {
    if (status !== "loading") return;
    const t = window.setTimeout(() => setShowProgress(true), MIN_PROGRESS_MS);
    return () => {
      window.clearTimeout(t);
      setShowProgress(false);
    };
  }, [status, caseId]);

  // ----- load the case -----
  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    let cancelled = false;
    aliveRef.current = true;
    const id = ++instanceCounter;
    const engineId = `nb-engine-${id}`;
    const viewportId = `nb-axial-${id}`;
    const toolGroupId = `nb-tools-${id}`;
    const segmentationId = `nb-mask-${caseId}-${id}`;
    const cleanups: Array<() => void> = [];
    resetViewerStore(caseId);
    manifestRef.current = null;
    viewportRef.current = null;

    (async () => {
      try {
        const [m] = await Promise.all([fetchManifest(caseId), initCornerstone()]);
        if (cancelled) return;
        manifestRef.current = m;
        useViewerStore.setState({ manifest: m, sliceCount: m.geometry.dims[2] });
        const urls = caseUrls(caseId, m);
        const ctVolumeId = `${VOLUME_SCHEME}:${urls.ct}`;
        const maskVolumeId = `${VOLUME_SCHEME}:${urls.mask}`;

        // progress across CT and mask downloads (events carry no url, so key by total size)
        const seen = new Map<number, number>();
        const onProgress = (evt: Event) => {
          const data = (evt as CustomEvent).detail?.data as { total?: number; loaded?: number } | undefined;
          if (!data?.total) return;
          seen.set(data.total, data.loaded ?? 0);
          let total = 0;
          let loaded = 0;
          seen.forEach((l, t) => {
            total += t;
            loaded += l;
          });
          useViewerStore.setState({ progress: Math.min(100, Math.round((loaded / total) * 100)) });
        };
        eventTarget.addEventListener(NiftiEnums.Events.NIFTI_VOLUME_PROGRESS, onProgress);
        cleanups.push(() => eventTarget.removeEventListener(NiftiEnums.Events.NIFTI_VOLUME_PROGRESS, onProgress));

        const [ctIds, maskIds] = await Promise.all([
          createNiftiImageIdsAndCacheMetadata({ url: urls.ct }),
          createNiftiImageIdsAndCacheMetadata({ url: urls.mask }),
        ]);
        const ctVolume = await volumeLoader.createAndCacheVolume(ctVolumeId, { imageIds: ctIds });
        const maskVolume = await volumeLoader.createAndCacheVolume(maskVolumeId, { imageIds: maskIds });
        await Promise.all([ctVolume.load(), maskVolume.load()]);
        if (cancelled) return;

        // viewport
        const engine = new RenderingEngine(engineId);
        cleanups.push(() => engine.destroy());
        engine.setViewports([
          {
            viewportId,
            type: Enums.ViewportType.ORTHOGRAPHIC,
            element,
            defaultOptions: {
              orientation: Enums.OrientationAxis.AXIAL,
              background: cssColorUnit("--viewer-bg") as Types.Point3,
            },
          },
        ]);
        const toolGroup = ToolGroupManager.createToolGroup(toolGroupId)!;
        cleanups.push(() => ToolGroupManager.destroyToolGroup(toolGroupId));
        toolGroup.addTool(csTools.WindowLevelTool.toolName);
        toolGroup.addTool(csTools.ZoomTool.toolName);
        toolGroup.addTool(csTools.PanTool.toolName);
        toolGroup.addTool(csTools.StackScrollTool.toolName);
        const { MouseBindings } = csToolsEnums;
        toolGroup.setToolActive(csTools.WindowLevelTool.toolName, { bindings: [{ mouseButton: MouseBindings.Primary }] });
        toolGroup.setToolActive(csTools.ZoomTool.toolName, { bindings: [{ mouseButton: MouseBindings.Secondary }] });
        toolGroup.setToolActive(csTools.PanTool.toolName, { bindings: [{ mouseButton: MouseBindings.Auxiliary }] });
        toolGroup.setToolActive(csTools.StackScrollTool.toolName, { bindings: [{ mouseButton: MouseBindings.Wheel }] });
        toolGroup.addViewport(viewportId, engineId);
        await setVolumesForViewports(engine, [{ volumeId: ctVolumeId }], [viewportId]);
        if (cancelled) return;
        const viewport = engine.getViewport(viewportId) as Types.IVolumeViewport;
        viewportRef.current = viewport;

        // labelmap from the exported mask (same geometry as the CT, so scalar data lines up)
        const labelVolume = volumeLoader.createAndCacheDerivedLabelmapVolume(ctVolumeId, { volumeId: segmentationId });
        const maskVm = maskVolume.voxelManager!;
        const src = (maskVm.getCompleteScalarDataArray?.() ?? maskVm.getScalarData()) as ArrayLike<number>;
        const labelVm = labelVolume.voxelManager!;
        const labels = new Uint8Array(src.length);
        for (let i = 0; i < src.length; i++) labels[i] = src[i] > 0 ? 1 : 0;
        if (labelVm.setCompleteScalarDataArray) {
          labelVm.setCompleteScalarDataArray(labels);
        } else {
          for (let i = 0; i < labels.length; i++) labelVm.setAtIndex(i, labels[i]);
        }

        segmentation.addSegmentations([
          {
            segmentationId,
            representation: {
              type: csToolsEnums.SegmentationRepresentations.Labelmap,
              data: { volumeId: segmentationId },
            },
          },
        ]);
        const findingColor = cssColorRgba255("--overlay-finding");
        await segmentation.addSegmentationRepresentations(viewportId, [
          {
            segmentationId,
            type: csToolsEnums.SegmentationRepresentations.Labelmap,
            config: { colorLUTOrIndex: [[0, 0, 0, 0], findingColor] },
          },
        ]);
        const fillAlpha = cssNumber("--overlay-finding-fill-opacity", 0.35);
        segmentation.segmentationStyle.setStyle(
          { type: csToolsEnums.SegmentationRepresentations.Labelmap, segmentationId },
          { renderFill: true, renderOutline: true, fillAlpha, outlineWidth: 2, outlineOpacity: 1 },
        );
        segIdRef.current = segmentationId;
        cleanups.push(() => {
          segmentation.removeSegmentationRepresentations(viewportId, { segmentationId });
          segmentation.removeSegmentation(segmentationId);
        });
        segmentation.triggerSegmentationEvents.triggerSegmentationDataModified(segmentationId);

        // window
        const w = WINDOWS.lung;
        viewport.setProperties({ voiRange: { lower: w.level - w.width / 2, upper: w.level + w.width / 2 } });
        viewport.render();
        baseScaleRef.current = viewport.getCamera().parallelScale ?? 1;

        // slice-order check: where does the mask's largest slice sit in the manifest's own geometry?
        const [cols, rows, slices] = maskVolume.dimensions;
        const perSlice = cols * rows;
        let best = -1;
        let bestArea = -1;
        let first = -1;
        let last = -1;
        for (let k = 0; k < slices; k++) {
          let area = 0;
          for (let j = 0; j < perSlice; j++) if (src[k * perSlice + j] > 0) area++;
          if (area > bestArea) {
            bestArea = area;
            best = k;
          }
          if (area > 0) {
            if (first < 0) first = k;
            last = k;
          }
        }
        const imageData = maskVolume.imageData as unknown as {
          indexToWorld: (ijk: number[], out?: number[]) => number[];
        };
        const displayOf = (k: number) => worldToSliceIndex(m, imageData.indexToWorld([cols / 2, rows / 2, k]));
        const viewerSlice = displayOf(best);
        const manifestSlice = m.nodules[0].slice_index;
        const range = [displayOf(first), displayOf(last)].sort((a, b) => a - b) as [number, number];
        maskRangeRef.current = range;
        useViewerStore.setState({ maskRange: range });
        const ok = viewerSlice === manifestSlice;
        useViewerStore.setState({ sliceCheck: { ok, manifest: manifestSlice, viewer: viewerSlice } });
        if (!ok) console.error(`Slice order mismatch: manifest ${manifestSlice}, viewer ${viewerSlice}.`);

        // events
        const onCamera = () => refreshHud();
        element.addEventListener(Enums.Events.CAMERA_MODIFIED, onCamera);
        element.addEventListener(Enums.Events.VOI_MODIFIED, onCamera);
        cleanups.push(() => {
          element.removeEventListener(Enums.Events.CAMERA_MODIFIED, onCamera);
          element.removeEventListener(Enums.Events.VOI_MODIFIED, onCamera);
        });
        const ro = new ResizeObserver(() => {
          engine.resize(true, true); // keep the slice, zoom and pan when the window changes size
          refreshHud();
        });
        ro.observe(element);
        cleanups.push(() => ro.disconnect());

        // imperative API
        const api: ViewerApi = {
          jumpToFinding: (noduleId) => jumpToFinding(noduleId),
          onSliceChange: (cb) => {
            listenersRef.current.add(cb);
            return () => listenersRef.current.delete(cb);
          },
        };
        useViewerStore.setState({ api, status: "ready", progress: 100 });
        if (debug) {
          const debugState = () => {
            const centroid = worldOnSlice(m, m.nodules[0].centroid_mm, worldToSliceIndex(m, viewport.getCamera().focalPoint as Vec3));
            const c = viewport.worldToCanvas(centroid);
            return {
              centroidCanvas: [c[0], c[1]],
              canvasSize: [element.clientWidth, element.clientHeight],
              parallelScale: viewport.getCamera().parallelScale,
              baseParallelScale: baseScaleRef.current,
              fillAlpha: (segmentation.segmentationStyle.getStyle({
                type: csToolsEnums.SegmentationRepresentations.Labelmap,
                segmentationId,
              }) as { fillAlpha?: number }).fillAlpha,
            };
          };
          (window as unknown as { __nbViewer?: unknown }).__nbViewer = { ...api, debugState };
        }
        cleanups.push(() => {
          useViewerStore.setState({ api: null });
          if (debug) delete (window as unknown as { __nbViewer?: unknown }).__nbViewer;
        });
        refreshHud();
      } catch (err) {
        if (cancelled) return;
        console.error(err);
        useViewerStore.setState({ status: "error", error: err instanceof Error ? err.message : String(err) });
      }
    })();

    return () => {
      cancelled = true;
      aliveRef.current = false; // stops any running camera or pulse animation
      cleanups.reverse().forEach((fn) => {
        try {
          fn();
        } catch (e) {
          console.warn("viewer cleanup", e);
        }
      });
      viewportRef.current = null;
    };
    // jumpToFinding only reads refs, so it is safe to leave out of the dependency list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId, debug, refreshHud]);

  // ----- camera helpers -----
  const animateCamera = useCallback(async (focal: Vec3, parallelScale: number, ms: number) => {
    const vp = viewportRef.current;
    if (!vp) return;
    const cam = vp.getCamera();
    const f0 = cam.focalPoint as Vec3;
    const p0 = cam.position as Vec3;
    const s0 = cam.parallelScale ?? parallelScale;
    const offset: Vec3 = [p0[0] - f0[0], p0[1] - f0[1], p0[2] - f0[2]];
    const apply = (t: number) => {
      const f: Vec3 = [lerp(f0[0], focal[0], t), lerp(f0[1], focal[1], t), lerp(f0[2], focal[2], t)];
      vp.setCamera({
        focalPoint: f,
        position: [f[0] + offset[0], f[1] + offset[1], f[2] + offset[2]],
        parallelScale: lerp(s0, parallelScale, t),
      });
      vp.render();
    };
    if (ms <= 0 || prefersReducedMotion()) {
      apply(1);
      return;
    }
    const start = performance.now();
    for (;;) {
      const now = await raf();
      if (!aliveRef.current) return;
      const t = Math.min(1, (now - start) / ms);
      apply(ease(t));
      if (t >= 1) break;
    }
  }, []);

  const setFillAlpha = useCallback((alpha: number) => {
    segmentation.segmentationStyle.setStyle(
      { type: csToolsEnums.SegmentationRepresentations.Labelmap, segmentationId: segIdRef.current },
      { fillAlpha: alpha },
      true,
    );
    viewportRef.current?.render();
  }, []);

  const pulse = useCallback(async () => {
    if (prefersReducedMotion() || !outlineOnRef.current) return;
    const base = cssNumber("--overlay-finding-fill-opacity", 0.35);
    const start = performance.now();
    for (;;) {
      const now = await raf();
      if (!aliveRef.current) return;
      const t = Math.min(1, (now - start) / PULSE_MS);
      const tri = t < 0.5 ? t * 2 : (1 - t) * 2; // up then down
      setFillAlpha(lerp(base, PULSE_PEAK_ALPHA, tri));
      if (t >= 1) break;
    }
    setFillAlpha(base);
  }, [setFillAlpha]);

  const jumpToFinding = useCallback(
    async (noduleId: string) => {
      const m = manifestRef.current;
      const vp = viewportRef.current;
      if (!m || !vp) throw new Error("Viewer is not ready");
      const nodule = m.nodules.find((n) => n.id === noduleId);
      if (!nodule) throw new Error(`Unknown nodule ${noduleId}`);
      const target = worldOnSlice(m, nodule.centroid_mm, nodule.slice_index);
      await animateCamera(target, baseScaleRef.current / 2, JUMP_MS);
      refreshHud();
      void pulse();
    },
    [animateCamera, pulse, refreshHud],
  );

  const goToSlice = useCallback(
    (index: number) => {
      const m = manifestRef.current;
      const vp = viewportRef.current;
      if (!m || !vp) return;
      const clamped = Math.min(m.geometry.dims[2] - 1, Math.max(0, index));
      const cam = vp.getCamera();
      const focal = worldOnSlice(m, cam.focalPoint as Vec3, clamped);
      void animateCamera(focal, cam.parallelScale ?? baseScaleRef.current, 0);
    },
    [animateCamera],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      goToSlice(useViewerStore.getState().sliceIndex + (e.key === "ArrowUp" ? 1 : -1));
    }
  };

  const applyWindow = (key: WindowKey) => {
    setWindowKey(key);
    const vp = viewportRef.current;
    if (!vp) return;
    const w = WINDOWS[key];
    vp.setProperties({ voiRange: { lower: w.level - w.width / 2, upper: w.level + w.width / 2 } });
    vp.render();
  };

  const toggleOutline = () => {
    const next = !outlineOn;
    setOutlineOn(next);
    outlineOnRef.current = next;
    segmentation.segmentationStyle.setStyle(
      { type: csToolsEnums.SegmentationRepresentations.Labelmap, segmentationId: segIdRef.current },
      { renderFill: next, renderOutline: next },
      true,
    );
    viewportRef.current?.render();
  };

  // ----- render -----
  const spacingText = manifest ? `${+sliceSpacing(manifest).toFixed(2)} mm` : "";
  const hud =
    status === "ready" && manifest
      ? `Slice ${sliceIndex + 1} / ${sliceCount} · ${spacingText} · W ${win.width} L ${win.level}`
      : "";
  const nodule = manifest?.nodules[0];

  return (
    <div className="nb-viewer" data-viewer-status={status} data-case={caseId}>
      <div className="nb-viewer__toolbar">
        <div className="ak-seg" role="group" aria-label="Window preset">
          {(Object.keys(WINDOWS) as WindowKey[]).map((key) => (
            <button
              key={key}
              type="button"
              className="ak-seg__item"
              aria-pressed={windowKey === key}
              onClick={() => applyWindow(key)}
              disabled={status !== "ready"}
            >
              {WINDOWS[key].label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="ak-btn ak-btn--secondary ak-btn--sm"
          onClick={toggleOutline}
          disabled={status !== "ready"}
        >
          {outlineOn ? "Hide outline" : "Show outline"}
        </button>
      </div>

      <div
        className="nb-viewport nb-viewer__viewport"
        tabIndex={0}
        role="group"
        aria-label="CT viewer. Use the up and down arrow keys to change slice."
        onKeyDown={onKeyDown}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div ref={elementRef} className="nb-viewer__canvas" data-testid="viewer-canvas" />
        <div className="nb-viewport__hud" data-testid="viewer-hud">
          {hud}
        </div>
        <button
          ref={labelRef}
          type="button"
          className="nb-viewer__label"
          style={{ visibility: "hidden" }}
          data-testid="finding-label"
          aria-label={nodule ? `Finding 1, ${nodule.fleischner_size_mm} mm. Show the matching sentence in the report.` : undefined}
          onClick={() => nodule && onFindingClick?.(nodule.id)}
        >
          {nodule ? `Finding 1 · ${nodule.fleischner_size_mm} mm` : ""}
        </button>
        {status === "loading" && showProgress ? (
          <div className="nb-viewer__loading">
            <div className="ak-progress-field">
              <div className="ak-progress-field__row">
                <span className="ak-progress-field__label nb-viewer__loading-label">Loading CT</span>
                <span className="ak-progress-field__value nb-viewer__loading-label">{progress}%</span>
              </div>
              <div className="ak-progress" role="progressbar" aria-label="Loading CT" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
                <div className="ak-progress__bar" style={{ width: `${progress}%` }} />
              </div>
            </div>
          </div>
        ) : null}
        {status === "error" ? (
          <div className="nb-viewer__loading">
            <div className="ak-alert ak-alert--danger" role="alert">
              <div className="ak-alert__body">
                <p className="ak-alert__title">Could not load the CT</p>
                <p>{error}</p>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="ak-visually-hidden" role="status" aria-live="polite" data-testid="viewer-announce">
        {announce}
      </div>

      {process.env.NODE_ENV !== "production" && sliceCheck && !sliceCheck.ok ? (
        <div className="ak-alert ak-alert--danger" role="alert">
          <div className="ak-alert__body">
            <p className="ak-alert__title">
              Slice order mismatch: manifest {sliceCheck.manifest}, viewer {sliceCheck.viewer}.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
