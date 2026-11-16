/**
 * Contract suite run against the in-memory transport (the arena). The
 * same suite must pass over TrysteroTransport (ADR-0003: the
 * game-facing API behaves identically over test and party transports).
 */
import { runNovaSessionContractTests } from "./contract-suite";
import { createInMemoryHarness } from "./harness";

runNovaSessionContractTests(() => createInMemoryHarness());
