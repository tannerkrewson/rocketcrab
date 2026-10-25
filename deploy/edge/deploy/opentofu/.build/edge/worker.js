var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// ../relay/worker.ts
var RELAY_ENDPOINTS = {
  "drawphone-new": {
    url: "https://drawphone.tannerkrewson.com/new",
    method: "POST",
    shape: "json",
  },
  "dpk-new": {
    url: "https://dpk.tannerkrewson.com/new",
    method: "POST",
    shape: "json",
  },
  "netgamesio-new": {
    url: "https://netgames.io/games/{urlId}/new",
    method: "GET",
    shape: "redirect",
  },
  "ooc-rocketcrab": {
    url: "https://outofcontext.party/api/v1/rocketcrab",
    method: "POST",
    shape: "json",
  },
  "secret-hitler-netlify": {
    url: "https://inspiring-hugle-c583a0.netlify.app/.netlify/functions/secretHitler",
    method: "POST",
    shape: "json",
  },
  "snakeout-new": {
    url: "https://snakeout.tannerkrewson.com/new",
    method: "POST",
    shape: "json",
  },
  "spyfall-new": {
    url: "https://spyfall.tannerkrewson.com/new",
    method: "POST",
    shape: "json",
  },
  "werewolf-newroom": {
    url: "https://werewolf.uber.space/newRoom",
    method: "POST",
    shape: "json",
  },
};
var DEFAULT_ORIGIN_ALLOWLIST = [
  "https://rocketcrab.com",
  "http://localhost:5173",
  "https://localhost:5173",
  "http://127.0.0.1:5173",
  "https://127.0.0.1:5173",
];
var RATE_LIMIT_WINDOW_MS = 6e4;
var DEFAULT_RATE_LIMIT_PER_MIN = 20;
var MAX_RATE_LIMIT_KEYS = 1e4;
var PARAM_CHARSET = /^[A-Za-z0-9-]+$/;
function parseAllowlist(raw) {
  const source = raw === void 0 ? "" : raw;
  const entries =
    source === ""
      ? DEFAULT_ORIGIN_ALLOWLIST
      : source
          .split(",")
          .map((e) => e.trim())
          .filter((e) => e !== "");
  return entries.map((e) => {
    try {
      return new URL(e).origin;
    } catch {
      return e;
    }
  });
}
__name(parseAllowlist, "parseAllowlist");
function normalizeOrigin(raw) {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}
__name(normalizeOrigin, "normalizeOrigin");
function originAllowed(origin, allowlist) {
  return allowlist.includes(origin);
}
__name(originAllowed, "originAllowed");
function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    // ACAO varies per request origin; must be revalidated by caches.
    Vary: "Origin",
  };
}
__name(corsHeaders, "corsHeaders");
var JSON_HEADERS = { "Content-Type": "application/json" };
function jsonResponse(status, body, cors, extra) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...cors, ...extra },
  });
}
__name(jsonResponse, "jsonResponse");
function jsonError(status, code, message, cors, extra, details) {
  return jsonResponse(status, { error: { code, message, ...details } }, cors, extra);
}
__name(jsonError, "jsonError");
function parseRateLimit(raw) {
  if (raw === void 0) return DEFAULT_RATE_LIMIT_PER_MIN;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) || parsed < 1 ? DEFAULT_RATE_LIMIT_PER_MIN : parsed;
}
__name(parseRateLimit, "parseRateLimit");
function clientIp(request) {
  return request.headers.get("CF-Connecting-IP") ?? "unknown";
}
__name(clientIp, "clientIp");
var RateLimiter = class {
  static {
    __name(this, "RateLimiter");
  }
  windows = /* @__PURE__ */ new Map();
  /**
   * Count one request for `key` in the 60s window containing `now`.
   * Returns { allowed, retryAfterSeconds }; retryAfterSeconds is the
   * seconds until the window resets (only meaningful when denied).
   */
  check(key, limit, now) {
    const current = this.windows.get(key);
    if (current === void 0 || now - current.start >= RATE_LIMIT_WINDOW_MS) {
      this.windows.set(key, { start: now, count: 1 });
      this.prune(now);
      return { allowed: true, retryAfterSeconds: 0 };
    }
    if (current.count >= limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((current.start + RATE_LIMIT_WINDOW_MS - now) / 1e3),
        ),
      };
    }
    current.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }
  /** Drop expired windows once the key map grows past the cap. */
  prune(now) {
    if (this.windows.size < MAX_RATE_LIMIT_KEYS) return;
    for (const [key, entry] of this.windows) {
      if (now - entry.start >= RATE_LIMIT_WINDOW_MS) this.windows.delete(key);
    }
  }
};
var limiter;
function getLimiter() {
  limiter ??= new RateLimiter();
  return limiter;
}
__name(getLimiter, "getLimiter");
function resolveEndpointUrl(endpointKey, pathParams) {
  const entry = RELAY_ENDPOINTS[endpointKey];
  if (entry === void 0) return null;
  let url = entry.url;
  for (const [key, raw] of Object.entries(pathParams)) {
    if (typeof raw !== "string" || !PARAM_CHARSET.test(raw)) return null;
    url = url.replaceAll(`{${key}}`, raw);
  }
  if (url.includes("{")) return null;
  try {
    return new URL(url);
  } catch {
    return null;
  }
}
__name(resolveEndpointUrl, "resolveEndpointUrl");
async function handleRelayRequest(request, env = {}) {
  const allowlist = parseAllowlist(env.ORIGIN_ALLOWLIST);
  const origin = normalizeOrigin(request.headers.get("Origin"));
  if (origin === null || !originAllowed(origin, allowlist)) {
    return jsonError(403, "origin_not_allowed", "request Origin is missing or not allowlisted");
  }
  const cors = corsHeaders(origin);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }
  if (request.method !== "POST") {
    return jsonError(405, "method_not_allowed", `method ${request.method} is not allowed`, cors);
  }
  const rateLimit = parseRateLimit(env.RATE_LIMIT_PER_MIN);
  const { allowed, retryAfterSeconds } = getLimiter().check(
    clientIp(request),
    rateLimit,
    Date.now(),
  );
  if (!allowed) {
    return jsonError(
      429,
      "rate_limited",
      "too many requests; retry after the rate-limit window resets",
      cors,
      { "Retry-After": String(retryAfterSeconds) },
    );
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "invalid_json", "invalid JSON body", cors);
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return jsonError(400, "invalid_body", "body must be a JSON object", cors);
  }
  const { endpoint, body: payload, ...pathParams } = body;
  if (typeof endpoint !== "string") {
    return jsonError(400, "missing_endpoint", "missing endpoint", cors);
  }
  const entry = RELAY_ENDPOINTS[endpoint];
  if (entry === void 0) {
    return jsonError(404, "unknown_endpoint", `unknown endpoint "${endpoint}"`, cors);
  }
  const target = resolveEndpointUrl(endpoint, pathParams);
  if (target === null) {
    return jsonError(400, "invalid_params", "invalid endpoint params", cors);
  }
  try {
    if (entry.method === "GET") {
      const upstream2 = await fetch(target.toString(), { redirect: "follow" });
      if (!upstream2.ok) {
        return jsonError(502, "upstream_error", `upstream HTTP ${upstream2.status}`, cors);
      }
      return jsonResponse(200, { url: upstream2.url }, cors);
    }
    const upstream = await fetch(target.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload ?? {}),
    });
    if (!upstream.ok) {
      return jsonError(502, "upstream_error", `upstream HTTP ${upstream.status}`, cors);
    }
    const text = await upstream.text();
    return jsonResponse(200, parseJson(text), cors);
  } catch {
    return jsonError(502, "upstream_unavailable", "upstream endpoint is unavailable", cors);
  }
}
__name(handleRelayRequest, "handleRelayRequest");
function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}
__name(parseJson, "parseJson");

