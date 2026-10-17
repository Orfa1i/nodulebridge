"use client";

import { useSearchParams } from "next/navigation";
import { ViewerCard } from "@/components/viewer/ViewerCard";
import { caseIdFromParam } from "@/lib/cases";

export function ViewerFromUrl() {
  const caseId = caseIdFromParam(useSearchParams().get("case"));
  return (
    <>
      <h1 className="nb-page__title">Viewer test: {caseId}</h1>
      <ViewerCard key={caseId} caseId={caseId} debug />
    </>
  );
}
