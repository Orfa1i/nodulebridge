import { Check, CircleCheck, Info, OctagonAlert, TriangleAlert, Upload } from "lucide-react";
import type { CSSProperties } from "react";

export const metadata = { title: "Kit · NoduleBridge" };

const vars = (v: Record<string, string>) => v as CSSProperties;

export default function KitPage() {
  return (
    <div className="nb-kit">
      <h1 className="nb-page__title">Asklevia kit — visual check</h1>

      <section className="ak-card" aria-labelledby="k-type">
        <h2 id="k-type" className="ak-card__title">Type</h2>
        <h3>Heading in Funnel Display</h3>
        <p>Body text in Host Grotesk. Short sentences. The finding first, the next step second.</p>
        <p className="nb-mono" data-testid="mono-sample">9 mm · slice 114/247</p>
        <div lang="ar" dir="rtl" data-testid="arabic-sample">
          <p>هذه فقرة تجريبية بالعربية لاختبار الخط والاتجاه.</p>
        </div>
      </section>

      <section className="ak-card" aria-labelledby="k-btn">
        <h2 id="k-btn" className="ak-card__title">Buttons</h2>
        <div className="nb-kit__row">
          <button className="ak-btn ak-btn--primary">Start analysis</button>
          <button className="ak-btn ak-btn--secondary">Upload scan</button>
          <button className="ak-btn ak-btn--ghost">Play summary</button>
          <button className="ak-btn ak-btn--danger">Remove case</button>
          <button className="ak-btn ak-btn--primary ak-btn--sm">Small</button>
          <button className="ak-btn ak-btn--primary" disabled>Disabled</button>
          <button className="ak-btn ak-btn--secondary ak-btn--icon" aria-label="Upload">
            <Upload size={20} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      </section>

      <section className="ak-card" aria-labelledby="k-badge">
        <h2 id="k-badge" className="ak-card__title">Badges</h2>
        <div className="nb-kit__row">
          <span className="ak-badge ak-badge--ai">AI-assisted</span>
          <span className="ak-badge ak-badge--brand">Guideline rule</span>
          <span className="ak-badge ak-badge--outline">Pre-computed for demo</span>
          <span className="ak-badge ak-badge--success">Success</span>
          <span className="ak-badge ak-badge--warning">Warning</span>
          <span className="ak-badge ak-badge--danger">Danger</span>
          <span className="ak-badge ak-badge--info">Info</span>
        </div>
      </section>

      <section className="nb-kit__stack" aria-labelledby="k-alert">
        <h2 id="k-alert" className="ak-card__title">Alerts</h2>
        <div className="ak-alert ak-alert--info" role="status">
          <Info size={20} strokeWidth={2} aria-hidden="true" />
          <div className="ak-alert__body"><p className="ak-alert__title">Info</p><p>Neutral guidance.</p></div>
        </div>
        <div className="ak-alert ak-alert--success" role="status">
          <CircleCheck size={20} strokeWidth={2} aria-hidden="true" />
          <div className="ak-alert__body"><p className="ak-alert__title">Success</p><p>Step finished.</p></div>
        </div>
        <div className="ak-alert ak-alert--warning" role="status">
          <TriangleAlert size={20} strokeWidth={2} aria-hidden="true" />
          <div className="ak-alert__body"><p className="ak-alert__title">Warning</p><p>Confidence is low.</p></div>
        </div>
        <div className="ak-alert ak-alert--danger" role="alert">
          <OctagonAlert size={20} strokeWidth={2} aria-hidden="true" />
          <div className="ak-alert__body"><p className="ak-alert__title">Error</p><p>Report could not be read.</p></div>
        </div>
      </section>

      <section className="ak-card" aria-labelledby="k-prog">
        <h2 id="k-prog" className="ak-card__title">AI progress</h2>
        <div className="ak-progress-field">
          <div className="ak-progress-field__row">
            <span className="ak-progress-field__label">Reading report</span>
            <span className="ak-progress-field__value">60%</span>
          </div>
          <div
            className="ak-progress ak-progress--spectrum"
            role="progressbar"
            aria-valuenow={60}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Reading report"
          >
            <div className="ak-progress__bar" style={vars({ "--value": "60%" })} />
          </div>
        </div>
        <hr className="ak-divider ak-divider--spectrum" />
      </section>

      <section className="ak-card" aria-labelledby="k-steps">
        <h2 id="k-steps" className="ak-card__title">Steps</h2>
        <ol className="ak-steps">
          <li className="ak-step is-complete">
            <span className="ak-step__marker"><Check size={14} strokeWidth={2} aria-hidden="true" /></span>
            <span className="ak-step__title">Upload</span>
          </li>
          <li className="ak-step is-current" aria-current="step">
            <span className="ak-step__marker">2</span>
            <span className="ak-step__title">Analyse</span>
          </li>
          <li className="ak-step">
            <span className="ak-step__marker">3</span>
            <span className="ak-step__title">Review</span>
          </li>
        </ol>
      </section>

      <div className="nb-kit__grid">
        <section className="ak-card" aria-labelledby="k-card">
          <div className="ak-card__head">
            <h2 id="k-card" className="ak-card__title">Card</h2>
            <span className="ak-badge ak-badge--ai">AI-assisted</span>
          </div>
          <p className="ak-card__meta">Example patient A · LIDC-IDRI-XXXX</p>
          <div className="ak-stat">
            <span className="ak-stat__label">Nodule size</span>
            <span className="ak-stat__value">9 mm</span>
          </div>
        </section>

        <section className="ak-card" aria-labelledby="k-conf">
          <h2 id="k-conf" className="ak-card__title">Confidence</h2>
          <ul className="ak-confidence">
            <li className="ak-confidence__row is-top">
              <span className="ak-confidence__label">Solid</span>
              <span className="ak-confidence__track">
                <span className="ak-confidence__fill" style={vars({ "--p": "82%" })} />
              </span>
              <span className="ak-confidence__value">0.82</span>
            </li>
            <li className="ak-confidence__row">
              <span className="ak-confidence__label">Part-solid</span>
              <span className="ak-confidence__track">
                <span className="ak-confidence__fill" style={vars({ "--p": "12%" })} />
              </span>
              <span className="ak-confidence__value">0.12</span>
            </li>
          </ul>
        </section>
      </div>

      <section className="ak-card" aria-labelledby="k-tabs">
        <h2 id="k-tabs" className="ak-card__title">Tabs</h2>
        <div className="ak-tabs" role="tablist" aria-label="Sample tabs">
          <button className="ak-tab" role="tab" aria-selected="true">English</button>
          <button className="ak-tab" role="tab" aria-selected="false">Arabic</button>
        </div>
      </section>

      <section className="ak-card" aria-labelledby="k-up">
        <h2 id="k-up" className="ak-card__title">Upload zone and viewport</h2>
        <div className="ak-dropzone" tabIndex={0} role="button" aria-label="Upload scan">
          <span className="ak-dropzone__icon"><Upload size={22} strokeWidth={2} aria-hidden="true" /></span>
          <p className="ak-dropzone__title"><b>Upload scan</b> or drop a DICOM folder</p>
          <p className="ak-dropzone__meta">DICOM series, one chest CT</p>
        </div>
        <div className="nb-viewport nb-viewport--sample">
          <span className="nb-viewport__hud">slice 114/247</span>
        </div>
      </section>
    </div>
  );
}
