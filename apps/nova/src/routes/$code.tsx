import { createFileRoute, notFound } from "@tanstack/react-router";
import { JoinFlow } from "../components/party/JoinFlow";

export const Route = createFileRoute("/$code")({
  component: ShortJoinPage,
});

/** Short join URLs carry exactly four letters (any case; normalized below). */
const SHORT_CODE_PATTERN = /^[A-Za-z]{4}$/u;

/**
 * The root short-join route (9fv.8): rocketcrab.com/cvvu — the four-letter
 * code as a bare path segment. Matches any single-segment path that no
 * static route owns (TanStack Router ranks static paths higher, so /about,
 * /join, /party and friends are never touched); the component validates the
 * segment as a four-letter code and falls through to the 404 page for
 * anything else, so typos and stray paths never hijack the app. Only the
 * code travels in the path — never the secret (codes are public rendezvous
 * namespaces, ADR-0004; the secret stays fragment-only, ADR-0011). A
 * fragment invite on top of the short URL (/cvvu#secret=…) still joins
 * directly: the shared flow imports the fragment first.
 *
 * The SPA hosts (GitHub Pages 404.html byte-copy, Netlify/Cloudflare
 * `/* /index.html 200` in deploy/nova/_redirects) serve the app shell for
 * this unknown path, so the route survives reloads.
 */
function ShortJoinPage() {
  const { code } = Route.useParams();
  if (!SHORT_CODE_PATTERN.test(code)) {
    throw notFound();
  }
  return <JoinFlow initialCode={code.toLowerCase()} />;
}
