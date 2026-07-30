/**
 * Tests for the mode resolution module (utils/mode.ts).
 *
 * Tests the hostname-to-mode mapping independent of Next.js.
 * These tests document the mode contract for the framework migration.
 */

import { describe, expect, it } from "vitest";
import {
    getModeFromHost,
    isKidsMode,
    MODE_MAP,
} from "../../utils/mode";
import { RocketcrabMode } from "../../types/enums";

describe("utils/mode", () => {
    describe("getModeFromHost", () => {
        it("returns MAIN for rocketcrab.com", () => {
            expect(getModeFromHost("rocketcrab.com")).toBe(
                RocketcrabMode.MAIN,
            );
        });

        it("returns KIDS for kids.rocketcrab.com", () => {
            expect(getModeFromHost("kids.rocketcrab.com")).toBe(
                RocketcrabMode.KIDS,
            );
        });

        it("returns MAIN for localhost", () => {
            expect(getModeFromHost("localhost")).toBe(RocketcrabMode.MAIN);
        });

        it("returns MAIN for IP addresses", () => {
            expect(getModeFromHost("127.0.0.1")).toBe(RocketcrabMode.MAIN);
            expect(getModeFromHost("192.168.1.1")).toBe(RocketcrabMode.MAIN);
        });

        it("returns MAIN for unknown hostnames", () => {
            expect(getModeFromHost("example.com")).toBe(RocketcrabMode.MAIN);
            expect(getModeFromHost("")).toBe(RocketcrabMode.MAIN);
        });

        it("returns MAIN for undefined/null hostname", () => {
            expect(getModeFromHost(undefined as unknown as string)).toBe(
                RocketcrabMode.MAIN,
            );
        });

        it("returns KIDS for any hostname starting with kids.", () => {
            expect(getModeFromHost("kids.example.com")).toBe(
                RocketcrabMode.KIDS,
            );
            expect(getModeFromHost("kids.staging.local")).toBe(
                RocketcrabMode.KIDS,
            );
            expect(getModeFromHost("kids.127.0.0.1")).toBe(
                RocketcrabMode.KIDS,
            );
        });

        it("returns MAIN for subdomains not starting with kids.", () => {
            expect(getModeFromHost("app.rocketcrab.com")).toBe(
                RocketcrabMode.MAIN,
            );
            expect(getModeFromHost("staging.rocketcrab.com")).toBe(
                RocketcrabMode.MAIN,
            );
        });
    });

    describe("isKidsMode", () => {
        it("returns true for KIDS mode", () => {
            expect(isKidsMode(RocketcrabMode.KIDS)).toBe(true);
        });

        it("returns false for MAIN mode", () => {
            expect(isKidsMode(RocketcrabMode.MAIN)).toBe(false);
        });

        it("returns false for ALL mode", () => {
            expect(isKidsMode(RocketcrabMode.ALL)).toBe(false);
        });
    });

    describe("MODE_MAP", () => {
        it("maps MAIN to rocketcrab.com", () => {
            expect(MODE_MAP[RocketcrabMode.MAIN]).toBe("rocketcrab.com");
        });

        it("maps KIDS to kids.rocketcrab.com", () => {
            expect(MODE_MAP[RocketcrabMode.KIDS]).toBe("kids.rocketcrab.com");
        });

        it("maps ALL to rocketcrab.com (testing only)", () => {
            expect(MODE_MAP[RocketcrabMode.ALL]).toBe("rocketcrab.com");
        });
    });

    describe("local development guidance", () => {
        it("documents how to test KIDS mode locally", () => {
            // To test KIDS mode in local development:
            //
            // 1. Set environment variables:
            //    HOSTNAME=kids.localhost  (if your server reads $HOSTNAME)
            //
            // 2. Or modify your hosts file:
            //    127.0.0.1  kids.localhost
            //    Then access http://kids.localhost:3000
            //
            // 3. Or pass hostname directly:
            //    getModeFromHost("kids.localhost") → KIDS
            //
            // Since the current server reads the hostname from the incoming
            // request (req.hostname or socket.handshake.headers.host), the
            // simplest approach is to set up a local hosts entry and browse
            // to http://kids.localhost:3000.
            expect(true).toBe(true);
        });
    });
});
