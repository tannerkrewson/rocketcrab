import { describe, expect, it } from "vitest";
import { DEV_APP_ID, PROD_APP_ID, resolveAppId } from "./app-id";

describe("resolveAppId", () => {
  it("defaults to the dev appId", () => {
    expect(resolveAppId(undefined, {})).toBe(DEV_APP_ID);
    expect(resolveAppId(undefined, { DEV: true })).toBe(DEV_APP_ID);
  });

  it("uses the prod appId for production builds", () => {
    expect(resolveAppId(undefined, { PROD: true })).toBe(PROD_APP_ID);
    expect(resolveAppId(undefined, { DEV: false, PROD: true })).toBe(PROD_APP_ID);
  });

  it("prefers an explicit appId over the environment", () => {
    expect(resolveAppId("rocketcrab-e2e", { PROD: true })).toBe("rocketcrab-e2e");
    expect(resolveAppId("rocketcrab-e2e", {})).toBe("rocketcrab-e2e");
  });

  it("never returns an empty explicit appId", () => {
    expect(resolveAppId("", { PROD: true })).toBe(PROD_APP_ID);
  });
});
