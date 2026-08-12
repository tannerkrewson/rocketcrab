import { describe, expect, it } from "vitest";
import { parsePeerMessage } from "../errors";
import {
  PEER_MESSAGE_TYPES,
  actionAcknowledgementMessageSchema,
  actionDispatchMessageSchema,
  admissionResponseMessageSchema,
  authorityAnnouncementMessageSchema,
  authorityElectionMessageSchema,
  authorityHeartbeatMessageSchema,
  connectionStatusMessageSchema,
  gameSourceMetadataMessageSchema,
  gameSourceTransferMessageSchema,
  gameReadyMessageSchema,
  gameStartMessageSchema,
  gameEndMessageSchema,
  gameSourceCancelMessageSchema,
  gameSourceRequestMessageSchema,
  joinRequestMessageSchema,
  partyGreeterMessageSchema,
  partyIdentityMessageSchema,
  partySessionMessageSchema,
  peerCapabilitiesMessageSchema,
  peerMessagesSchema,
  playerIdentityMessageSchema,
  rawChannelMetadataMessageSchema,
  simulationInputMessageSchema,
  simulationSnapshotMessageSchema,
  stateSnapshotMessageSchema,
  stateViewMessageSchema,
  transferAcknowledgementMessageSchema,
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
      partyIdentityMessageSchema,
      partySessionMessageSchema,
      partyGreeterMessageSchema,
      playerIdentityMessageSchema,
      joinRequestMessageSchema,
      admissionResponseMessageSchema,
      connectionStatusMessageSchema,
      peerCapabilitiesMessageSchema,
      actionDispatchMessageSchema,
      actionAcknowledgementMessageSchema,
      stateSnapshotMessageSchema,
      stateViewMessageSchema,
      authorityAnnouncementMessageSchema,
      authorityHeartbeatMessageSchema,
      authorityElectionMessageSchema,
      simulationInputMessageSchema,
      simulationSnapshotMessageSchema,
      gameReadyMessageSchema,
      gameStartMessageSchema,
      gameEndMessageSchema,
      rawChannelMetadataMessageSchema,
      gameSourceMetadataMessageSchema,
      gameSourceTransferMessageSchema,
      transferAcknowledgementMessageSchema,
      gameSourceRequestMessageSchema,
      gameSourceCancelMessageSchema,
    ];
    expect(schemas).toHaveLength(PEER_MESSAGE_TYPES.length);
    for (const schema of schemas) {
      expect(schema).toBeDefined();
    }
  });

  it("parses a valid example of every peer message", () => {
    const validExamples = [
      partyIdentityMessageSchema.parse(
        basePeer({
          type: "party.identity",
          partyCode: "ABCD",
          memberCount: 2,
        }),
      ),
      partySessionMessageSchema.parse(
        basePeer({
          type: "party.session",
          partyCode: "ABCD",
          secret: "A".repeat(43),
        }),
      ),
      partyGreeterMessageSchema.parse(
        basePeer({
          type: "party.greeter",
          greeterMemberId: "member-2",
        }),
      ),
      playerIdentityMessageSchema.parse(
        basePeer({
          type: "player.identity",
          displayName: "Alex",
          authorityEligible: true,
        }),
      ),
      joinRequestMessageSchema.parse(
        basePeer({
          type: "join.request",
          partyCode: "ABCD",
          displayName: "Alex",
        }),
      ),
      admissionResponseMessageSchema.parse(
        basePeer({
          type: "join.admission",
          partyCode: "ABCD",
          decision: "approved",
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
          processedActionIds: ["action-1"],
          state: { cards: [] },
        }),
      ),
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
      gameStartMessageSchema.parse(basePeer({ type: "game.start" })),
      gameEndMessageSchema.parse(basePeer({ type: "game.end", reason: "user_exit" })),
      rawChannelMetadataMessageSchema.parse(
        basePeer({
          type: "raw.channel",
          channelName: "chat",
          reliability: "reliable",
          ordering: "ordered",
          binaryPayloads: false,
          broadcast: true,
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
          chunkCount: 4,
        }),
      ),
      gameSourceTransferMessageSchema.parse(
        basePeer({
          type: "game.source.chunk",
          gameId: "game-1",
          sourceSha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          chunkIndex: 0,
          chunkCount: 4,
          chunk: "<html>",
        }),
      ),
      transferAcknowledgementMessageSchema.parse(
        basePeer({
          type: "game.source.ack",
          gameId: "game-1",
          sourceSha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          status: "received",
        }),
      ),
      gameSourceRequestMessageSchema.parse(
        basePeer({
          type: "game.source.request",
          gameId: "game-1",
          sourceSha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        }),
      ),
      gameSourceCancelMessageSchema.parse(
        basePeer({
          type: "game.source.cancel",
          gameId: "game-1",
          sourceSha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          reason: "leaving",
        }),
      ),
    ];
    expect(validExamples).toHaveLength(PEER_MESSAGE_TYPES.length);
  });

  it("rejects an invalid example of every peer message", () => {
    const invalidExamples: unknown[] = [
      // Wrong payload types, missing required fields, and bad values.
      basePeer({ type: "party.identity", partyCode: "ABC", memberCount: 0 }),
      basePeer({ type: "party.session", partyCode: "ABCD", secret: "nope" }),
      basePeer({ type: "party.greeter", greeterMemberId: "" }),
      basePeer({ type: "player.identity", authorityEligible: "yes" }),
      basePeer({ type: "join.request", partyCode: "ABCD" }),
      basePeer({ type: "join.admission", partyCode: "ABCD", decision: "maybe" }),
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
      basePeer({ type: "game.start", seq: "one" }),
      basePeer({ type: "game.end", reason: "banana" }),
      basePeer({
        type: "raw.channel",
        channelName: "chat",
        reliability: "sometimes",
        ordering: "ordered",
        binaryPayloads: false,
        broadcast: true,
      }),
      basePeer({
        type: "game.source.metadata",
        gameId: "game-1",
        sourceSha256: "nope",
        sourceSizeBytes: 2048,
        chunkCount: 4,
      }),
      basePeer({
        type: "game.source.chunk",
        gameId: "game-1",
        sourceSha256: "nope",
        chunkIndex: 0,
        chunkCount: 4,
        chunk: "<html>",
      }),
      basePeer({
        type: "game.source.ack",
        gameId: "game-1",
        sourceSha256: "nope",
        status: "received",
      }),
      basePeer({ type: "game.source.request", gameId: "" }),
      basePeer({
        type: "game.source.request",
        sourceSha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      }),
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
