import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = join(__dirname, "..", "..", "..", "scripts", "check-copy.mjs");

function run(files: Record<string, string>, content: Record<string, unknown> = {}) {
  const root = mkdtempSync(join(tmpdir(), "nb-copy-"));
  mkdirSync(join(root, "web", "src"), { recursive: true });
  mkdirSync(join(root, "shared", "content"), { recursive: true });
  for (const [name, body] of Object.entries(files)) writeFileSync(join(root, "web", "src", name), body);
  for (const [name, body] of Object.entries(content)) writeFileSync(join(root, "shared", "content", name), JSON.stringify(body));
  const r = spawnSync(process.execPath, [SCRIPT], { env: { ...process.env, CHECK_COPY_ROOT: root }, encoding: "utf8" });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

describe("check-copy", () => {
  it("passes on the real repository", () => {
    const r = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain("check-copy: PASS");
  });

  it("fails on an exclamation mark, a banned word, an emoji and a Title Case button", () => {
    const { code, out } = run({
      "Bad.tsx": `export const A = () => (<div>
        <p>Great news, your scan is clear!</p>
        <p>We guarantee a quick answer.</p>
        <p>Your result is ready 🎉</p>
        <button type="button">Download Passport</button>
        <button className="ak-btn" type="button">Send Reminder Now</button>
      </div>);`,
    });
    expect(code).toBe(1);
    expect(out).toContain("exclamation mark");
    expect(out).toContain('banned word "guarantee"');
    expect(out).toContain("emoji");
    expect(out.match(/Title Case on a button/g)?.length).toBe(2);
  });

  it("checks string literals, accessible names and the content files, in Arabic too", () => {
    const { code, out } = run(
      { "Msg.tsx": `export const msg = "This is a miracle result for you"; export const B = () => <img alt="A magic picture" src="/x.svg" />;` },
      { "t.json": { templates: { X: { found: "Das ist ein Wunder, no worries!", why: "Your doctor will make the diagnosis.", ar: "هذه معجزة" } } } },
    );
    expect(code).toBe(1);
    expect(out).toContain('banned word "miracle"');
    expect(out).toContain('banned word "magic"');
    expect(out).toContain('banned word "diagnos"');
    expect(out).toContain('banned word "معجزة"');
    expect(out).toContain("exclamation mark");
  });

  it("allows the safety statement 'not a diagnosis', proper nouns on buttons and plain sentence case", () => {
    const { code, out } = run(
      {
        "Good.tsx": `export const G = () => (<div>
          <p>Decision and adherence support only — not a diagnosis.</p>
          <button type="button">Download passport (PDF)</button>
          <button type="button">Send reminder by WhatsApp (mock)</button>
          <button type="button">Use example patient A</button>
          <button type="button">Create follow-up passport</button>
        </div>);`,
      },
      { "ok.json": { templates: { X: { found: "The report describes a nodule.", _note: "Never say diagnosis here!" } } } },
    );
    expect(out).toContain("PASS");
    expect(code).toBe(0);
  });
});
