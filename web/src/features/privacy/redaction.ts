import { API_BASE, ExtractError } from "@/lib/extract";

export interface RedactionResult {
  /** The report text with identifying patterns replaced by [redacted]. */
  text: string;
  total: number;
  items: { kind: string; label: string; count: number }[];
  /** Always false: pattern matching cannot promise to find everything. */
  complete: boolean;
}

export interface RedactionState extends RedactionResult {
  /** waiting: the person has not confirmed yet; confirmed: they did; none: nothing was found. */
  status: "waiting" | "confirmed" | "none";
}

/** Ask the API which identifying patterns the report text contains. No model is called. */
export async function fetchRedaction(report: File, signal?: AbortSignal): Promise<RedactionResult> {
  const isPdf = report.type === "application/pdf" || /\.pdf$/i.test(report.name);
  let init: RequestInit;
  if (isPdf) {
    const form = new FormData();
    form.append("file", report, "report.pdf");
    init = { method: "POST", body: form, signal };
  } else {
    init = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: await report.text() }), signal };
  }
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/redact`, init);
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ExtractError("The analysis service is not responding. Try again in a minute.", `No answer from ${API_BASE}.`);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ExtractError(body?.error?.message ?? "The report could not be read. Paste the text instead.", body?.error?.detail ?? `HTTP ${res.status}`);
  return body as RedactionResult;
}

let gate: ((confirmed: boolean) => void) | null = null;

/** Wait until the person confirms (true) or cancels (false) the redacted text. */
export function waitForRedactionDecision(): Promise<boolean> {
  return new Promise((resolve) => {
    gate = resolve;
  });
}

export function decideRedaction(confirmed: boolean): void {
  gate?.(confirmed);
  gate = null;
}
