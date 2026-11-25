import { describe, expect, it } from "vitest";
import { classifyHtmlSource } from "./html-source";

describe("classifyHtmlSource", () => {
  it("flags empty and whitespace-only sources", () => {
    expect(classifyHtmlSource("")).toBe("empty");
    expect(classifyHtmlSource("   \n\t  ")).toBe("empty");
  });

  it("accepts complete documents", () => {
    expect(classifyHtmlSource("<!doctype html><html><body>x</body></html>")).toBe("ok");
    expect(classifyHtmlSource('<!DOCTYPE html>\n<html lang="en">…</html>')).toBe("ok");
    expect(classifyHtmlSource("<html><head></head></html>")).toBe("ok");
  });

  it("flags fragments and malformed documents without doctype or html", () => {
    expect(classifyHtmlSource("<canvas></canvas><script>1+1</script>")).toBe("missing_structure");
    expect(classifyHtmlSource("<body>only body</body>")).toBe("missing_structure");
  });
});
