/**
 * Structural diff and patch for plain JSON state (ADR-0007 state deltas).
 *
 * `diffJson(prev, next)` returns the operations that turn `prev` into `next`,
 * and `applyJsonPatch(value, ops)` applies them without mutating `value`.
 * Objects are diffed key by key; arrays and primitives are replaced whole,
 * which keeps the format simple and the apply exact. The operations are the
 * same shape the protocol validates (`stateDeltaOpSchema`), so a delta that
 * leaves the sender is one the receiver accepts.
 */
import { stateDeltaMaxDepth, stateDeltaOpsFit, type StateDeltaOp } from "@rocketcrab/protocol";

export type JsonDeltaOp = StateDeltaOp;

/** Thrown when a delta cannot be applied to the value it names. */
export class JsonDeltaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JsonDeltaError";
  }
}

/** Keys that would reach prototype chains; a delta never addresses them. */
const forbiddenKeys = new Set(["__proto__", "constructor", "prototype"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(object: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

/**
 * Canonical JSON: object keys sorted at every level. Two equal values encode
 * identically whatever their key insertion order, so a receiver that rebuilds
 * an object by patching hashes the same as the sender's object.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (isPlainObject(value)) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortKeys(value[key]);
    }
    return sorted;
  }
  return value;
}

function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  return canonicalJson(a) === canonicalJson(b);
}

/**
 * Operations that turn `prev` into `next`. Empty when they are equal. Throws
 * `JsonDeltaError` when a change would need an operation deeper than
 * `stateDeltaMaxDepth`. The operations may still contain keys the protocol
 * rejects: use `deltaFor` to get only a delta that fits.
 */
export function diffJson(prev: unknown, next: unknown): JsonDeltaOp[] {
  const ops: JsonDeltaOp[] = [];
  diffInto(prev, next, [], ops);
  return ops;
}

/**
 * The delta from `prev` to `next` when it can be sent: every operation passes
 * the protocol schema and the count bound. Otherwise null, and the caller
 * sends the full state.
 */
export function deltaFor(prev: unknown, next: unknown): JsonDeltaOp[] | null {
  let ops: JsonDeltaOp[];
  try {
    ops = diffJson(prev, next);
  } catch (error) {
    if (error instanceof JsonDeltaError) return null;
    throw error;
  }
  return stateDeltaOpsFit(ops) ? ops : null;
}

/** A child path, refusing any path the protocol cannot carry. */
function childPath(path: string[], key: string): string[] {
  if (path.length + 1 > stateDeltaMaxDepth) {
    throw new JsonDeltaError("change is deeper than the delta limit");
  }
  return [...path, key];
}

function diffInto(prev: unknown, next: unknown, path: string[], ops: JsonDeltaOp[]): void {
  if (isPlainObject(prev) && isPlainObject(next)) {
    for (const key of Object.keys(prev)) {
      if (!hasOwn(next, key)) ops.push({ op: "del", path: childPath(path, key) });
    }
    for (const key of Object.keys(next)) {
      if (hasOwn(prev, key)) {
        diffInto(prev[key], next[key], childPath(path, key), ops);
      } else {
        ops.push({ op: "set", path: childPath(path, key), value: next[key] });
      }
    }
    return;
  }
  if (!jsonEqual(prev, next)) {
    ops.push({ op: "set", path, value: next });
  }
}

/**
 * Apply operations to `value`, returning a new value. The input is never
 * mutated: each level that changes is copied. Throws `JsonDeltaError` when an
 * operation names a path that does not exist, crosses a non-object, uses a
 * forbidden key, or is deeper than `stateDeltaMaxDepth`.
 */
export function applyJsonPatch(value: unknown, ops: readonly JsonDeltaOp[]): unknown {
  let result = value;
  for (const op of ops) {
    for (const key of op.path) {
      if (forbiddenKeys.has(key)) throw new JsonDeltaError(`forbidden key "${key}"`);
    }
    if (op.path.length > stateDeltaMaxDepth) {
      throw new JsonDeltaError("path is deeper than the delta limit");
    }
    result = op.op === "set" ? setAt(result, op.path, op.value) : delAt(result, op.path);
  }
  return result;
}

function setAt(node: unknown, path: readonly string[], value: unknown): unknown {
  if (path.length === 0) return value;
  if (!isPlainObject(node)) throw new JsonDeltaError("path crosses a non-object");
  const [key, ...rest] = path as [string, ...string[]];
  if (rest.length === 0) return { ...node, [key]: value };
  if (!hasOwn(node, key)) throw new JsonDeltaError(`missing key "${key}"`);
  return { ...node, [key]: setAt(node[key], rest, value) };
}

function delAt(node: unknown, path: readonly string[]): unknown {
  if (!isPlainObject(node)) throw new JsonDeltaError("path crosses a non-object");
  const [key, ...rest] = path as [string, ...string[]];
  if (!hasOwn(node, key)) throw new JsonDeltaError(`missing key "${key}"`);
  if (rest.length === 0) {
    const copy: Record<string, unknown> = { ...node };
    delete copy[key];
    return copy;
  }
  return { ...node, [key]: delAt(node[key], rest) };
}