// ../turn-creds/worker.ts
var DEFAULT_ORIGIN_ALLOWLIST2 = [
  "https://rocketcrab.com",
  "http://localhost:5173",
  "https://localhost:5173",
  "http://127.0.0.1:5173",
  "https://127.0.0.1:5173",
];
var TURN_CREDS_API_BASE = "https://rtc.live.cloudflare.com";
var TURN_CREDS_API_PATH_PREFIX = "/v1/turn/keys/";
var MINT_TTL_SECONDS = 86400;
var RATE_LIMIT_WINDOW_MS2 = 6e4;
var DEFAULT_RATE_LIMIT_PER_MIN2 = 10;
var MINT_DAILY_KEY_PREFIX = "mints:";
var MINT_TOTAL_KEY = "mints:total";
var DEFAULT_MINT_DAILY_CAP = 5e3;
var DEFAULT_MINT_TOTAL_CAP = 5e4;
var DAILY_COUNTER_TTL_SECONDS = 2 * 24 * 60 * 60;
var MAX_RATE_LIMIT_KEYS2 = 1e4;
function isPort53IceUrl(url) {
  const queryStart = url.indexOf("?");
  const beforeQuery = queryStart === -1 ? url : url.slice(0, queryStart);
  const portList = beforeQuery.slice(beforeQuery.lastIndexOf(":") + 1);
  return portList.split("|").includes("53");
}
__name(isPort53IceUrl, "isPort53IceUrl");
function filterPort53IceServers(response) {
  const iceServers = (response.iceServers ?? []).flatMap((server) => {
    if (typeof server.urls === "string") {
      return isPort53IceUrl(server.urls) ? [] : [server];
    }
    if (!Array.isArray(server.urls)) return [];
    const urls = server.urls.filter((url) => !isPort53IceUrl(url));
    return urls.length === 0 ? [] : [{ ...server, urls }];
  });
  return { ...response, iceServers };
}
__name(filterPort53IceServers, "filterPort53IceServers");
function parseAllowlist2(raw) {
  const source = raw === void 0 ? "" : raw;
  const entries =
    source === ""
      ? DEFAULT_ORIGIN_ALLOWLIST2
      : source
          .split(",")
          .map((e) => e.trim())
          .filter((e) => e !== "");
  return entries.map((e) => {
    try {
      return new URL(e).origin;
    } catch {
      return e;
    }
  });
}
__name(parseAllowlist2, "parseAllowlist");
function normalizeOrigin2(raw) {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}
__name(normalizeOrigin2, "normalizeOrigin");
function originAllowed2(origin, allowlist) {
  return allowlist.includes(origin);
}
__name(originAllowed2, "originAllowed");
function corsHeaders2(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    // ACAO varies per request origin; must be revalidated by caches.
    Vary: "Origin",
  };
}
__name(corsHeaders2, "corsHeaders");
var JSON_HEADERS2 = { "Content-Type": "application/json; charset=utf-8" };
function jsonResponse2(status, body, cors, extra) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS2, ...cors, ...extra },
  });
}
__name(jsonResponse2, "jsonResponse");
function jsonError2(status, code, message, cors, extra, details) {
  return jsonResponse2(status, { error: { code, message, ...details } }, cors, extra);
}
__name(jsonError2, "jsonError");
function parseRateLimit2(raw) {
  if (raw === void 0) return DEFAULT_RATE_LIMIT_PER_MIN2;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) || parsed < 1 ? DEFAULT_RATE_LIMIT_PER_MIN2 : parsed;
}
__name(parseRateLimit2, "parseRateLimit");
function clientIp2(request) {
  return request.headers.get("CF-Connecting-IP") ?? "unknown";
}
__name(clientIp2, "clientIp");
function utcDateKey(now) {
  return new Date(now).toISOString().slice(0, 10);
}
__name(utcDateKey, "utcDateKey");
function dailyCounterKey(now) {
  return `${MINT_DAILY_KEY_PREFIX}${utcDateKey(now)}`;
}
__name(dailyCounterKey, "dailyCounterKey");
function parseCap(raw, fallback) {
  if (raw === void 0) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) || parsed < 1 ? fallback : parsed;
}
__name(parseCap, "parseCap");
function nextCounterValue(stored) {
  const current = stored === null ? 0 : Number.parseInt(stored, 10);
  return (Number.isNaN(current) ? 0 : current) + 1;
}
__name(nextCounterValue, "nextCounterValue");
function exceededCap(daily, total, dailyCap, totalCap) {
  if (daily >= dailyCap) return { cap: "daily" };
  if (total >= totalCap) return { cap: "total" };
  return null;
}
__name(exceededCap, "exceededCap");
var warnedKvMissing = false;
function warnKvMissing() {
  if (warnedKvMissing) return;
  warnedKvMissing = true;
  console.log(
    "turn-creds: TURN_BUDGET KV binding missing \u2014 budget kill-switch and mint counters disabled (fail-open; create the namespace in prod, see README)",
  );
}
__name(warnKvMissing, "warnKvMissing");
async function readBudgetCounters(kv, now) {
  if (kv === void 0) {
    warnKvMissing();
    return null;
  }
  try {
    const [daily, total] = await Promise.all([
      kv.get(dailyCounterKey(now)),
      kv.get(MINT_TOTAL_KEY),
    ]);
    return {
      daily: Number.parseInt(daily ?? "0", 10) || 0,
      total: Number.parseInt(total ?? "0", 10) || 0,
    };
  } catch (err) {
    console.log(`turn-creds: budget counter read failed, failing open: ${String(err)}`);
    return null;
  }
}
__name(readBudgetCounters, "readBudgetCounters");
async function incrementBudgetCounters(kv, now) {
  if (kv === void 0) {
    warnKvMissing();
    return;
  }
  const dailyKey = dailyCounterKey(now);
  try {
    const [daily, total] = await Promise.all([kv.get(dailyKey), kv.get(MINT_TOTAL_KEY)]);
    await Promise.all([
      kv.put(dailyKey, String(nextCounterValue(daily)), {
        expirationTtl: DAILY_COUNTER_TTL_SECONDS,
      }),
      kv.put(MINT_TOTAL_KEY, String(nextCounterValue(total))),
    ]);
  } catch (err) {
    console.log(
      `turn-creds: budget counter increment failed (mint already succeeded): ${String(err)}`,
    );
  }
}
__name(incrementBudgetCounters, "incrementBudgetCounters");
function logMint(request, ttlSeconds, now) {
  console.log(
    JSON.stringify({
      event: "turn_cred_mint",
      ip: clientIp2(request),
      origin: request.headers.get("Origin") ?? null,
      ttl: ttlSeconds,
      ts: new Date(now).toISOString(),
    }),
  );
}
__name(logMint, "logMint");
var RateLimiter2 = class {
  static {
    __name(this, "RateLimiter");
  }
  windows = /* @__PURE__ */ new Map();
  /**
   * Count one request for `key` in the 60s window containing `now`.
   * Returns { allowed, retryAfterSeconds }; retryAfterSeconds is the
   * seconds until the window resets (only meaningful when denied).
   */
  check(key, limit, now) {
    const current = this.windows.get(key);
    if (current === void 0 || now - current.start >= RATE_LIMIT_WINDOW_MS2) {
      this.windows.set(key, { start: now, count: 1 });
      this.prune(now);
      return { allowed: true, retryAfterSeconds: 0 };
    }
    if (current.count >= limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((current.start + RATE_LIMIT_WINDOW_MS2 - now) / 1e3),
        ),
      };
    }
    current.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }
  /** Drop expired windows once the key map grows past the cap. */
  prune(now) {
    if (this.windows.size < MAX_RATE_LIMIT_KEYS2) return;
    for (const [key, entry] of this.windows) {
      if (now - entry.start >= RATE_LIMIT_WINDOW_MS2) this.windows.delete(key);
    }
  }
};
var limiter2;
function getLimiter2() {
  limiter2 ??= new RateLimiter2();
  return limiter2;
}
__name(getLimiter2, "getLimiter");
function buildMintRequest(env) {
  const keyId = env.TURN_KEY_ID?.trim() ?? "";
  const token = env.TURN_KEY_API_TOKEN?.trim() ?? "";
  if (keyId === "" || token === "") return null;
  const url = `${TURN_CREDS_API_BASE}${TURN_CREDS_API_PATH_PREFIX}${encodeURIComponent(keyId)}/credentials/generate-ice-servers`;
  return {
    url,
    init: {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ttl: MINT_TTL_SECONDS }),
    },
  };
}
__name(buildMintRequest, "buildMintRequest");
async function handleTurnCredsRequest(request, env) {
  const allowlist = parseAllowlist2(env.ORIGIN_ALLOWLIST);
  const origin = normalizeOrigin2(request.headers.get("Origin"));
  if (origin === null || !originAllowed2(origin, allowlist)) {
    return jsonError2(403, "origin_not_allowed", "request Origin is missing or not allowlisted");
  }
  const cors = corsHeaders2(origin);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }
  if (request.method !== "POST") {
    return jsonError2(405, "method_not_allowed", `method ${request.method} is not allowed`, cors);
  }
  const rateLimit = parseRateLimit2(env.RATE_LIMIT_PER_MIN);
  const { allowed, retryAfterSeconds } = getLimiter2().check(
    clientIp2(request),
    rateLimit,
    Date.now(),
  );
  if (!allowed) {
    return jsonError2(
      429,
      "rate_limited",
      "too many requests; retry after the rate-limit window resets",
      cors,
      { "Retry-After": String(retryAfterSeconds) },
    );
  }
  const now = Date.now();
  const counters = await readBudgetCounters(env.TURN_BUDGET, now);
  if (counters !== null) {
    const dailyCap = parseCap(env.MINT_DAILY_CAP, DEFAULT_MINT_DAILY_CAP);
    const totalCap = parseCap(env.MINT_TOTAL_CAP, DEFAULT_MINT_TOTAL_CAP);
    const verdict = exceededCap(counters.daily, counters.total, dailyCap, totalCap);
    if (verdict !== null) {
      const cap = verdict.cap;
      const limit = cap === "daily" ? dailyCap : totalCap;
      const scope = cap === "daily" ? utcDateKey(now) : "since the counters were last re-armed";
      return jsonError2(
        429,
        "budget_exceeded",
        `mint budget exhausted: ${cap} cap (${limit}) reached for ${scope}`,
        cors,
        void 0,
        { cap, limit },
      );
    }
  }
  const upstream = buildMintRequest(env);
  if (upstream === null) {
    return jsonError2(
      500,
      "worker_misconfigured",
      "TURN_KEY_ID or TURN_KEY_API_TOKEN is not configured",
      cors,
    );
  }
  let upstreamResponse;
  try {
    upstreamResponse = await fetch(upstream.url, upstream.init);
  } catch {
    return jsonError2(
      502,
      "upstream_unavailable",
      "upstream TURN credentials service is unavailable",
      cors,
    );
  }
  if (!upstreamResponse.ok) {
    return jsonError2(
      502,
      "upstream_error",
      `upstream TURN credentials service returned HTTP ${upstreamResponse.status}`,
      cors,
    );
  }
  let body;
  try {
    body = await upstreamResponse.json();
  } catch {
    return jsonError2(
      502,
      "upstream_invalid",
      "upstream TURN credentials service returned invalid JSON",
      cors,
    );
  }
  if (!Array.isArray(body.iceServers)) {
    return jsonError2(
      502,
      "upstream_invalid",
      "upstream TURN credentials service returned an unexpected shape",
      cors,
    );
  }
  await incrementBudgetCounters(env.TURN_BUDGET, now);
  logMint(request, MINT_TTL_SECONDS, now);
  return jsonResponse2(200, filterPort53IceServers(body), cors);
}
__name(handleTurnCredsRequest, "handleTurnCredsRequest");

// worker.ts
var TURN_MINT_PATH = "/turn";
var worker_default = {
  fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === TURN_MINT_PATH || pathname === `${TURN_MINT_PATH}/`) {
      return handleTurnCredsRequest(request, env);
    }
    return handleRelayRequest(request, env);
  },
};
export { TURN_MINT_PATH, worker_default as default };
//# sourceMappingURL=worker.js.map
