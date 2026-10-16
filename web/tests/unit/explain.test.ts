import { describe, expect, it } from "vitest";
import { formatClock, isolateRuns, sha256Hex } from "@/lib/explain";

describe("isolateRuns", () => {
  it("wraps measurements and dates but not words", () => {
    const runs = isolateRuns("Your nodule is 9 mm. Scan between 16 January 2027 and 16 April 2027.");
    expect(runs.filter((r) => r.isolate).map((r) => r.text)).toEqual(["9 mm", "16 January 2027", "16 April 2027"]);
    expect(runs.map((r) => r.text).join("")).toBe("Your nodule is 9 mm. Scan between 16 January 2027 and 16 April 2027.");
  });
  it("isolates bare numbers inside Arabic text and keeps the text intact", () => {
    const text = "عقيدة بحجم 9 mm في 16 يناير 2027";
    const runs = isolateRuns(text);
    expect(runs.filter((r) => r.isolate).map((r) => r.text)).toEqual(["9 mm", "16 يناير 2027"]);
    expect(runs.map((r) => r.text).join("")).toBe(text);
  });
  it("returns plain text unchanged when there are no numbers", () => {
    expect(isolateRuns("Please ask your doctor.")).toEqual([{ text: "Please ask your doctor.", isolate: false }]);
  });
});

describe("formatClock", () => {
  it("formats mm:ss", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(65.9)).toBe("1:05");
    expect(formatClock(-3)).toBe("0:00");
  });
});

describe("sha256Hex", () => {
  it("matches the known digest of 'abc'", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
