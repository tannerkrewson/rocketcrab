/**
 * Environment-specific Trystero app ID (P1 deliverable).
 *
 * Trystero derives the deterministic relay selection from `appId`
 * (seeded shuffle over the relay list), so every peer in a party MUST use
 * the same appId or they will never discover each other. The default is
 * therefore environment-scoped, never per-machine:
 *
 * - `rocketcrab-nova-dev` — dev/test builds (Vite `import.meta.env.DEV`).
 * - `rocketcrab-nova-prod` — production builds (Vite `import.meta.env.PROD`).
 *
 * Callers can pin an explicit appId (e.g. for e2e runs) via the adapter
 * options; `resolveAppId` is pure so tests stay deterministic.
 */

/** App ID used by development and test builds. */
export const DEV_APP_ID = "rocketcrab-nova-dev";

/** App ID used by production builds. */
export const PROD_APP_ID = "rocketcrab-nova-prod";

/** Environment flags the appId resolution understands. */
export interface AppIdEnvironment {
  /** True in Vite dev servers and vitest runs. */
  readonly DEV?: boolean;
  /** True in production builds (`vite build`). */
  readonly PROD?: boolean;
}

/** Read the Vite environment, tolerating non-Vite hosts (tests, node). */
export function currentAppIdEnvironment(): AppIdEnvironment {
  const env = (import.meta as unknown as { env?: Record<string, unknown> }).env;
  if (env === undefined) {
    return {};
  }
  return { DEV: env.DEV === true, PROD: env.PROD === true };
}

/**
 * Resolve the appId for a room: explicit `appId` wins; otherwise the
 * environment-scoped default (dev unless the build is a production build).
 */
export function resolveAppId(appId: string | undefined, env: AppIdEnvironment): string {
  if (appId !== undefined && appId.length > 0) {
    return appId;
  }
  return env.PROD === true ? PROD_APP_ID : DEV_APP_ID;
}
