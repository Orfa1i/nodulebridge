import { FileCheck } from "lucide-react";

export default function PassportPage() {
  return (
    <>
      <h1 className="nb-page__title">Referral passport</h1>
      <section className="ak-card">
        <div className="ak-empty">
          <span className="ak-empty__mark">
            <FileCheck size={24} strokeWidth={2} aria-hidden="true" />
          </span>
          <p className="ak-empty__title">No passport yet. Analyse a case first.</p>
        </div>
      </section>
    </>
  );
}
