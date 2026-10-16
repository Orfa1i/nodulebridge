import { create } from "zustand";
import type { CaseManifest } from "@/types/generated/case-manifest";

export interface SliceCheck {
  ok: boolean;
  manifest: number;
  viewer: number;
}

/** Imperative API of the mounted viewer. Phase 6 calls these from the report panel. */
export interface ViewerApi {
  /** Go to the nodule's slice, centre and zoom 2x on its centroid, then pulse the outline. */
  jumpToFinding: (noduleId: string) => Promise<void>;
  /** Subscribe to slice changes. The index is 0-based (display number = index + 1). Returns unsubscribe. */
  onSliceChange: (cb: (sliceIndex: number) => void) => () => void;
}

interface ViewerState {
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  progress: number; // 0-100
  caseId: string | null;
  manifest: CaseManifest | null;
  sliceIndex: number;
  sliceCount: number;
  window: { width: number; level: number };
  sliceCheck: SliceCheck | null;
  api: ViewerApi | null;
}

const initial: ViewerState = {
  status: "idle",
  error: null,
  progress: 0,
  caseId: null,
  manifest: null,
  sliceIndex: 0,
  sliceCount: 0,
  window: { width: 0, level: 0 },
  sliceCheck: null,
  api: null,
};

export const useViewerStore = create<ViewerState>(() => ({ ...initial }));

export function resetViewerStore(caseId: string | null): void {
  useViewerStore.setState({ ...initial, caseId, status: caseId ? "loading" : "idle" });
}
