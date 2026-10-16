import { API_BASE } from "@/lib/extract";
import type { Explanation, Locale } from "@/lib/explain";
import type { Recommendation } from "@/lib/recommend";

/** Mirrors PassportPayload in api/app/services/passport.py. */
export interface PassportData {
  label: string;
  case_id: string | null;
  patient_ref: string | null;
  study_instance_uid: string | null;
  series_instance_uid: string | null;
  created_on: string; // ISO date
  report_text: string;
  evidence_quote: string | null;
  finding: Record<string, unknown> | null;
  recommendation: Recommendation;
  explanation: Record<Locale, Explanation>;
  image_data_url: string | null;
  attribution: string | null;
  timezone: string;
}

export interface BookingRequest {
  locale: Locale;
  subject: string;
  body: string;
  review_status: { status: "reviewed" | "draft"; draft_items: string[] };
}

export class PassportError extends Error {
  detail: string | null;
  constructor(message: string, detail: string | null = null) {
    super(message);
    this.detail = detail;
  }
}

async function post(path: string, body: unknown): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new PassportError(`The service did not answer at ${API_BASE}.`);
  }
  if (!res.ok) {
    const e = await res.json().catch(() => null);
    throw new PassportError(e?.error?.message ?? `The service returned an error (HTTP ${res.status}).`, e?.error?.detail ?? null);
  }
  return res;
}

export async function fetchBooking(passport: PassportData, locale: Locale): Promise<BookingRequest> {
  return (await (await post("/passport/booking", { passport, locale })).json()) as BookingRequest;
}

export type DownloadKind = "pdf" | "fhir" | "ics" | "ics-caregiver";

const FILES: Record<DownloadKind, string> = {
  pdf: "nodulebridge-passport.pdf",
  fhir: "nodulebridge-fhir-summary.json",
  ics: "nodulebridge-reminders.ics",
  "ics-caregiver": "nodulebridge-reminders-caregiver.ics",
};

/** Ask the API for a file and hand it to the browser as a download. Returns the blob so tests can inspect it. */
export async function download(kind: DownloadKind, passport: PassportData, locale: Locale): Promise<Blob> {
  const res =
    kind === "pdf"
      ? await post("/passport/pdf", { passport })
      : kind === "fhir"
        ? await post("/passport/fhir", { passport })
        : await post("/passport/ics", { passport, locale, caregiver: kind === "ics-caregiver" });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = FILES[kind];
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return blob;
}

export async function mockWhatsApp(message: string, locale: Locale, label: string): Promise<void> {
  await post("/mock/whatsapp", { message, locale, label });
}
