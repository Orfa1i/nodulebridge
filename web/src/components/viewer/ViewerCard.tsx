"use client";

import dynamic from "next/dynamic";
import { useViewerStore } from "@/lib/viewer/store";

// Cornerstone needs window and WebGL, so the viewer is client-only.
const CaseViewer = dynamic(() => import("./CaseViewer").then((m) => m.CaseViewer), {
  ssr: false,
  loading: () => <div className="nb-viewport nb-viewer__viewport" aria-hidden="true" />,
});

export function ViewerCard({ caseId, debug = false }: { caseId: string; debug?: boolean }) {
  const manifest = useViewerStore((s) => s.manifest);
  const meta = manifest ? `${manifest.label} · ${manifest.lidc_patient_id}` : "Loading case";
  return (
    <section className="ak-card" aria-labelledby="viewer-title">
      <div className="ak-card__head nb-viewer-card__head">
        <div>
          <h2 id="viewer-title" className="ak-card__title">
            Chest CT
          </h2>
          <p className="ak-card__meta">{meta}</p>
        </div>
        <span className="nb-tip">
          <span className="ak-badge ak-badge--outline" tabIndex={0} aria-describedby="precomputed-tip">
            Pre-computed for demo
          </span>
          <span id="precomputed-tip" role="tooltip" className="ak-tooltip nb-tip__bubble">
            The nodule outline is the radiologists’ consensus from LIDC-IDRI, prepared offline.
          </span>
        </span>
      </div>
      <CaseViewer caseId={caseId} debug={debug} />
    </section>
  );
}
