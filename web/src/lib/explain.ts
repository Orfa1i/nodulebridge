import { API_BASE } from "@/lib/extract";
import { caseFileUrl } from "@/lib/cases";
import type { Recommendation } from "@/lib/recommend";
import type { ExtractResponse } from "@/types/generated/extract-response";

export type Locale = "en" | "ar";

export interface PdqSource {
  id: string;
  url: string;
  retrieved_on: string;
  topic: string;
}

export interface ExplainSection {
  key: "found" | "reassure" | "why" | "todo" | "when" | "who";
  heading: string;
  text: string;
  sources?: PdqSource[];
}

export interface Explanation {
  locale: Locale;
  sections: ExplainSection[];
  voice_text: string;
  template_ids: string[];
  questions: string[];
  source_label: string;
  review_status: { status: "reviewed" | "draft"; draft_items: string[]; reviewers: string[] };
}

export type Finding = ExtractResponse["result"]["nodules"][number];

export class ExplainError extends Error {
  detail: string | null;
  constructor(message: string, detail: string | null = null) {
    super(message);
    this.detail = detail;
  }
}

async function failure(res: Response, fallback: string): Promise<ExplainError> {
  const body = await res.json().catch(() => null);
  return new ExplainError(body?.error?.message ?? fallback, body?.error?.detail ?? null);
}

export async function fetchExplanation(
  rec: Recommendation,
  finding: Finding | null,
  locale: Locale,
  matched: boolean,
  signal?: AbortSignal,
): Promise<Explanation> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/explain`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ recommendation: rec, finding, locale, matched }),
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ExplainError(`The explanation service did not answer at ${API_BASE}.`);
  }
  if (!res.ok) throw await failure(res, `The explanation service returned an error (HTTP ${res.status}).`);
  return (await res.json()) as Explanation;
}

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface VoiceClip {
  url: string;
  /** "prepared" files were made ahead of time; "live" ones were made when the person pressed play. */
  origin: "prepared" | "live";
  durationHint: number | null;
}

/** The pre-generated clip for an example case, only if it speaks exactly the words on screen. */
export async function preparedClip(caseId: string, locale: Locale, voiceText: string): Promise<VoiceClip | null> {
  try {
    const res = await fetch(caseFileUrl(caseId, `voice.${locale}.json`));
    if (!res.ok) return null;
    const sidecar = (await res.json()) as { text_sha256: string; duration_s: number };
    if (sidecar.text_sha256 !== (await sha256Hex(voiceText))) return null;
    return { url: caseFileUrl(caseId, `voice.${locale}.mp3`), origin: "prepared", durationHint: sidecar.duration_s };
  } catch {
    return null;
  }
}

/** Ask the API to speak the text. Used for scans that have no pre-generated clip. */
export async function liveClip(text: string, locale: Locale, signal?: AbortSignal): Promise<VoiceClip> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/tts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, locale }),
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ExplainError(`The voice service did not answer at ${API_BASE}.`);
  }
  if (!res.ok) throw await failure(res, `The voice service returned an error (HTTP ${res.status}).`);
  const blob = await res.blob();
  const header = Number(res.headers.get("X-Audio-Duration"));
  return { url: URL.createObjectURL(blob), origin: "live", durationHint: Number.isFinite(header) && header > 0 ? header : null };
}

const ISOLATE = /(\d+(?:\.\d+)?\s?mm|\d{1,2}\s\p{L}+\s\d{4}|\d+(?:\.\d+)?)/gu;

/** Split text into plain runs and runs (numbers, measurements, dates) to wrap in <bdi> so they keep their order in Arabic. */
export function isolateRuns(text: string): { text: string; isolate: boolean }[] {
  return text
    .split(ISOLATE)
    .filter((part) => part !== "")
    .map((part) => ({ text: part, isolate: new RegExp(`^${ISOLATE.source}$`, "u").test(part) }));
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
