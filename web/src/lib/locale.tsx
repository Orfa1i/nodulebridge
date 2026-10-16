"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export type PatientLocale = "en" | "ar";

interface LocaleValue {
  patientLocale: PatientLocale;
  setPatientLocale: (locale: PatientLocale) => void;
}

const LocaleContext = createContext<LocaleValue | null>(null);

// App chrome stays English; only patient-facing panels read this value.
export function LocaleProvider({ children }: { children: ReactNode }) {
  const [patientLocale, setPatientLocale] = useState<PatientLocale>("en");
  const value = useMemo(() => ({ patientLocale, setPatientLocale }), [patientLocale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocale must be used inside LocaleProvider");
  return ctx;
}

export function localeAttrs(locale: PatientLocale): { lang: string; dir: "ltr" | "rtl" } {
  return locale === "ar" ? { lang: "ar", dir: "rtl" } : { lang: "en", dir: "ltr" };
}
