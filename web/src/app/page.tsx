import { Suspense } from "react";
import { CaseFromUrl } from "@/components/report/CaseFromUrl";

// The case comes from ?case= and is read in the browser, so the page can also be exported as plain files.
export default function CaseWorkspacePage() {
  return (
    <Suspense fallback={<h1 className="nb-page__title">Case workspace</h1>}>
      <CaseFromUrl />
    </Suspense>
  );
}
