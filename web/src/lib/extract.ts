import type { ExtractResponse } from "@/types/generated/extract-response";

export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000").replace(/\/$/, "");

export type Nodule = ExtractResponse["result"]["nodules"][number];

export class ExtractError extends Error {
  constructor(
    message: string,
    public detail: string | null,
  ) {
    super(message);
  }
}

/** POST a report PDF (or pasted text) to /extract. Never fakes a result: failures carry the API message. */
export async function extractReport(
  input: { file: Blob } | { text: string },
  signal?: AbortSignal,
): Promise<ExtractResponse> {
  let init: RequestInit;
  if ("file" in input) {
    const form = new FormData();
    form.append("file", input.file, "report.pdf");
    init = { method: "POST", body: form, signal };
  } else {
    init = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: input.text }), signal };
  }
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/extract`, init);
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ExtractError("The analysis service is not responding. Try again in a minute.", `No answer from ${API_BASE}.`);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const e = body?.error;
    throw new ExtractError(e?.message ?? "The report could not be read. Paste the text instead.", e?.detail ?? `HTTP ${res.status}`);
  }
  return body as ExtractResponse;
}

const ATTENUATION: Record<Nodule["attenuation"], string> = {
  solid: "solid",
  part_solid: "part-solid",
  ground_glass: "ground-glass",
  calcified: "calcified",
  unknown: "attenuation not stated",
};

/** "9 mm · solid · right upper lobe", every value from the extraction, nothing invented. */
export function describeNodule(n: Nodule): string {
  const size = n.mean_diameter_mm != null ? `${n.mean_diameter_mm} mm` : "size not stated";
  const where = n.side
    ? `${n.side}${n.lobe ? ` ${n.lobe === "lingula" ? "lingula" : `${n.lobe} lobe`}` : " lung"}`
    : "location not stated";
  return [size, ATTENUATION[n.attenuation], where].join(" · ");
}

export function evidenceSentenceIds(r: ExtractResponse["result"]): Set<string> {
  return new Set(r.nodules.flatMap((n) => n.evidence.map((e) => e.sentence_id)));
}
