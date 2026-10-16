import { imageLoader, init as csInit } from "@cornerstonejs/core";
import * as csTools from "@cornerstonejs/tools";
import { cornerstoneNiftiImageLoader } from "@cornerstonejs/nifti-volume-loader";

// Cornerstone touches window and WebGL, so this module is only imported from client code that
// itself is loaded with next/dynamic and ssr: false.
let ready: Promise<void> | null = null;

export function initCornerstone(): Promise<void> {
  ready ??= (async () => {
    await csInit();
    csTools.init();
    imageLoader.registerImageLoader("nifti", cornerstoneNiftiImageLoader);
    for (const tool of [csTools.WindowLevelTool, csTools.PanTool, csTools.ZoomTool, csTools.StackScrollTool]) {
      csTools.addTool(tool);
    }
  })();
  return ready;
}
