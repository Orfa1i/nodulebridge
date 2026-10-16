import { ViewerCard } from "@/components/viewer/ViewerCard";
import { caseIdFromParam } from "@/lib/cases";

export const metadata = { title: "Viewer · NoduleBridge" };

export default async function DevViewerPage({ searchParams }: { searchParams: Promise<{ case?: string }> }) {
  const { case: param } = await searchParams;
  const caseId = caseIdFromParam(param);
  return (
    <>
      <h1 className="nb-page__title">Viewer test: {caseId}</h1>
      <ViewerCard key={caseId} caseId={caseId} debug />
    </>
  );
}
