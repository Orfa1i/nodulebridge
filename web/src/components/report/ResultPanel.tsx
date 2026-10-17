"use client";

import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import type { ResultTab } from "@/features/analysis/store";

export interface ResultTabSpec {
  key: ResultTab;
  label: string;
  /** Short mono hint after the label, for example a count. */
  hint?: string | null;
  content: ReactNode;
}

interface Props {
  tabs: ResultTabSpec[];
  active: ResultTab;
  onChange: (tab: ResultTab) => void;
  /** Always visible under the tabs (the main actions). */
  footer?: ReactNode;
}

/**
 * One panel instead of a long column: Next step, Findings, Report and Summary each get a tab, and the actions stay in a
 * footer that never scrolls away. Every panel stays in the page (only the active one is shown), so the analysis can fill
 * a tab that is not on screen and screen readers and tests can still find its content.
 */
export function ResultPanel({ tabs, active, onChange, footer }: Props) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const body = useRef<HTMLDivElement>(null);

  // every tab opens at its top (the panels share one scroll area). A layout effect runs before the report's own
  // scroll-to-sentence effect, so the highlighted sentence is still scrolled into view afterwards.
  useLayoutEffect(() => {
    if (body.current) body.current.scrollTop = 0;
  }, [active]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = tabs.findIndex((t) => t.key === active);
    let next = i;
    if (e.key === "ArrowRight") next = (i + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    else return;
    e.preventDefault();
    onChange(tabs[next].key);
    refs.current[tabs[next].key]?.focus();
  };

  return (
    <section className="ak-card nb-result" aria-label="Study results" data-testid="result-panel" data-active-tab={active}>
      <div className="nb-result__inner">
        <div className="ak-tabs nb-result__tabs" role="tablist" aria-label="Results" onKeyDown={onKeyDown}>
          {tabs.map((t) => (
            <button
              key={t.key}
              ref={(el) => {
                refs.current[t.key] = el;
              }}
              type="button"
              role="tab"
              id={`result-tab-${t.key}`}
              className="ak-tab"
              aria-selected={active === t.key}
              aria-controls={`result-panel-${t.key}`}
              tabIndex={active === t.key ? 0 : -1}
              onClick={() => onChange(t.key)}
              data-testid={`result-tab-${t.key}`}
            >
              {t.label}
              {t.hint ? <span className="ak-tab__count">{t.hint}</span> : null}
            </button>
          ))}
        </div>
        <div className="nb-result__body" ref={body}>
          {tabs.map((t) => (
            <div key={t.key} role="tabpanel" id={`result-panel-${t.key}`} aria-labelledby={`result-tab-${t.key}`} className="nb-result__panel" hidden={active !== t.key}>
              {t.content}
            </div>
          ))}
        </div>
        {footer ? <div className="nb-result__footer">{footer}</div> : null}
      </div>
    </section>
  );
}
