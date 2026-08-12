import { htmlSourceBytes, htmlSourceWarnBytes } from "@rocketcrab/protocol";
import { describe, expect, it } from "vitest";
import { formatBytes, validateSource } from "./validation";

describe("validateSource", () => {
  it("reports an empty source as a hard error", () => {
    const issues = validateSource("   \n\t ");
    expect(issues.map((issue) => issue.code)).toContain("empty");
    expect(issues.find((issue) => issue.code === "empty")?.severity).toBe("error");
  });

  it("warns about missing <!doctype>/<html> structure but allows the run", () => {
    const issues = validateSource("<div>fragment</div>");
    expect(issues.map((issue) => issue.code)).toContain("missing_structure");
    expect(issues.find((issue) => issue.code === "missing_structure")?.severity).toBe("warning");
    expect(issues.some((issue) => issue.severity === "error")).toBe(false);
  });

  it("accepts a complete HTML document", () => {
    const issues = validateSource("<!doctype html><html><body>hi</body></html>");
    expect(issues).toEqual([]);
  });

  it("rejects a source over the hard size limit", () => {
    const oversized = "x".repeat(htmlSourceBytes + 1);
    const issues = validateSource(oversized);
    expect(issues.map((issue) => issue.code)).toContain("oversized_source");
    expect(issues.find((issue) => issue.code === "oversized_source")?.severity).toBe("error");
  });

  it("warns near the hard limit and stays silent below the warn threshold", () => {
    const near = "y".repeat(htmlSourceWarnBytes);
    expect(validateSource(near).map((issue) => issue.code)).toContain("source_size");
    const fine = "y".repeat(htmlSourceWarnBytes - 1024);
    expect(validateSource(fine).some((issue) => issue.code === "source_size")).toBe(false);
  });

  it("measures UTF-8 bytes, not string length", () => {
    // "🎮".repeat(...) counts 4 bytes per emoji.
    const issues = validateSource(`<!doctype html>${"🎮".repeat(htmlSourceBytes / 4)}`);
    expect(issues.map((issue) => issue.code)).toContain("oversized_source");
  });
});

describe("formatBytes", () => {
  it("formats bytes and kilobytes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
  });
});
