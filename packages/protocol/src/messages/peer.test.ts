import { describe, expect, it } from "vitest";
import { parsePeerMessage } from "../errors";
import {
  PEER_MESSAGE_TYPES,
  actionAcknowledgementMessageSchema,
  actionDispatchMessageSchema,
  authorityAnnouncementMessageSchema,
  authorityElectionMessageSchema,
  authorityHeartbeatMessageSchema,
  connectionStatusMessageSchema,
  gameSourceMetadataMessageSchema,
  gameControlsMessageSchema,
  gameReadyMessageSchema,
  gameStartMessageSchema,
  gameEndMessageSchema,
  gameSourceDiscoverMessageSchema,
  partyContextMessageSchema,
  partyRenameMessageSchema,
  partyClassicRoomMessageSchema,
  partyClassicRoomRequestMessageSchema,
  partyKickMessageSchema,
  partyReloadAllMessageSchema,
  peerCapabilitiesMessageSchema,
  peerMessagesSchema,
  playerIdentityMessageSchema,
  rawChannelCloseMessageSchema,
  rawChannelMetadataMessageSchema,
  simulationInputMessageSchema,
  simulationSnapshotMessageSchema,
  stateResyncMessageSchema,
  stateDeltaOpSchema,
  stateSnapshotMessageSchema,
  stateViewMessageSchema,
  gameSourceAcceptedMessageSchema,
} from "./peer";

