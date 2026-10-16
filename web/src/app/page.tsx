import Link from "next/link";
import { Upload } from "lucide-react";
import { CaseWorkspace } from "@/components/report/CaseWorkspace";
import { caseIdFromParam } from "@/lib/cases";

const EXAMPLES = ["A", "B", "C"] as const;

export default async function CaseWorkspacePage({ searchParams }: { searchParams: Promise<{ case?: string }> }) {
  const { case: param } = await searchParams;
  if (param) {
    const caseId = caseIdFromParam(param);
    return (
      <>
        <h1 className="nb-page__title">Case workspace</h1>
        <CaseWorkspace key={caseId} caseId={caseId} />
      </>
    );
  }
  return (
    <>
      <h1 className="nb-page__title">Case workspace</h1>
      <section className="ak-card" aria-labelledby="start-title">
        <h2 id="start-title" className="ak-card__title">
          CT viewer
        </h2>
        <div className="ak-empty">
          <span className="ak-empty__mark">
            <Upload size={24} strokeWidth={2} aria-hidden="true" />
          </span>
          <p className="ak-empty__title">Upload a chest CT and its report to begin.</p>
          <p className="ak-empty__text">Drop a DICOM folder and a report PDF. Or open an example case built from LIDC-IDRI images.</p>
          <div className="nb-case-picker">
            {EXAMPLES.map((letter) => (
              <Link key={letter} href={`/?case=${letter}`} className="ak-btn ak-btn--secondary">
                Open example patient {letter}
              </Link>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
