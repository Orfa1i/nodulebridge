import { AnalysisWorkspace } from "@/components/report/AnalysisWorkspace";

export default async function CaseWorkspacePage({ searchParams }: { searchParams: Promise<{ case?: string }> }) {
  const { case: param } = await searchParams;
  return <AnalysisWorkspace initialCase={param ?? null} />;
}