function basePeer(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    sessionId: "session-1",
    senderMemberId: "member-1",
    senderConnectionId: "connection-1",
    messageId: "message-1",
    sentAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe("peer message schemas", () => {
  it("defines every peer message family with a Zod schema", () => {
    const schemas = [
      partyContextMessageSchema,
      partyRenameMessageSchema,
      partyClassicRoomMessageSchema,
      partyClassicRoomRequestMessageSchema,
      partyKickMessageSchema,
      partyReloadAllMessageSchema,
      playerIdentityMessageSchema,
      connectionStatusMessageSchema,
      peerCapabilitiesMessageSchema,
      actionDispatchMessageSchema,
      actionAcknowledgementMessageSchema,
      stateSnapshotMessageSchema,
      stateResyncMessageSchema,
      stateViewMessageSchema,
      authorityAnnouncementMessageSchema,
      authorityHeartbeatMessageSchema,
      authorityElectionMessageSchema,
      simulationInputMessageSchema,
      simulationSnapshotMessageSchema,
      gameReadyMessageSchema,
      gameControlsMessageSchema,
      gameStartMessageSchema,
      gameEndMessageSchema,
      rawChannelMetadataMessageSchema,
      rawChannelCloseMessageSchema,
      gameSourceMetadataMessageSchema,
      gameSourceAcceptedMessageSchema,
      gameSourceDiscoverMessageSchema,
    ];
    expect(schemas).toHaveLength(PEER_MESSAGE_TYPES.length);
    for (const schema of schemas) {
      expect(schema).toBeDefined();
    }
  });

  it("parses a valid example of every peer message", () => {
    const validExamples = [
      partyContextMessageSchema.parse(
        basePeer({ type: "party.context", creatorMemberId: "member-1" }),
      ),
      partyRenameMessageSchema.parse(
        basePeer({
          type: "party.rename",
          displayName: "Renamed Alex",
        }),
      ),
      partyClassicRoomMessageSchema.parse(
        basePeer({
          type: "party.classicRoom",
          gameId: "protobowl",
          player: {
            url: "https://protobowl.com/rocketcrab-abc123",
            customQueryParams: { room: "abc123" },
          },
          host: { afterQueryParams: "#host" },
        }),
      ),
      partyClassicRoomRequestMessageSchema.parse(basePeer({ type: "party.classicRoom.request" })),
      partyKickMessageSchema.parse(
        basePeer({ type: "party.kick", targetMemberId: "member-2", reason: "left the room" }),
      ),
      partyReloadAllMessageSchema.parse(basePeer({ type: "party.reloadAll" })),
      playerIdentityMessageSchema.parse(
        basePeer({
          type: "player.identity",
          displayName: "Alex",
          authorityEligible: true,
        }),
      ),
      connectionStatusMessageSchema.parse(
        basePeer({
          type: "peer.connectionStatus",
          status: "online",
        }),
      ),
      peerCapabilitiesMessageSchema.parse(
        basePeer({
          type: "peer.capabilities",
          protocolVersions: [1],
          gameModes: ["state", "simulation"],
          chunkedMessages: true,
          binaryPayloads: true,
        }),
      ),
      actionDispatchMessageSchema.parse(
        basePeer({
          type: "action.dispatch",
          seq: 1,
          actionId: "action-1",
          baseRevision: 0,
          actionType: "playCard",
          payload: { card: "ace" },
        }),
      ),
      actionAcknowledgementMessageSchema.parse(
        basePeer({
          type: "action.ack",
          seq: 2,
          actionId: "action-1",
          status: "accepted",
          revision: 1,
        }),
      ),
      stateSnapshotMessageSchema.parse(
        basePeer({
          type: "state.snapshot",
          seq: 3,
          revision: 1,
          stateHash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          term: 1,
          authorityMemberId: "member-1",
          historyMode: "full",
          processedActionIds: ["action-1"],
          state: { cards: [] },
        }),
      ),
      stateResyncMessageSchema.parse(basePeer({ type: "state.resync", seq: 6, knownRevision: 1 })),
      stateViewMessageSchema.parse(
        basePeer({
          type: "state.view",
          seq: 4,
          revision: 1,
          forMemberId: "member-2",
          view: { hand: [] },
        }),
      ),
      authorityAnnouncementMessageSchema.parse(
        basePeer({
          type: "authority.announce",
          seq: 5,
          term: 1,
          authorityMemberId: "member-1",
          stateRevision: 1,
          eligibleMemberIds: ["member-1", "member-2"],
        }),
      ),
      authorityHeartbeatMessageSchema.parse(
        basePeer({
          type: "authority.heartbeat",
          seq: 6,
          term: 1,
          authorityMemberId: "member-1",
          stateRevision: 1,
          heartbeatSeq: 0,
        }),
      ),
      authorityElectionMessageSchema.parse(
        basePeer({
          type: "authority.election",
          seq: 7,
          term: 2,
          candidateMemberId: "member-2",
          observed: [{ memberId: "member-1", revision: 1 }],
        }),
      ),
      simulationInputMessageSchema.parse(
        basePeer({
          type: "simulation.input",
          seq: 8,
          inputId: "input-1",
          inputType: "move",
          payload: { dx: 1, dy: 0 },
        }),
      ),
      simulationSnapshotMessageSchema.parse(
        basePeer({
          type: "simulation.snapshot",
          seq: 9,
          tick: 120,
          term: 1,
          authorityMemberId: "member-1",
          state: { players: [] },
        }),
      ),
      gameReadyMessageSchema.parse(basePeer({ type: "game.ready" })),
      gameControlsMessageSchema.parse(
        basePeer({ type: "game.controls", controls: { left: true } }),
      ),
      gameStartMessageSchema.parse(basePeer({ type: "game.start" })),
      gameEndMessageSchema.parse(basePeer({ type: "game.end", reason: "user_exit" })),
      rawChannelMetadataMessageSchema.parse(
        basePeer({
          type: "raw.channel",
          channelName: "chat",
        }),
      ),
      rawChannelCloseMessageSchema.parse(
        basePeer({
          type: "raw.close",
          channelName: "chat",
        }),
      ),
      gameSourceMetadataMessageSchema.parse(
        basePeer({
          type: "game.source.metadata",
          gameId: "game-1",
          title: "Rocket Rumble",
          apiVersion: 1,
          mode: "state",
          sourceSha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          sourceSizeBytes: 2048,
        }),
      ),
      gameSourceAcceptedMessageSchema.parse(
        basePeer({
          type: "game.source.accepted",
          gameId: "game-1",
          sourceSha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        }),
      ),
      gameSourceDiscoverMessageSchema.parse(
        basePeer({
          type: "game.source.discover",
          gameId: "game-1",
          sourceSha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        }),
      ),
    ];
    expect(validExamples).toHaveLength(PEER_MESSAGE_TYPES.length);
  });

  it("rejects an invalid example of every peer message", () => {
    const invalidExamples: unknown[] = [
      // Wrong payload types, missing required fields, and bad values.
      basePeer({ type: "party.context", creatorMemberId: "" }),
      basePeer({ type: "party.rename", displayName: "" }),
      basePeer({
        type: "party.classicRoom",
        gameId: "protobowl",
        player: { url: "" },
      }),
      basePeer({ type: "party.classicRoom.request", sessionId: "" }),
      basePeer({ type: "party.kick", targetMemberId: "" }),
      basePeer({ type: "party.reloadAll", sessionId: "" }),
      basePeer({ type: "player.identity", authorityEligible: "yes" }),
      basePeer({ type: "peer.connectionStatus", status: "connected" }),
      basePeer({ type: "peer.capabilities", protocolVersions: [], gameModes: [] }),
      basePeer({
        type: "action.dispatch",
        seq: 1,
        actionId: "action-1",
        baseRevision: -1,
        actionType: "x",
      }),
      basePeer({ type: "action.ack", seq: 2, actionId: "action-1", status: "unknown" }),
      basePeer({ type: "state.snapshot", seq: 3, revision: 1, term: 1, state: {} }),
      basePeer({ type: "state.resync", seq: 3, knownRevision: -1 }),
      basePeer({ type: "state.view", seq: 4, revision: 1, view: {} }),
      basePeer({
        type: "authority.announce",
        seq: 5,
        term: 0,
        authorityMemberId: "member-1",
        stateRevision: 1,
        eligibleMemberIds: [],
      }),
      basePeer({ type: "authority.heartbeat", seq: 6, term: 1, stateRevision: 1, heartbeatSeq: 0 }),
      basePeer({
        type: "authority.election",
        seq: 7,
        term: 2,
        candidateMemberId: "member-2",
        observed: [{ memberId: "", revision: 0 }],
      }),
      basePeer({ type: "simulation.input", seq: 8, inputId: "input-1", inputType: "move" }),
      basePeer({ type: "simulation.snapshot", seq: 9, tick: -1, term: 1, state: {} }),
      basePeer({ type: "game.ready", seq: "one" }),
      basePeer({ type: "game.controls", seq: "one", controls: {} }),
      basePeer({ type: "game.start", seq: "one" }),
      basePeer({ type: "game.end", reason: "banana" }),
      basePeer({
        type: "raw.channel",
        channelName: "",
      }),
      basePeer({
        type: "raw.close",
        channelName: "x".repeat(65),
      }),
      basePeer({
        type: "game.source.metadata",
        gameId: "game-1",
        sourceSha256: "nope",
        sourceSizeBytes: 2048,
      }),
      basePeer({
        type: "game.source.accepted",
        gameId: "game-1",
        sourceSha256: "nope",
      }),
      basePeer({ type: "game.source.discover", sessionId: "" }),
    ];
    expect(invalidExamples).toHaveLength(PEER_MESSAGE_TYPES.length);
    for (const example of invalidExamples) {
      const result = peerMessagesSchema.safeParse(example);
      expect(result.success).toBe(false);
      const boundary = parsePeerMessage(example);
      expect(boundary.ok).toBe(false);
    }
  });

  it("rejects messages missing required envelope fields", () => {
    const { senderMemberId: _omitted, ...noSender } = basePeer({
      type: "player.identity",
      displayName: "Alex",
      authorityEligible: true,
    });
    const result = parsePeerMessage(noSender);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("invalid_message");
    }
  });

  it("bounds the increment history and resync fields strictly", () => {
    const snapshot = (overrides: Record<string, unknown>) =>
      stateSnapshotMessageSchema.safeParse(
        basePeer({
          type: "state.snapshot",
          seq: 3,
          revision: 2,
          term: 1,
          authorityMemberId: "member-1",
          historyMode: "increment",
          processedActionIds: ["action-2"],
          state: {},
          ...overrides,
        }),
      );
    expect(snapshot({}).success).toBe(true);
    expect(snapshot({ historyMode: undefined }).success).toBe(true);
    expect(
      snapshot({ processedActionIds: Array.from({ length: 257 }, (_, i) => `a${i}`) }).success,
    ).toBe(false);
    expect(
      stateResyncMessageSchema.safeParse(
        basePeer({ type: "state.resync", seq: 6, knownRevision: 1.5 }),
      ).success,
    ).toBe(false);
  });

  it("reads a snapshot from an older sender (no historyMode) as a full snapshot", () => {
    const parsed = stateSnapshotMessageSchema.parse(
      basePeer({
        type: "state.snapshot",
        seq: 3,
        revision: 1,
        term: 1,
        authorityMemberId: "member-1",
        processedActionIds: ["action-1"],
        state: {},
      }),
    );
    expect(parsed.historyMode).toBe("full");
    expect(parsed.historyComplete).toBe(true);
  });

  it("validates state delta operations strictly and bounds them", () => {
    expect(stateDeltaOpSchema.safeParse({ op: "set", path: ["count"], value: 3 }).success).toBe(
      true,
    );
    expect(stateDeltaOpSchema.safeParse({ op: "set", path: [], value: { a: 1 } }).success).toBe(
      true,
    );
    expect(stateDeltaOpSchema.safeParse({ op: "del", path: ["scores", "member-a"] }).success).toBe(
      true,
    );
    // Deletes need a key to remove.
    expect(stateDeltaOpSchema.safeParse({ op: "del", path: [] }).success).toBe(false);
    // Prototype keys can never be addressed.
    expect(stateDeltaOpSchema.safeParse({ op: "set", path: ["__proto__"], value: 1 }).success).toBe(
      false,
    );
    expect(stateDeltaOpSchema.safeParse({ op: "del", path: ["constructor"] }).success).toBe(false);
    expect(stateDeltaOpSchema.safeParse({ op: "move", path: ["a"] }).success).toBe(false);
    const deep = Array.from({ length: 33 }, () => "k");
    expect(stateDeltaOpSchema.safeParse({ op: "set", path: deep, value: 1 }).success).toBe(false);
  });

  it("bounds the number of operations in a snapshot's delta", () => {
    const ops = Array.from({ length: 513 }, (_, i) => ({ op: "set", path: [`k${i}`], value: i }));
    const snapshot = (overrides: Record<string, unknown>) =>
      stateSnapshotMessageSchema.safeParse(
        basePeer({
          type: "state.snapshot",
          seq: 3,
          revision: 2,
          term: 1,
          authorityMemberId: "member-1",
          historyMode: "increment",
          stateMode: "delta",
          baseStateHash: "a".repeat(64),
          processedActionIds: [],
          ...overrides,
        }),
      );
    expect(snapshot({ ops: ops.slice(0, 512) }).success).toBe(true);
    expect(snapshot({ ops }).success).toBe(false);
    // An older sender sends no stateMode or ops: a full snapshot, as before.
    const older = stateSnapshotMessageSchema.parse(
      basePeer({
        type: "state.snapshot",
        seq: 3,
        revision: 1,
        term: 1,
        authorityMemberId: "member-1",
        processedActionIds: [],
        state: {},
      }),
    );
    expect(older.stateMode).toBe("full");
    expect(older.ops).toBeUndefined();
  });

  it("rejects unknown message types with a useful error", () => {
    const result = parsePeerMessage(basePeer({ type: "no.such.message" }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("unknown_message_type");
      expect(result.error.message).toContain("no.such.message");
      expect(result.error.message).toContain("action.dispatch");
    }
  });

  it("requires the monotonic sequence for ordered families", () => {
    const noSeq = basePeer({
      type: "action.dispatch",
      actionId: "action-1",
      baseRevision: 0,
      actionType: "playCard",
      payload: {},
    });
    expect(parsePeerMessage(noSeq).ok).toBe(false);
  });
});
