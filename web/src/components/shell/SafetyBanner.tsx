import { Info } from "lucide-react";

// TODO-VERIFY: Arabic banner text, reviewed by a bilingual clinician.
// Until it is reviewed, no Arabic string ships here (master brief section 5.1).
export const SAFETY_BANNER_AR: string | null = null;

/** The statement the passport repeats inside the card and on every printed page (master brief 5.1). */
export const SAFETY_TITLE = "Decision and adherence support only — not a diagnosis.";
export const SAFETY_BODY = "Follow-up decisions belong to your doctor.";

export function SafetyBanner() {
  return (
    <div className="ak-alert ak-alert--info nb-safety-banner" role="status">
      <Info size={20} strokeWidth={2} aria-hidden="true" />
      <div className="ak-alert__body">
        <p className="ak-alert__title">{SAFETY_TITLE}</p>
        <p>{SAFETY_BODY}</p>
        {SAFETY_BANNER_AR ? (
          <p lang="ar" dir="rtl">
            {SAFETY_BANNER_AR}
          </p>
        ) : null}
      </div>
    </div>
  );
}
