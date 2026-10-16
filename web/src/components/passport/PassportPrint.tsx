"use client";

import { useEffect, useState } from "react";
import { Isolated } from "@/components/report/PatientSummaryCard";
import { SAFETY_BODY, SAFETY_TITLE } from "@/components/shell/SafetyBanner";
import { rehydratePassport, usePassportStore } from "@/features/passport/passportStore";
import type { Locale } from "@/lib/explain";
import { fetchBooking, type BookingRequest, type PassportData } from "@/lib/passport";
import { formatDate, windowText } from "@/lib/recommend";
import "../report/report.css";
import "./passport.css";

interface Injected {
  passport: PassportData;
  booking: Record<Locale, BookingRequest>;
}

declare global {
  interface Window {
    /** Set by the API before the page loads when it renders the PDF. */
    __NB_PASSPORT__?: Injected;
  }
}

/** Print layout of the passport (A4). The API opens this page in headless Chromium; people can also print it themselves. */
export function PassportPrint() {
  const [booking, setBooking] = useState<Record<Locale, BookingRequest> | null>(null);
  const [passport, setPassport] = useState<PassportData | null>(null);
  const [fontsReady, setFontsReady] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const injected = window.__NB_PASSPORT__;
        if (injected) {
          setPassport(injected.passport);
          setBooking(injected.booking);
        } else {
          await rehydratePassport();
          const stored = usePassportStore.getState().passport;
          if (stored) {
            const [en, ar] = await Promise.all((["en", "ar"] as const).map((l) => fetchBooking(stored, l)));
            setPassport(stored);
            setBooking({ en, ar });
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
      await document.fonts.ready;
      setFontsReady(true);
    })();
  }, []);

  const imageReady = !passport?.image_data_url || imageLoaded;

  if (!passport && fontsReady) {
    return (
      <div className="nb-print">
        <p data-testid="print-empty">No passport to print. Create one on the case page first.</p>
      </div>
    );
  }
  if (!passport || !booking) return <div className="nb-print">{error ? <p role="alert">{error}</p> : <p>Preparing the passport.</p>}</div>;

  const rec = passport.recommendation;
  const finding = (passport.finding ?? {}) as { side?: string; lobe?: string; attenuation?: string };
  const windows = rec.options.flatMap((o) => o.actions.map(windowText).filter((t): t is string => t !== null));
  const ready = fontsReady && imageReady;

  return (
    <article className="nb-print" data-print-ready={ready ? "true" : "false"} data-testid="print-root">
      <header className="nb-print__head">
        {/* colour logo on white only (brand rule) */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/asklevia-logo-horizontal.svg" alt="Asklevia" height={28} className="nb-print__logo" />
        <span className="nb-print__product">NoduleBridge</span>
      </header>
      <h1 className="nb-passport__title">Follow-up passport</h1>
      <p className="nb-passport__meta">
        {passport.label} · created {formatDate(passport.created_on)} · example data
      </p>
      <div className="nb-print__safety" role="note">
        <strong>{SAFETY_TITLE}</strong> {SAFETY_BODY}
      </div>

      <section className="nb-print__block">
        <h2>Finding</h2>
        {passport.evidence_quote ? <blockquote className="nb-passport__quote">“{passport.evidence_quote}”</blockquote> : null}
        <p className="nb-passport__values-line">
          {rec.size_mm !== null ? <span>{rec.size_mm} mm</span> : null}
          {finding.side ? <span>{[finding.side, finding.lobe].filter(Boolean).join(" ")}</span> : null}
          {finding.attenuation ? <span>{finding.attenuation.replace("_", " ")}</span> : null}
        </p>
        {passport.image_data_url ? (
          <figure className="nb-passport__figure">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={passport.image_data_url} alt="Chest CT slice with the radiologist consensus outline" onLoad={() => setImageLoaded(true)} onError={() => setImageLoaded(true)} />
            <figcaption>Radiologist consensus outline · {passport.patient_ref ?? passport.label} · example data</figcaption>
          </figure>
        ) : null}
      </section>

      <section className="nb-print__block">
        <h2>Guideline next step</h2>
        <p className="nb-passport__headline-print">{rec.headline}</p>
        {windows.map((w) => (
          <p key={w} className="nb-print__mono">
            {w}
          </p>
        ))}
        <p className="nb-passport__rule">
          Rule <span className="nb-mono-note">{rec.rule_id ?? "none"}</span> · {rec.citation.text}
        </p>
      </section>

      {(["en", "ar"] as const).map((l) => {
        const e = passport.explanation[l];
        return (
          <section key={l} className="nb-print__block" lang={l} dir={l === "ar" ? "rtl" : "ltr"} data-testid={`print-summary-${l}`}>
            {l === "en" ? <h2>Summary</h2> : null}
            <p className="nb-print__draft">{e.review_status.status === "draft" ? (l === "ar" ? "Translation not yet reviewed" : "Text not yet reviewed") : "AI-assisted translation · reviewed"}</p>
            {e.sections.map((s) => (
              <div key={s.key} className="nb-print__section">
                <h3>{s.heading}</h3>
                <p>
                  <Isolated text={s.text} />
                </p>
              </div>
            ))}
          </section>
        );
      })}

      {(["en", "ar"] as const).map((l) => (
        <section key={l} className="nb-print__block nb-print__letter" lang={l} dir={l === "ar" ? "rtl" : "ltr"} data-testid={`print-booking-${l}`}>
          <h2>{booking[l].subject}</h2>
          {booking[l].body.split("\n\n").map((para, i) => (
            <p key={i}>
              <Isolated text={para} />
            </p>
          ))}
        </section>
      ))}

      {passport.attribution ? <p className="nb-print__attribution">{passport.attribution}</p> : null}
    </article>
  );
}
