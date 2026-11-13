#!/usr/bin/env node
import { pathToFileURL } from "node:url";

const outcomes = ["direct", "turn", "tunnel", "failed"];

function date(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "")) throw new Error("Dates must be YYYY-MM-DD (UTC).");
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value)
    throw new Error("Invalid calendar date.");
  return value;
}

export function buildQueries(start, end) {
  start = date(start);
  end = date(end);
  if (start >= end) throw new Error("Start date must precede end date.");
  const where = `timestamp >= '${start} 00:00:00' AND timestamp < '${end} 00:00:00'`;
  return [
    `SELECT blob1 AS outcome, SUM(_sample_interval) AS events FROM connection_events WHERE ${where} GROUP BY blob1 FORMAT JSON`,
    `SELECT SUM(_sample_interval) AS events, quantileExactWeighted(0.5)(double1, _sample_interval) AS median_ms FROM connection_events WHERE ${where} AND blob1 IN ('direct', 'turn', 'tunnel') FORMAT JSON`,
  ];
}

export async function run({ start, end, accountId, token, fetchImpl = fetch }) {
  const queries = buildQueries(start, end);
  if (!/^[a-fA-F0-9]{32}$/.test(accountId ?? ""))
    throw new Error("CLOUDFLARE_ACCOUNT_ID must be a 32-character hex account ID.");
  if (!token || /[\r\n]/.test(token))
    throw new Error("Set CLOUDFLARE_API_TOKEN to an Account Analytics Read token.");
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/analytics_engine/sql`;
  const results = [];
  for (const query of queries) {
    let response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "text/plain" },
        body: query,
        redirect: "error",
      });
    } catch {
      throw new Error("Cloudflare SQL request failed (network error).");
    }
    if (!response.ok)
      throw new Error(
        `Cloudflare SQL request failed (HTTP ${response.status}). Check token permissions, dataset and date range.`,
      );
    let body;
    try {
      body = await response.json();
    } catch {
      throw new Error("Cloudflare SQL returned invalid JSON.");
    }
    if (!Array.isArray(body.data))
      throw new Error("Cloudflare SQL returned an unexpected response.");
    results.push(body.data);
  }
  const counts = new Map();
  for (const row of results[0]) {
    const n = Number(row.events);
    if (typeof row.outcome !== "string" || !Number.isFinite(n) || n < 0 || counts.has(row.outcome))
      throw new Error("Cloudflare SQL returned invalid outcome data.");
    if (!outcomes.includes(row.outcome))
      throw new Error("Cloudflare SQL returned an unknown outcome; check the event schema.");
    counts.set(row.outcome, n);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const labels = outcomes;
  const lines = [
    `Connection outcomes (${start} inclusive to ${end} exclusive, UTC)`,
    `Estimated events: ${total}`,
    ...labels.map(
      (label) =>
        `${label}: ${total ? (((counts.get(label) ?? 0) / total) * 100).toFixed(1) : "0.0"}%`,
    ),
  ];
  const median = results[1][0];
  if (
    median &&
    (!Number.isFinite(Number(median.events)) ||
      Number(median.events) < 0 ||
      (Number(median.events) > 0 &&
        (median.median_ms == null ||
          !Number.isFinite(Number(median.median_ms)) ||
          Number(median.median_ms) < 0)))
  )
    throw new Error("Cloudflare SQL returned invalid median data.");
  lines.push(
    `Median successful connect time: ${median && Number(median.events) > 0 ? `${Number(median.median_ms)} ms` : "n/a"}`,
  );
  return lines.join("\n");
}

async function main() {
  const [start, end, ...extra] = process.argv.slice(2);
  if (!start || !end || extra.length)
    throw new Error(
      "Usage: node scripts/connection-stats.mjs START_DATE END_DATE (UTC; end exclusive)",
    );
  console.log(
    await run({
      start,
      end,
      accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
      token: process.env.CLOUDFLARE_API_TOKEN,
    }),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
