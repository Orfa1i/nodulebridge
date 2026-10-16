#!/usr/bin/env node
/**
 * warm: make the first recorded run fast. It
 *   1. calls /health on the API;
 *   2. runs the three example reports through /extract (a cache hit when the seed or an earlier run filled the cache,
 *      otherwise one real model call, which it reports), then /recommend and /explain in both languages;
 *   3. downloads every prepared case file (manifest, CT, outline, voice clips, report) once from the data host, which
 *      warms the CDN or object storage and shows the cache and CORS headers the browser will see.
 * It changes nothing on the server except the caches. Exit code 1 if anything fails.
 *
 * Usage: node scripts/warm.mjs [--api URL] [--data URL] [--origin URL] [--cases A,B,C]  (default: every study in index.json)
 * Defaults come from the environment: API_BASE (or NEXT_PUBLIC_API_BASE_URL), NEXT_PUBLIC_DATA_BASE_URL, WEB_ORIGIN.
 */
const args = Object.fromEntries(process.argv.slice(2).flatMap((a, i, all) => (a.startsWith("--") ? [[a.slice(2), all[i + 1]]] : [])));
const API = (args.api ?? process.env.API_BASE ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000").replace(/\/$/, "");
const WEB = (args.origin ?? process.env.WEB_ORIGIN ?? "http://localhost:3000").split(",")[0].replace(/\/$/, "");
const DATA = (args.data ?? process.env.NEXT_PUBLIC_DATA_BASE_URL ?? `${WEB}/cases`).replace(/\/$/, "");
// every study in the data host's index.json, unless --cases names some
async function allCases() {
  try {
    return (await (await fetch(`${DATA}/index.json`)).json()).cases.map((c) => c.case_id);
  } catch {
    return ["case-a", "case-b", "case-c"]; // the index could not be read: step 3 reports that
  }
}
const CASES = args.cases ? args.cases.split(",").map((c) => `case-${c.trim().toLowerCase()}`) : await allCases();
const FILES = ["manifest.json", "report.pdf", "ct.nii.gz", "mask.nii.gz"];
const VOICE_FILES = ["voice.en.mp3", "voice.en.json", "voice.ar.mp3", "voice.ar.json"]; // only for the studies the index says were voiced

let failures = 0;
const ok = (msg) => console.log(`  ok    ${msg}`);
const bad = (msg) => {
  failures += 1;
  console.log(`  FAIL  ${msg}`);
};
const timed = async (fn) => {
  const t = performance.now();
  const value = await fn();
  return [value, Math.round(performance.now() - t)];
};
const kb = (n) => (n > 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.round(n / 1000)} kB`);

async function json(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

console.log(`warm: API ${API} · data ${DATA} · origin ${WEB}`);

console.log("\n1. API health");
try {
  const [res, ms] = await timed(() => fetch(`${API}/health`, { headers: { origin: WEB } }));
  const body = await json(res);
  if (res.ok && body?.status === "ok") ok(`/health ${ms} ms · version ${body.version} · provider ${body.provider ?? "none"} · model ${body.model ?? "none"}`);
  else bad(`/health answered ${res.status}`);
  const allow = res.headers.get("access-control-allow-origin");
  if (allow === WEB || allow === "*") ok(`CORS allows ${WEB}`);
  else bad(`CORS: the API does not allow the web origin ${WEB} (access-control-allow-origin: ${allow ?? "missing"}). Set WEB_ORIGIN on the API.`);
} catch (err) {
  bad(`cannot reach ${API}: ${err.message}`);
}

console.log("\n2. Example analyses");
for (const id of CASES) {
  try {
    const pdfRes = await fetch(`${DATA}/${id}/report.pdf`);
    if (!pdfRes.ok) {
      bad(`${id}: report.pdf not found at the data host (${pdfRes.status})`);
      continue;
    }
    const form = new FormData();
    form.append("file", new Blob([await pdfRes.arrayBuffer()], { type: "application/pdf" }), "report.pdf");
    const [res, ms] = await timed(() => fetch(`${API}/extract`, { method: "POST", body: form }));
    const body = await json(res);
    if (!res.ok) {
      bad(`${id}: /extract ${res.status} ${body?.error?.message ?? ""} ${body?.error?.detail ?? ""}`);
      continue;
    }
    ok(`${id}: /extract ${ms} ms · ${body.cached ? "cache hit (pre-computed)" : "LIVE model call, now cached"} · ${body.result.nodules.length} nodule(s) · ${body.model}`);
    const rec = await (await fetch(`${API}/recommend`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ result: body.result }) })).json();
    const finding = body.result.nodules.find((n) => n.id === rec.driving_nodule_id) ?? null;
    for (const locale of ["en", "ar"]) {
      const r = await fetch(`${API}/explain`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ recommendation: rec, finding, locale, matched: true }) });
      if (!r.ok) bad(`${id}: /explain ${locale} ${r.status}`);
    }
    ok(`${id}: rule ${rec.rule_id ?? "none"} · explanations en and ar`);
  } catch (err) {
    bad(`${id}: ${err.message}`);
  }
}

console.log("\n3. Case files from the data host");
let voiced = new Set();
try {
  const index = await (await fetch(`${DATA}/index.json`)).json();
  voiced = new Set(index.cases.filter((c) => c.voice?.en && c.voice?.ar).map((c) => c.case_id));
  ok(`index.json lists ${index.cases.length} studies, ${voiced.size} with pre-made voice clips (the others are spoken on demand)`);
} catch (err) {
  bad(`index.json: ${err.message}`);
}
for (const id of CASES) {
  for (const file of voiced.has(id) ? [...FILES, ...VOICE_FILES] : FILES) {
    try {
      const [res, ms] = await timed(async () => {
        const r = await fetch(`${DATA}/${id}/${file}`, { headers: { origin: WEB } });
        const buf = r.ok ? await r.arrayBuffer() : null;
        return { r, size: buf?.byteLength ?? 0 };
      });
      const { r, size } = res;
      if (!r.ok) {
        bad(`${id}/${file}: ${r.status}`);
        continue;
      }
      const cache = r.headers.get("cache-control") ?? "no cache-control";
      const cors = r.headers.get("access-control-allow-origin");
      const notes = [];
      if (!/max-age=\d{5,}|immutable/.test(cache)) notes.push("short cache");
      if (DATA.startsWith("http") && new URL(DATA).origin !== WEB && !cors) notes.push("no CORS header");
      ok(`${id}/${file}: ${kb(size)} · ${ms} ms · ${cache}${notes.length ? `  [${notes.join(", ")}]` : ""}`);
    } catch (err) {
      bad(`${id}/${file}: ${err.message}`);
    }
  }
}

console.log(failures === 0 ? "\nwarm: done. Everything answered." : `\nwarm: ${failures} problem(s) above.`);
process.exit(failures === 0 ? 0 : 1);
