// Read design tokens at runtime so no colour value is ever written in TypeScript.

function resolvedColor(cssVar: string): [number, number, number, number] {
  const probe = document.createElement("span");
  probe.style.color = `var(${cssVar})`;
  probe.style.display = "none";
  document.body.appendChild(probe);
  const rgb = getComputedStyle(probe).color; // "rgb(r, g, b)" or "rgba(r, g, b, a)"
  probe.remove();
  const m = rgb.match(/[\d.]+/g);
  if (!m || m.length < 3) throw new Error(`Cannot resolve ${cssVar} to a colour (got "${rgb}")`);
  return [Number(m[0]), Number(m[1]), Number(m[2]), m[3] !== undefined ? Number(m[3]) : 1];
}

/** Cornerstone colour: [r, g, b, a] with 0-255 channels. */
export function cssColorRgba255(cssVar: string, alpha = 1): [number, number, number, number] {
  const [r, g, b] = resolvedColor(cssVar);
  return [r, g, b, Math.round(alpha * 255)];
}

/** Cornerstone viewport background: [r, g, b] with 0-1 channels. */
export function cssColorUnit(cssVar: string): [number, number, number] {
  const [r, g, b] = resolvedColor(cssVar);
  return [r / 255, g / 255, b / 255];
}

export function cssNumber(cssVar: string, fallback: number): number {
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(cssVar));
  return Number.isFinite(v) ? v : fallback;
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
