/**
 * Core Web Vitals and uncaught errors, sent to GA with bounded parameters:
 * route templates and error class names, never messages or URLs.
 */
import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from "web-vitals";
import { analyticsEnabled, currentRoute, track } from "./analytics";

/** A crash loop must not flood analytics. */
const MAX_ERRORS_PER_PAGE_LOAD = 10;
let errorsSent = 0;

function sendVital(metric: Metric): void {
  track("web_vital", {
    metric: metric.name,
    // GA wants integers; CLS is unitless and small, so send it in thousandths.
    value: Math.round(metric.name === "CLS" ? metric.value * 1000 : metric.value),
    rating: metric.rating,
    route: currentRoute(),
  });
}

/** An error's class name when it looks like one, else a fixed category. */
export function errorName(error: unknown): string {
  if (error instanceof Error) return /^[A-Za-z]\w{0,39}$/.test(error.name) ? error.name : "Error";
  return error === null || error === undefined ? "unknown" : typeof error;
}

function sendError(error: unknown): void {
  if (errorsSent >= MAX_ERRORS_PER_PAGE_LOAD) return;
  errorsSent++;
  track("app_error", { route: currentRoute(), error_name: errorName(error) });
}

export function startAppHealthReporting(): void {
  if (!analyticsEnabled) return;
  for (const subscribe of [onCLS, onFCP, onINP, onLCP, onTTFB]) subscribe(sendVital);
  // Cross-origin script errors arrive without an error object; they say nothing useful.
  window.addEventListener("error", (event) => {
    if (event.error !== undefined && event.error !== null) sendError(event.error);
  });
  window.addEventListener("unhandledrejection", (event) => sendError(event.reason));
}
