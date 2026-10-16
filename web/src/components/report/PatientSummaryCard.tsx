"use client";

import { Pause, Play } from "lucide-react";
import { Fragment, useCallback, useId, useRef, useState } from "react";
import { formatClock, isolateRuns, liveClip, preparedClip, type ExplainSection, type Explanation, type Locale, type VoiceClip } from "@/lib/explain";

interface Props {
  explanation: Record<Locale, Explanation> | null;
  error: string | null;
  loading: boolean;
  /** Prepared example case id; scans without one get their voice made on demand. */
  caseId: string | null;
  /** The card fades in at the end of the automatic sequence. */
  revealed?: boolean;
}

const TABS: { locale: Locale; label: string }[] = [
  { locale: "en", label: "English" },
  { locale: "ar", label: "العربية" },
];

const UI = {
  en: { play: "Play summary", pause: "Pause", transcript: "Transcript", sourceLink: "NCI PDQ page", retrieved: "retrieved" },
  ar: { play: "تشغيل الملخص", pause: "إيقاف مؤقت", transcript: "النص", sourceLink: "صفحة PDQ", retrieved: "تاريخ الاسترجاع" },
} as const;

/** Numbers, measurements and dates keep their own direction inside right-to-left text. */
function Isolated({ text }: { text: string }) {
  return (
    <>
      {isolateRuns(text).map((run, i) => (run.isolate ? <bdi key={i}>{run.text}</bdi> : <Fragment key={i}>{run.text}</Fragment>))}
    </>
  );
}

function ReviewBadge({ e }: { e: Explanation }) {
  const reviewed = e.review_status.status === "reviewed";
  if (e.locale === "en") {
    return reviewed ? (
      <span className="ak-badge ak-badge--success">Reviewed text</span>
    ) : (
      <span className="ak-badge ak-badge--warning">Text not yet reviewed</span>
    );
  }
  return reviewed ? (
    <span className="ak-badge ak-badge--ai" data-testid="review-badge">
      AI-assisted translation · reviewed by {e.review_status.reviewers.join(", ") || "a clinician"}
    </span>
  ) : (
    <span className="ak-badge ak-badge--warning" data-testid="review-badge">
      Translation not yet reviewed
    </span>
  );
}

function Section({ section, locale, sourceLabel }: { section: ExplainSection; locale: Locale; sourceLabel: string }) {
  return (
    <section className="nb-summary__section" data-testid={`summary-${section.key}`}>
      <h3 className="nb-summary__heading">{section.heading}</h3>
      <p className="nb-summary__text">
        <Isolated text={section.text} />
      </p>
      {section.sources?.map((s) => (
        <p key={s.id} className="nb-summary__source">
          {sourceLabel}{" "}
          <a href={s.url} target="_blank" rel="noreferrer" className="ak-link">
            {UI[locale].sourceLink}
          </a>{" "}
          <span className="nb-mono-note">
            ({UI[locale].retrieved} <bdi>{s.retrieved_on}</bdi>)
          </span>
        </p>
      ))}
    </section>
  );
}

