import { API_BASE } from "@/lib/extract";
import type { ExtractResponse } from "@/types/generated/extract-response";
import type { FollowupRecommendation } from "@/types/generated/followup-recommendation";

export type Recommendation = FollowupRecommendation;
export type RiskTier = "low" | "high" | "unknown";

/** Answers the user can confirm. Each maps to a field of POST /recommend. */
export interface Confirmations {
  age_at_least_35?: boolean;
  known_cancer?: boolean;
  immunocompromised?: boolean;
  is_screening_exam?: boolean;
}

/** The engine asks these exact questions; each has one confirm chip. */
export const CONFIRM_CHIPS: { question: string; label: string; apply: Confirmations }[] = [
  { question: "Are you 35 years or older?", label: "I am 35 or older", apply: { age_at_least_35: true } },
  { question: "Do you have a known cancer?", label: "I have no known cancer", apply: { known_cancer: false } },
  { question: "Is your immune system weakened?", label: "My immune system is not weakened", apply: { immunocompromised: false } },
  {
    question: "Was this scan done for lung cancer screening?",
    label: "This scan was not for lung cancer screening",
    apply: { is_screening_exam: false },
  },
];

export async function fetchRecommendation(
  result: ExtractResponse["result"],
  confirmations: Confirmations,
  signal?: AbortSignal,
): Promise<Recommendation> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/recommend`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ result, risk_tier: "unknown", ...confirmations }),
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new Error("The analysis service is not responding. Try again in a minute.");
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error?.message ?? `The guideline service returned an error (HTTP ${res.status}).`);
  return body as Recommendation;
}

/** "2027-01-16" -> "16 Jan 2027", independent of the browser time zone. */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}

type Action = Recommendation["options"][number]["actions"][number];
const KIND: Record<Action["type"], string> = { CT: "CT", PET_CT: "PET-CT", TISSUE_SAMPLING: "Biopsy", NONE: "Follow-up" };

/** "CT window opens 16 Jan 2027" or "CT window 16 Apr 2027 to 16 Oct 2027"; null when the action has no window. */
export function windowText(a: Action): string | null {
  if (!a.window_start || !a.window_end) return null;
  if (a.window_start === a.window_end) return `${KIND[a.type]} window opens ${formatDate(a.window_start)}`;
  return `${KIND[a.type]} window ${formatDate(a.window_start)} to ${formatDate(a.window_end)}`;
}

/** Later steps ("then"), flattened in order, as text lines. */
export function laterSteps(actions: Action[]): string[] {
  const lines: string[] = [];
  const walk = (list: Action[]) => {
    for (const a of list) {
      for (const child of a.then) {
        if (child.window_start && child.window_end) {
          const when =
            child.window_start === child.window_end
              ? `around ${formatDate(child.window_start)}`
              : `between ${formatDate(child.window_start)} and ${formatDate(child.window_end)}`;
          const repeat = child.repeat_every_months ? `, then every ${child.repeat_every_months} months until ${child.until_months} months` : "";
          const cond = child.condition ? ` (${child.condition})` : "";
          lines.push(`${KIND[child.type]} ${when}${repeat}${cond}${child.optional ? ", optional" : ""}`);
        }
      }
      walk(a.then);
    }
  };
  walk(actions);
  return lines;
}
