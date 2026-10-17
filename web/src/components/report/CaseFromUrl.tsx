"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { AnalysisWorkspace } from "./AnalysisWorkspace";

/**
 * Opens the workspace on the study named in ?case= when the page was loaded. It is read ONCE: the app itself rewrites
 * the address bar as studies are opened, and reacting to that would restart the analysis that is running.
 */
export function CaseFromUrl() {
  const params = useSearchParams();
  const [initialCase] = useState(() => params.get("case"));
  return <AnalysisWorkspace initialCase={initialCase} />;
}