function VoicePlayer({ explanation, caseId }: { explanation: Explanation; caseId: string | null }) {
  const { locale, voice_text: text } = explanation;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [clip, setClip] = useState<VoiceClip | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "playing" | "paused" | "error">("idle");
  const [error, setError] = useState<{ message: string; detail: string | null } | null>(null);
  const [time, setTime] = useState({ now: 0, total: 0 });
  const transcriptId = useId();

  const play = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (state === "playing") {
      audio.pause();
      return;
    }
    let current = clip;
    if (!current) {
      setState("loading");
      setError(null);
      try {
        current = (caseId ? await preparedClip(caseId, locale, text) : null) ?? (await liveClip(text, locale));
      } catch (err) {
        const e = err as Error & { detail?: string | null };
        setError({ message: e.message || "The voice summary could not be made.", detail: e.detail ?? null });
        setState("error");
        return;
      }
      setClip(current);
      audio.src = current.url;
      setTime({ now: 0, total: current.durationHint ?? 0 });
    }
    try {
      await audio.play();
    } catch {
      setState("error");
      setError({ message: "Your browser did not start the audio.", detail: "Press play again." });
    }
  }, [caseId, clip, locale, state, text]);

  const playing = state === "playing";
  return (
    <div className="nb-voice" data-testid="voice-player" data-voice-state={state} data-voice-origin={clip?.origin ?? "none"}>
      <div className="nb-voice__bar">
        <button
          type="button"
          className="ak-btn ak-btn--primary"
          onClick={() => void play()}
          aria-pressed={playing}
          disabled={state === "loading"}
          data-testid="voice-play"
          lang={locale}
        >
          {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
          {state === "loading" ? (locale === "ar" ? "جارٍ التحضير" : "Preparing") : playing ? UI[locale].pause : UI[locale].play}
        </button>
        <span className="nb-voice__time" dir="ltr" data-testid="voice-time" aria-live="off">
          {formatClock(time.now)} / {formatClock(time.total)}
        </span>
        <span className="ak-badge ak-badge--ai">AI voice</span>
        {clip?.origin === "prepared" ? (
          <span className="ak-badge ak-badge--outline" data-testid="voice-precomputed">
            Pre-computed for demo
          </span>
        ) : null}
      </div>
      <audio
        ref={audioRef}
        preload="none"
        onPlay={() => setState("playing")}
        onPause={() => setState((s) => (s === "playing" ? "paused" : s))}
        onEnded={() => {
          setState("idle");
          setTime((t) => ({ ...t, now: 0 }));
        }}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d)) setTime((t) => ({ ...t, total: d }));
        }}
        onTimeUpdate={(e) => {
          const current = e.currentTarget.currentTime; // read now: currentTarget is gone when the updater runs
          setTime((t) => ({ ...t, now: current }));
        }}
      />
      {error ? (
        <div className="ak-alert ak-alert--danger" role="alert">
          <div className="ak-alert__body">
            <p className="ak-alert__title">{error.message}</p>
            {error.detail ? <p>{error.detail}</p> : null}
            <p>The written summary above is the same words.</p>
          </div>
        </div>
      ) : null}
      <div className="nb-voice__transcript" id={transcriptId}>
        <p className="nb-summary__heading">{UI[locale].transcript}</p>
        <p className="nb-summary__text" data-testid="voice-transcript">
          <Isolated text={text} />
        </p>
      </div>
    </div>
  );
}

export function PatientSummaryCard({ explanation, error, loading, caseId, revealed = true }: Props) {
  const [locale, setLocale] = useState<Locale>("en");
  const tabsId = useId();
  const current = explanation?.[locale] ?? null;

  return (
    <section className={`ak-card nb-reveal${revealed ? " is-revealed" : ""}`} aria-labelledby="summary-title" data-testid="patient-summary" data-revealed={revealed}>
      <div className="ak-card__head">
        <h2 id="summary-title" className="ak-card__title">
          Summary for the patient
        </h2>
        <span className="ak-badge ak-badge--brand">Template-based</span>
      </div>

      {!explanation && !error ? (
        <div className="ak-empty">
          <p className="ak-empty__title">{loading ? "Preparing the summary" : "No summary yet"}</p>
          <p className="ak-empty__text">The plain-language summary appears after the guideline step.</p>
        </div>
      ) : null}
      {error ? (
        <div className="ak-alert ak-alert--danger" role="alert">
          <div className="ak-alert__body">
            <p className="ak-alert__title">The summary could not be prepared.</p>
            <p>{error}</p>
          </div>
        </div>
      ) : null}

      {explanation && current ? (
        <>
          <div className="ak-tabs" role="tablist" aria-label="Summary language">
            {TABS.map((t) => (
              <button
                key={t.locale}
                type="button"
                role="tab"
                id={`${tabsId}-${t.locale}`}
                aria-selected={locale === t.locale}
                aria-controls={`${tabsId}-panel`}
                className="ak-tab"
                lang={t.locale}
                onClick={() => setLocale(t.locale)}
                data-testid={`summary-tab-${t.locale}`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div
            role="tabpanel"
            id={`${tabsId}-panel`}
            aria-labelledby={`${tabsId}-${locale}`}
            className="nb-summary"
            lang={locale}
            dir={locale === "ar" ? "rtl" : "ltr"}
            data-testid={`summary-panel-${locale}`}
          >
            <div className="nb-summary__meta">
              <ReviewBadge e={current} />
            </div>
            {current.sections.map((s) => (
              <Section key={s.key} section={s} locale={locale} sourceLabel={current.source_label} />
            ))}
            <VoicePlayer key={`${caseId}:${locale}:${current.voice_text}`} explanation={current} caseId={caseId} /> {/* a new language or text is a new clip: remount */}
          </div>
        </>
      ) : null}
    </section>
  );
}
