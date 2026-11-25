import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import { stateDeltaMaxDepth, stateDeltaOpsFit } from "@rocketcrab/protocol";
import { applyJsonPatch, canonicalJson, deltaFor, diffJson, JsonDeltaError } from "./json-delta";

const safeKey = fc.string({ minLength: 1, maxLength: 4 }).filter((key) => {
  return !["__proto__", "constructor", "prototype"].includes(key);
});
const leaf = fc.oneof(
  fc.integer(),
  fc.string({ maxLength: 6 }),
  fc.boolean(),
  fc.constant(null),
  fc.double({ noNaN: true, noDefaultInfinity: true }),
);
const json = fc.letrec((tie) => ({
  value: fc.oneof(
    { weight: 3, arbitrary: leaf },
    { weight: 1, arbitrary: fc.array(tie("value"), { maxLength: 3 }) },
    {
      weight: 2,
      arbitrary: fc.dictionary(safeKey, tie("value"), { maxKeys: 4 }),
    },
  ),
})).value;

describe("json delta", () => {
  it("apply(prev, diff(prev, next)) deep-equals next for arbitrary JSON", () => {
    fc.assert(
      fc.property(json, json, (prev, next) => {
        const patched = applyJsonPatch(prev, diffJson(prev, next));
        expect(canonicalJson(patched)).toBe(canonicalJson(next));
      }),
      { numRuns: 300 },
    );
  });

  it("does not mutate its input, and a diff of equal values is empty", () => {
    fc.assert(
      fc.property(json, json, (prev, next) => {
        const before = canonicalJson(prev);
        applyJsonPatch(prev, diffJson(prev, next));
        expect(canonicalJson(prev)).toBe(before);
        expect(diffJson(next, JSON.parse(canonicalJson(next)))).toEqual([]);
      }),
      { numRuns: 200 },
    );
  });

  it("a change to one leaf is one set operation", () => {
    const prev = { count: 1, scores: { a: 1, b: 2 }, big: [1, 2, 3] };
    const next = { count: 2, scores: { a: 1, b: 2 }, big: [1, 2, 3] };
    expect(diffJson(prev, next)).toEqual([{ op: "set", path: ["count"], value: 2 }]);
    const nested = { count: 1, scores: { a: 1, b: 9 }, big: [1, 2, 3] };
    expect(diffJson(prev, nested)).toEqual([{ op: "set", path: ["scores", "b"], value: 9 }]);
  });

  it("removed keys become deletes; arrays are replaced whole", () => {
    const prev = { keep: 1, drop: 2, list: [1, 2] };
    const next = { keep: 1, list: [1, 2, 3] };
    expect(diffJson(prev, next)).toEqual([
      { op: "del", path: ["drop"] },
      { op: "set", path: ["list"], value: [1, 2, 3] },
    ]);
  });

  it("a change of root type replaces the root", () => {
    expect(diffJson({ a: 1 }, 7)).toEqual([{ op: "set", path: [], value: 7 }]);
    expect(applyJsonPatch({ a: 1 }, [{ op: "set", path: [], value: [4] }])).toEqual([4]);
  });

  it("key order does not change the canonical encoding or the apply result", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(
      canonicalJson({ a: { c: 3, d: 2 }, b: 1 }),
    );
  });

  it("rejects operations that name a missing path, cross a non-object, or are too deep", () => {
    expect(() => applyJsonPatch({ a: 1 }, [{ op: "set", path: ["x", "y"], value: 1 }])).toThrow(
      JsonDeltaError,
    );
    expect(() => applyJsonPatch({ a: 1 }, [{ op: "del", path: ["missing"] }])).toThrow(
      JsonDeltaError,
    );
    expect(() => applyJsonPatch({ a: 1 }, [{ op: "set", path: ["a", "b"], value: 1 }])).toThrow(
      JsonDeltaError,
    );
    const deep = Array.from({ length: stateDeltaMaxDepth + 1 }, () => "k");
    expect(() => applyJsonPatch({}, [{ op: "set", path: deep, value: 1 }])).toThrow(JsonDeltaError);
    expect(() => applyJsonPatch({}, [{ op: "set", path: ["__proto__"], value: 1 }])).toThrow(
      JsonDeltaError,
    );
  });

  it("a delta is offered only when every op fits the protocol and it applies exactly", () => {
    // Keys the protocol cannot carry: empty, longer than 64, and prototype names.
    const weirdKey = fc.oneof(
      safeKey,
      fc.constantFrom("", "constructor", "prototype"),
      fc.string({ minLength: 60, maxLength: 70 }),
    );
    const weirdJson = fc.letrec((tie) => ({
      value: fc.oneof(
        { weight: 3, arbitrary: leaf },
        { weight: 1, arbitrary: fc.array(tie("value"), { maxLength: 3 }) },
        { weight: 2, arbitrary: fc.dictionary(weirdKey, tie("value"), { maxKeys: 4 }) },
      ),
    })).value;
    fc.assert(
      fc.property(weirdJson, weirdJson, (prev, next) => {
        const ops = deltaFor(prev, next);
        if (ops === null) return;
        expect(stateDeltaOpsFit(ops)).toBe(true);
        expect(canonicalJson(applyJsonPatch(prev, ops))).toBe(canonicalJson(next));
      }),
      { numRuns: 300 },
    );
  });

  it("falls back to no delta for a 65-character key, an empty key, a prototype name, or a too-deep change", () => {
    expect(deltaFor({ count: 1 }, { count: 1, ["k".repeat(65)]: 2 })).toBeNull();
    expect(deltaFor({ count: 1 }, { count: 1, "": 2 })).toBeNull();
    expect(deltaFor({ count: 1 }, { count: 1, constructor: 2 })).toBeNull();
    // A change 33 levels down cannot be addressed by any valid path.
    const deepPath = Array.from({ length: stateDeltaMaxDepth + 1 }, (_, i) => `l${i}`);
    const build = (leaf: number): Record<string, unknown> => {
      const root: Record<string, unknown> = {};
      let node = root;
      for (const key of deepPath.slice(0, -1)) {
        const child: Record<string, unknown> = {};
        node[key] = child;
        node = child;
      }
      node[deepPath[deepPath.length - 1] as string] = leaf;
      return root;
    };
    expect(() => diffJson(build(1), build(2))).toThrow(JsonDeltaError);
    expect(deltaFor(build(1), build(2))).toBeNull();
    // A valid change at the same depth is still offered.
    expect(deltaFor({ a: { b: 1 } }, { a: { b: 2 } })).not.toBeNull();
  });
});
