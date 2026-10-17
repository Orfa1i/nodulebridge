import { Suspense } from "react";
import { ViewerFromUrl } from "./ViewerFromUrl";

export const metadata = { title: "Viewer · NoduleBridge" };

export default function DevViewerPage() {
  return (
    <Suspense fallback={<h1 className="nb-page__title">Viewer test</h1>}>
      <ViewerFromUrl />
    </Suspense>
  );
}
