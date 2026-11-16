import type { PartySetup } from "./engine-setup";
import type { PartyConnection } from "./engine-connection";
import type { PartyGameLifecycle } from "./engine-game";
import type { PartyRuntime } from "./engine-runtime";
import type { PartySource } from "./engine-source";
import type { PartySnapshot } from "./engine-snapshot";
export interface PartyEngineServices {
  readonly setup: PartySetup;
  readonly connection: PartyConnection;
  readonly game: PartyGameLifecycle;
  readonly runtime: PartyRuntime;
  readonly source: PartySource;
  readonly snapshot: PartySnapshot;
}
