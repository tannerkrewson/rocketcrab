/**
 * TanStack Router `basepath` from Vite's BASE_URL (M2 deployment).
 *
 * Vite's BASE_URL is "/" for root deployments (custom-domain subdomains,
 * strategy (a)) and "/<repo>/" for GitHub Pages project sites (strategies
 * (b)/(c)). The router needs the same prefix to match and link routes under
 * a base path; TanStack Router documents the basepath without a trailing
 * slash.
 */
export function normalizeBasePath(baseUrl: string): string {
  if (baseUrl === "" || baseUrl === "/") {
    return "/";
  }
  const withLeading = baseUrl.startsWith("/") ? baseUrl : `/${baseUrl}`;
  return withLeading.endsWith("/") ? withLeading.slice(0, -1) : withLeading;
}
