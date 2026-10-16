import { Info } from "lucide-react";

// TODO-VERIFY: Arabic banner text, reviewed by a bilingual clinician.
// Until it is reviewed, no Arabic string ships here (master brief section 5.1).
export const SAFETY_BANNER_AR: string | null = null;

export function SafetyBanner() {
  return (
    <div className="ak-alert ak-alert--info nb-safety-banner" role="status">
      <Info size={20} strokeWidth={2} aria-hidden="true" />
      <div className="ak-alert__body">
        <p className="ak-alert__title">Decision and adherence support only — not a diagnosis.</p>
        <p>Follow-up decisions belong to your doctor.</p>
        {SAFETY_BANNER_AR ? (
          <p lang="ar" dir="rtl">
            {SAFETY_BANNER_AR}
          </p>
        ) : null}
      </div>
    </div>
  );
}
