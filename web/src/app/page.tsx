import { FileText, ScanLine, Upload } from "lucide-react";

function EmptyState({ icon, title, text }: { icon: React.ReactNode; title: string; text?: string }) {
  return (
    <div className="ak-empty">
      <span className="ak-empty__mark">{icon}</span>
      <p className="ak-empty__title">{title}</p>
      {text ? <p className="ak-empty__text">{text}</p> : null}
    </div>
  );
}

export default function CaseWorkspace() {
  return (
    <>
      <h1 className="nb-page__title">Case workspace</h1>
      <div className="nb-workspace">
        <section className="nb-workspace__viewer ak-card" aria-labelledby="viewer-title">
          <div className="ak-card__head">
            <h2 id="viewer-title" className="ak-card__title">CT viewer</h2>
          </div>
          <EmptyState
            icon={<Upload size={24} strokeWidth={2} aria-hidden="true" />}
            title="Upload a chest CT and its report to begin."
            text="Drop a DICOM folder and a report PDF. Example cases use LIDC-IDRI images only."
          />
        </section>
        <div className="nb-workspace__side">
          <section className="ak-card" aria-labelledby="report-title">
            <div className="ak-card__head">
              <h2 id="report-title" className="ak-card__title">Radiology report</h2>
            </div>
            <EmptyState
              icon={<FileText size={24} strokeWidth={2} aria-hidden="true" />}
              title="No report yet"
              text="The nodule sentence will be highlighted here."
            />
          </section>
          <section className="ak-card" aria-labelledby="findings-title">
            <div className="ak-card__head">
              <h2 id="findings-title" className="ak-card__title">Findings</h2>
            </div>
            <EmptyState
              icon={<ScanLine size={24} strokeWidth={2} aria-hidden="true" />}
              title="No findings yet"
              text="Nodule size, location and the guideline next step appear here."
            />
          </section>
        </div>
      </div>
    </>
  );
}
