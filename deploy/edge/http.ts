/** JSON response helpers shared by the edge routes. */
export function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

/** Structured error body: { error: { code, message } }. */
export function jsonError(status: number, code: string, message: string, headers = {}) {
  return json(status, { error: { code, message } }, headers);
}
