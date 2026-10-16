"use client";

import { Calendar, Copy, Download, FileCheck, FileJson, MessageCircle, Printer, Users } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Isolated, PatientSummaryCard } from "@/components/report/PatientSummaryCard";
import { SAFETY_BODY, SAFETY_TITLE } from "@/components/shell/SafetyBanner";
import { rehydrateAnalysis } from "@/features/analysis/store";
import { rehydratePassport, usePassportStore } from "@/features/passport/passportStore";
import type { Locale } from "@/lib/explain";
import { download, fetchBooking, mockWhatsApp, PassportError, type BookingRequest, type DownloadKind } from "@/lib/passport";
import { formatDate, windowText } from "@/lib/recommend";
import "../report/report.css";
import "./passport.css";

type Notice = { tone: "success" | "danger" | "info"; title: string; detail?: string | null } | null;

const LABEL: Record<DownloadKind, string> = { pdf: "passport PDF", fhir: "FHIR summary", ics: "calendar reminders", "ics-caregiver": "caregiver reminders" };

export function PassportView() {
  const passport = usePassportStore((s) => s.passport);
  const [ready, setReady] = useState(false);
  const [booking, setBooking] = useState<Partial<Record<Locale, BookingRequest>>>({});
  const [bookingLocale, setBookingLocale] = useState<Locale>("en");
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => {
    void (async () => {
      await Promise.all([rehydratePassport(), rehydrateAnalysis()]);
      setReady(true);
    })();
  }, []);

  useEffect(() => {
    if (!passport) return;
    let cancelled = false;
    void Promise.all((["en", "ar"] as const).map((l) => fetchBooking(passport, l))).then(
      ([en, ar]) => {
        if (!cancelled) setBooking({ en, ar });
      },
      (err: unknown) => {
        if (!cancelled) setBookingError(err instanceof Error ? err.message : String(err));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [passport]);

  const run = useCallback(
    async (kind: DownloadKind) => {
      if (!passport) return;
      setBusy(kind);
      setNotice(null);
      try {
        await download(kind, passport, bookingLocale);
        setNotice({ tone: "success", title: `Downloaded the ${LABEL[kind]}.` });
      } catch (err) {
        const e = err as PassportError;
        setNotice({ tone: "danger", title: e.message, detail: e.detail });
      } finally {
        setBusy(null);
      }
    },
    [passport, bookingLocale],
  );

  const copy = useCallback(async () => {
    const text = booking[bookingLocale]?.body;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setNotice({ tone: "success", title: "Message copied." });
    } catch {
      setNotice({ tone: "danger", title: "Your browser did not allow copying.", detail: "Select the message and copy it by hand." });
    }
  }, [booking, bookingLocale]);

  const whatsapp = useCallback(async () => {
    const message = booking[bookingLocale]?.body;
    if (!passport || !message) return;
    setBusy("whatsapp");
    try {
      await mockWhatsApp(message, bookingLocale, passport.label);
      setNotice({ tone: "info", title: "Reminder scheduled (mock — nothing was sent)" });
    } catch (err) {
      const e = err as PassportError;
      setNotice({ tone: "danger", title: e.message, detail: e.detail });
    } finally {
      setBusy(null);
    }
  }, [booking, bookingLocale, passport]);

  if (!ready) return <h1 className="nb-page__title">Referral passport</h1>;

  if (!passport) {
    return (
      <>
        <h1 className="nb-page__title">Referral passport</h1>
        <section className="ak-card" data-testid="passport-empty">
          <div className="ak-empty">
            <span className="ak-empty__mark">
              <FileCheck size={24} strokeWidth={2} aria-hidden="true" />
            </span>
            <p className="ak-empty__title">No passport yet. Analyse a case first.</p>
            <p className="ak-empty__text">Open a case, wait for the summary, then choose Create follow-up passport.</p>
            <Link href="/" className="ak-btn ak-btn--secondary">
              Go to the case workspace
            </Link>
            {notice ? <p role="status">{notice.title}</p> : null}
          </div>
        </section>
      </>
    );
  }

  const rec = passport.recommendation;
  const finding = (passport.finding ?? {}) as { side?: string; lobe?: string; attenuation?: string };
  const windows = rec.options.flatMap((o) => o.actions.map(windowText).filter((t): t is string => t !== null));
  const current = booking[bookingLocale];

  return (
    <div className="nb-passport" data-testid="passport">
      <section className="ak-card" aria-labelledby="passport-title">
        <div className="ak-card__head">
          <h1 id="passport-title" className="nb-passport__title">
            Follow-up passport
          </h1>
          <span className="ak-badge ak-badge--outline">Example data</span>
        </div>
        <p className="nb-passport__meta" data-testid="passport-meta">
          {passport.label} · created {formatDate(passport.created_on)}
        </p>
        <div className="ak-alert ak-alert--info" role="note">
          <div className="ak-alert__body">
            <p className="ak-alert__title">{SAFETY_TITLE}</p>
            <p>{SAFETY_BODY}</p>
          </div>
        </div>
      </section>

      <div className="nb-passport__grid">
        <section className="ak-card" aria-labelledby="pp-finding">
          <h2 id="pp-finding" className="ak-card__title">
            Finding
          </h2>
          {passport.evidence_quote ? (
            <blockquote className="nb-passport__quote" data-testid="passport-quote">
              “{passport.evidence_quote}”
            </blockquote>
          ) : null}
          <dl className="nb-passport__values">
            {rec.size_mm !== null ? (
              <div>
                <dt>Size</dt>
                <dd data-testid="passport-size">{rec.size_mm} mm</dd>
              </div>
            ) : null}
            {finding.side ? (
              <div>
                <dt>Location</dt>
                <dd>{[finding.side, finding.lobe].filter(Boolean).join(" ")}</dd>
              </div>
            ) : null}
            {finding.attenuation ? (
              <div>
                <dt>Type</dt>
                <dd>{finding.attenuation.replace("_", " ")}</dd>
              </div>
            ) : null}
          </dl>
          {passport.image_data_url ? (
            <figure className="nb-passport__figure">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={passport.image_data_url} alt="Chest CT slice with the radiologist consensus outline around the nodule" data-testid="passport-image" />
              <figcaption>Radiologist consensus outline · {passport.patient_ref ?? passport.label} · example data</figcaption>
            </figure>
          ) : null}
        </section>

        <section className="ak-card" aria-labelledby="pp-next">
          <div className="ak-card__head">
            <h2 id="pp-next" className="ak-card__title">
              Guideline next step
            </h2>
            <span className="ak-badge ak-badge--brand">Guideline rule</span>
          </div>
          <p className="nb-nextstep__headline" data-testid="passport-headline">
            {rec.headline}
          </p>
          {windows.map((w) => (
            <p key={w} className="nb-nextstep__window">
              {w}
            </p>
          ))}
          <p className="nb-passport__rule" data-testid="passport-rule">
            Rule <span className="nb-mono-note">{rec.rule_id ?? "none"}</span> · {rec.citation.text}
          </p>
        </section>
      </div>

      <PatientSummaryCard explanation={passport.explanation} error={null} loading={false} caseId={passport.case_id} />

      <section className="ak-card" aria-labelledby="pp-booking">
        <div className="ak-card__head">
          <h2 id="pp-booking" className="ak-card__title">
            Booking request
          </h2>
          <div className="ak-seg" role="group" aria-label="Message language">
            {(["en", "ar"] as const).map((l) => (
              <button key={l} type="button" className="ak-seg__item" aria-pressed={bookingLocale === l} onClick={() => setBookingLocale(l)} lang={l} data-testid={`booking-lang-${l}`}>
                {l === "en" ? "English" : "العربية"}
              </button>
            ))}
          </div>
        </div>
        {bookingError ? (
          <div className="ak-alert ak-alert--danger" role="alert">
            <div className="ak-alert__body">
              <p className="ak-alert__title">The booking request could not be prepared.</p>
              <p>{bookingError}</p>
            </div>
          </div>
        ) : null}
        {current ? (
          <>
            <div className="nb-passport__meta-row">
              {current.review_status.status === "draft" ? (
                <span className="ak-badge ak-badge--warning" data-testid="booking-draft">
                  {bookingLocale === "ar" ? "Translation not yet reviewed" : "Text not yet reviewed"}
                </span>
              ) : (
                <span className="ak-badge ak-badge--ai">AI-assisted translation · reviewed</span>
              )}
            </div>
            <div className="nb-passport__message" lang={bookingLocale} dir={bookingLocale === "ar" ? "rtl" : "ltr"} data-testid="booking-body">
              {current.body.split("\n\n").map((para, i) => (
                <p key={i}>
                  <Isolated text={para} />
                </p>
              ))}
            </div>
            <div>
              <button type="button" className="ak-btn ak-btn--secondary" onClick={() => void copy()} data-testid="copy-message">
                <Copy aria-hidden="true" />
                Copy message
              </button>
            </div>
          </>
        ) : bookingError ? null : (
          <p className="nb-finding__note">Preparing the message.</p>
        )}
      </section>

      <section className="ak-card" aria-labelledby="pp-actions">
        <h2 id="pp-actions" className="ak-card__title">
          Take it with you
        </h2>
        <div className="nb-passport__actions">
          <button type="button" className="ak-btn ak-btn--primary" onClick={() => void run("pdf")} disabled={busy !== null} data-testid="dl-pdf">
            <Download aria-hidden="true" />
            {busy === "pdf" ? "Making the PDF" : "Download passport (PDF)"}
          </button>
          <button type="button" className="ak-btn ak-btn--secondary" onClick={() => void run("fhir")} disabled={busy !== null} data-testid="dl-fhir">
            <FileJson aria-hidden="true" />
            Download FHIR summary
          </button>
          <button type="button" className="ak-btn ak-btn--secondary" onClick={() => void run("ics")} disabled={busy !== null} data-testid="dl-ics">
            <Calendar aria-hidden="true" />
            Add reminders to calendar
          </button>
          <button type="button" className="ak-btn ak-btn--secondary" onClick={() => void run("ics-caregiver")} disabled={busy !== null} data-testid="dl-ics-caregiver">
            <Users aria-hidden="true" />
            Reminders for a family member
          </button>
          <button type="button" className="ak-btn ak-btn--ghost" onClick={() => void whatsapp()} disabled={busy !== null || !current} data-testid="whatsapp-mock">
            <MessageCircle aria-hidden="true" />
            Send reminder by WhatsApp (mock)
          </button>
          <Link href="/passport/print" className="ak-btn ak-btn--ghost" target="_blank" data-testid="open-print">
            <Printer aria-hidden="true" />
            Print or save as PDF
          </Link>
        </div>
        {notice ? (
          <div className={`ak-alert ak-alert--${notice.tone}`} role={notice.tone === "danger" ? "alert" : "status"} data-testid="passport-notice">
            <div className="ak-alert__body">
              <p className="ak-alert__title">{notice.title}</p>
              {notice.detail ? <p>{notice.detail}</p> : null}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
