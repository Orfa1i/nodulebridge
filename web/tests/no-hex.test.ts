import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Product code must use Asklevia tokens, never hex colours.
const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/;
const root = join(__dirname, "..", "src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

describe("no hard-coded hex colours in .tsx", () => {
  const files = walk(root).filter((f) => f.endsWith(".tsx"));
  it("finds tsx files", () => expect(files.length).toBeGreaterThan(0));
  for (const file of files) {
    it(file.slice(root.length + 1), () => {
      const lines = readFileSync(file, "utf8").split(/\r?\n/);
      const hits = lines
        .map((text, i) => ({ text, line: i + 1 }))
        .filter(({ text }) => HEX.test(text));
      expect(hits).toEqual([]);
    });
  }
});
