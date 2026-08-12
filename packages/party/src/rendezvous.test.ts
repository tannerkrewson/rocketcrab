import { describe, expect, it } from "vitest";
import type { TransportMessage } from "@rocketcrab/core";
import type { PartyCode } from "@rocketcrab/protocol";
import { InMemoryTransportHub } from "@rocketcrab/testing";
import { PARTY_CONTROL_CHANNEL, parsePartyControlMessage } from "./messages";
import { PARTY_CODE_ALPHABET } from "./code";
import { buildInviteUrl, parseInviteUrl } from "./invite";
import {
  PartySession,
  createParty,
  joinPartyByCode,
  joinPartyByInvite,
  rendezvousRoomName,
  rendezvousSessionId,
  type CreatePartyOptions,
  type JoinByCodeOptions,
  type PartyAdvert,
  type PartyEvent,
  type PartyTransportFactory,
} from "./rendezvous";

/**
 * Deterministic P2 flow tests: creation, joining by four letters, admission
 * approval/rejection, malformed request rejection, code-guessing, collisions
 * (creator regeneration + joiner picker), greeter migration, invite links,
 * and listener cleanup (engineering rule 22 / F11). All run over the
 * InMemoryTransport hub with an injected fake clock — no real timers, no
 * network — so CI runs are exact.
 */

// ---------------------------------------------------------------------------
// Fake clock (same pattern as the P1 adapter tests)
// ---------------------------------------------------------------------------

interface FakeClock {
  now: () => number;
  schedule: (callback: () => void, delayMs: number) => () => void;
  advance: (ms: number) => void;
}

function makeFakeClock(): FakeClock {
  let t = 0;
  let order = 0;
  const timers: Array<{ at: number; order: number; cb: () => void; active: boolean }> = [];
  return {
    now: () => t,
    schedule: (cb, delayMs) => {
      const timer = { at: t + delayMs, order: order++, cb, active: true };
      timers.push(timer);
      return () => {
        timer.active = false;
      };
    },
    advance: (ms: number) => {
      const deadline = t + ms;
      for (;;) {
        const due = timers
          .filter((timer) => timer.active && timer.at <= deadline)
          .sort((a, b) => a.at - b.at || a.order - b.order)[0];
        if (due === undefined) {
          break;
        }
        due.active = false;
        t = Math.max(t, due.at);
        due.cb();
      }
      t = deadline;
    },
  };
}

// ---------------------------------------------------------------------------
// World: one hub + clock + transport factory
// ---------------------------------------------------------------------------

interface World {
  clock: FakeClock;
  hub: InMemoryTransportHub;
  factory: PartyTransportFactory;
}

function makeWorld(): World {
  const clock = makeFakeClock();
  const hub = new InMemoryTransportHub({ schedule: clock.schedule, now: clock.now });
  const factory: PartyTransportFactory = {
    createRendezvousTransport: (identity) => hub.createTransport(identity),
    createPrivateTransport: (identity) => hub.createTransport(identity),
  };
  return { clock, hub, factory };
}

/** Drain the hub and flush promise chains a few times (deterministic). */
async function settle(world: World): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    world.hub.drain();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/** Let real async (crypto derivation, transport joins) make progress. */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function membersOf(world: World, room: string): string[] {
  return [...world.hub.membersOf(room)].map((transport) => transport.selfMemberId);
}

function sorted(members: readonly string[]): string[] {
  return [...members].sort();
}

/** Deterministic (microtask-only) derivation so flows never wait on crypto. */
function mockDerive(secret: string) {
  return Promise.resolve({
    secret,
    roomId: `party:test:${secret.slice(0, 12)}`,
    password: `pwd-${secret.slice(0, 16)}`,
    sessionId: `session-${secret.slice(0, 12)}`,
  });
}

/** Index of a code in the 23^4 code space (for injectable codeRngs). */
function codeIndex(code: string): number {
  let value = 0;
  for (let i = 0; i < code.length; i += 1) {
    const char = code.charAt(i);
    value += PARTY_CODE_ALPHABET.indexOf(char) * PARTY_CODE_ALPHABET.length ** (3 - i);
  }
  return value;
}

/** Create a party; advances the fake clock until the collision window fires. */
async function makeCreator(
  world: World,
  overrides: Partial<CreatePartyOptions> = {},
): Promise<PartySession> {
  const promise = createParty({
    memberId: "creator",
    transportFactory: world.factory,
    schedule: world.clock.schedule,
    collisionListenMs: 1000,
    collisionRetries: 2,
    advertIntervalMs: 5000,
    onJoinRequest: () => true,
    codeRng: () => 0,
    partyName: "Party One",
    gameTitle: "Rocket Rumble",
    derive: mockDerive,
    ...overrides,
  });
  // The collision window timer is armed on microtasks (the mock derivation
  // resolves synchronously), so a short flush + a generous advance fires it.
  for (let i = 0; i < 6; i += 1) {
    await flush();
    world.clock.advance(2000);
  }
  const party = await promise;
  await settle(world);
  return party;
}

/** Join a party by code; advances through discovery and admission. */
async function makeJoiner(
  world: World,
  overrides: Partial<JoinByCodeOptions> = {},
): Promise<PartySession> {
  const promise = joinPartyByCode({
    code: "AAAA",
    memberId: "joiner",
    displayName: "Joiner",
    transportFactory: world.factory,
    schedule: world.clock.schedule,
    discoveryTimeoutMs: 20_000,
    admissionTimeoutMs: 30_000,
    advertIntervalMs: 5000,
    onJoinRequest: () => true,
    derive: mockDerive,
    ...overrides,
  });
  await flush(); // let the joiner attach its discovery listener first
  world.clock.advance(5000); // the greeter's next advert fires
  await settle(world);
  world.clock.advance(2000); // the advert settle window closes
  await settle(world);
  await settle(world);
  const party = await promise;
  await settle(world);
  return party;
}

// ---------------------------------------------------------------------------
// Flow tests
// ---------------------------------------------------------------------------

describe("creation + joining by four letters (ADR-0004)", () => {
  it("creates a party without a backend and lets another device join by code", async () => {
    const world = makeWorld();
    const events: PartyEvent[] = [];
    const creator = await makeCreator(world, { onEvent: (e) => events.push(e) });

    expect(creator.code).toBe("AAAA");
    expect(creator.amGreeter).toBe(true);
    expect(creator.greeterMemberId).toBe("creator");
    expect(creator.members).toEqual(["creator"]);
    expect(creator.rendezvousTransport).not.toBeNull();
    expect(creator.privateTransport.connectionState).toBe("connected");
    expect(membersOf(world, rendezvousRoomName("AAAA"))).toEqual(["creator"]);
    // The private room exists and is NOT the rendezvous room.
    expect(creator.material.roomId).not.toBe(rendezvousRoomName("AAAA"));
    expect(membersOf(world, creator.material.roomId)).toEqual(["creator"]);

    const joiner = await makeJoiner(world);

    expect(joiner.code).toBe("AAAA");
    expect(joiner.material).toEqual(creator.material);
    expect(joiner.greeterMemberId).toBe("creator");
    expect(joiner.amGreeter).toBe(false);
    expect(joiner.rendezvousTransport).toBeNull();
    expect(sorted(joiner.members)).toEqual(["creator", "joiner"]);
    expect(sorted(creator.members)).toEqual(["creator", "joiner"]);
    // Joiner step 9: the rendezvous connection was dropped after joining.
    expect(membersOf(world, rendezvousRoomName("AAAA"))).toEqual(["creator"]);
    // Both ride the private room (high-entropy derived name).
    expect(membersOf(world, creator.material.roomId).sort()).toEqual(["creator", "joiner"]);
    expect(events.some((e) => e.type === "memberJoined" && e.memberId === "joiner")).toBe(true);
    expect(events.some((e) => e.type === "greeter" && e.greeterMemberId === "creator")).toBe(true);
  });

  it("normalizes the entered code (lowercase/whitespace) before joining", async () => {
    const world = makeWorld();
    const creator = await makeCreator(world);
    const joiner = await makeJoiner(world, { code: "  aaaa  " });
    expect(joiner.code).toBe("AAAA");
    expect(joiner.material).toEqual(creator.material);
  });

  it("rejects a non-four-letter code with a clear error", async () => {
    const world = makeWorld();
    await expect(
      joinPartyByCode({
        code: "ABC1",
        memberId: "joiner",
        transportFactory: world.factory,
        schedule: world.clock.schedule,
      }),
    ).rejects.toMatchObject({ code: "invalid_code" });
  });
});

describe("admission (ADR-0004 steps 8-9)", () => {
  it("rejects a join request when the policy says no (code guessing is not admission)", async () => {
    const world = makeWorld();
    const admissionEvents: PartyEvent[] = [];
    const creator = await makeCreator(world, {
      onJoinRequest: () => false,
      onEvent: (e) => admissionEvents.push(e),
    });
    const joinerPromise = joinPartyByCode({
      code: "AAAA",
      memberId: "guesser",
      displayName: "Guesser",
      transportFactory: world.factory,
      schedule: world.clock.schedule,
    });
    const rejection = expect(joinerPromise).rejects.toMatchObject({
      code: "rejected",
      reason: "greeter_rejected",
    });
    await flush(); // discovery listener attaches first
    world.clock.advance(5000);
    await settle(world);
    world.clock.advance(2000);
    await settle(world);
    await settle(world);

    await rejection;
    // The rejected joiner left the rendezvous immediately (F4/F11).
    expect(membersOf(world, rendezvousRoomName("AAAA"))).toEqual(["creator"]);
    expect(membersOf(world, creator.material.roomId)).toEqual(["creator"]);
    expect(
      admissionEvents.some(
        (e) => e.type === "admission" && e.memberId === "guesser" && e.decision === "rejected",
      ),
    ).toBe(true);
  });

  it("rejects malformed join requests explicitly (invalid_request)", async () => {
    const world = makeWorld();
    await makeCreator(world, { onJoinRequest: () => true });

    // A raw probe joins the rendezvous room and sends a malformed
    // join.request (missing displayName) targeted at the greeter.
    const probe = world.hub.createTransport({ memberId: "probe", displayName: "Probe" });
    await probe.join({
      room: rendezvousRoomName("AAAA"),
      sessionId: rendezvousSessionId("AAAA"),
    });
    await settle(world);
    const received: TransportMessage[] = [];
    probe.on("message:received", (message) => received.push(message));

    const greeter = probe.peers.find((peer) => peer.memberId === "creator");
    expect(greeter).toBeDefined();
    if (greeter === undefined) {
      throw new Error("probe did not see the greeter");
    }
    await probe.send({
      channel: PARTY_CONTROL_CHANNEL,
      payload: {
        version: 1,
        sessionId: rendezvousSessionId("AAAA"),
        senderMemberId: "probe",
        senderConnectionId: probe.selfConnectionId,
        messageId: "malformed-1",
        sentAt: 1,
        type: "join.request",
        partyCode: "AAAA",
        // displayName is missing → schema-invalid
      },
      targetConnectionId: greeter.connectionId,
    });
    await settle(world);

    let rejectionDecision: string | undefined;
    let rejectionReason: string | undefined;
    for (const message of received) {
      const parsed = parsePartyControlMessage(message.payload);
      if (
        parsed.ok &&
        parsed.value.type === "join.admission" &&
        parsed.value.decision === "rejected"
      ) {
        rejectionDecision = parsed.value.decision;
        rejectionReason = parsed.value.reason;
        break;
      }
    }
    expect(rejectionDecision).toBe("rejected");
    expect(rejectionReason).toBe("invalid_request");
    // The secret handoff never reaches the malformed sender.
    expect(
      received.some((message) => {
        const parsed = parsePartyControlMessage(message.payload);
        return parsed.ok && parsed.value.type === "party.session";
      }),
    ).toBe(false);
  });

  it("rejects when the party is full (party_full)", async () => {
    const world = makeWorld();
    const creator = await makeCreator(world, { maxMembers: 2 });
    await makeJoiner(world, { memberId: "first" });

    const secondPromise = joinPartyByCode({
      code: "AAAA",
      memberId: "second",
      displayName: "Second",
      transportFactory: world.factory,
      schedule: world.clock.schedule,
    });
    const rejection = expect(secondPromise).rejects.toMatchObject({
      code: "rejected",
      reason: "party_full",
    });
    await flush();
    world.clock.advance(5000);
    await settle(world);
    world.clock.advance(2000);
    await settle(world);
    await settle(world);

    await rejection;
    expect(membersOf(world, creator.material.roomId).sort()).toEqual(["creator", "first"]);
  });

  it("fails fast with admission_timeout when the greeter never answers", async () => {
    const world = makeWorld();
    await makeCreator(world, {
      onJoinRequest: () => new Promise<boolean>(() => undefined), // hangs forever
    });
    const joinerPromise = joinPartyByCode({
      code: "AAAA",
      memberId: "patient",
      transportFactory: world.factory,
      schedule: world.clock.schedule,
      admissionTimeoutMs: 3000,
    });
    const rejection = expect(joinerPromise).rejects.toMatchObject({ code: "admission_timeout" });
    await flush();
    world.clock.advance(5000);
    await settle(world);
    world.clock.advance(2000);
    await settle(world);
    await settle(world);
    world.clock.advance(3000);
    await settle(world);

    await rejection;
    // The timed-out joiner left the rendezvous (F4).
    expect(membersOf(world, rendezvousRoomName("AAAA"))).toEqual(["creator"]);
  });

  it("never broadcasts the session secret (only a targeted post-admission handoff)", async () => {
    const world = makeWorld();
    const creator = await makeCreator(world);
    // A third peer watches the rendezvous room but is NOT the joiner.
    const probe = world.hub.createTransport({ memberId: "probe" });
    await probe.join({
      room: rendezvousRoomName("AAAA"),
      sessionId: rendezvousSessionId("AAAA"),
    });
    await settle(world);
    const probeMessages: TransportMessage[] = [];
    probe.on("message:received", (message) => probeMessages.push(message));

    await makeJoiner(world, { memberId: "joiner" });

    for (const message of probeMessages) {
      expect(JSON.stringify(message.payload)).not.toContain(creator.secret);
    }
    expect(
      probeMessages.some((message) => {
        const parsed = parsePartyControlMessage(message.payload);
        return parsed.ok && parsed.value.type === "party.session";
      }),
    ).toBe(false);
  });

  it("keeps party secrets out of game-plane messages", async () => {
    const world = makeWorld();
    const creator = await makeCreator(world);
    const joiner = await makeJoiner(world);
    const gamePlane: unknown[] = [];
    creator.privateTransport.on("message:received", (message) => {
      if (message.channel === "nova.protocol") {
        gamePlane.push(message.payload);
      }
    });
    // A game-plane message between the two members carries no secret.
    await joiner.privateTransport.send({
      channel: "nova.protocol",
      payload: { type: "game.ready" },
    });
    await settle(world);
    expect(gamePlane.length).toBeGreaterThan(0);
    for (const payload of gamePlane) {
      expect(JSON.stringify(payload)).not.toContain(joiner.secret);
      expect(JSON.stringify(payload)).not.toContain(joiner.material.password);
      expect(JSON.stringify(payload)).not.toContain(joiner.material.roomId);
    }
  });
});

describe("collisions (T13)", () => {
  it("regenerates the code when the creator detects an existing party", async () => {
    const world = makeWorld();
    const creator = await makeCreator(world);
    expect(creator.code).toBe("AAAA");

    const collisions: PartyCode[] = [];
    const codeSequence = [codeIndex("AAAA"), codeIndex("BBBB")];
    let codeStep = 0;
    const secondPromise = createParty({
      memberId: "second-creator",
      transportFactory: world.factory,
      schedule: world.clock.schedule,
      collisionListenMs: 10_000,
      collisionRetries: 2,
      advertIntervalMs: 5000,
      codeRng: () => codeSequence[codeStep++] ?? 0, // try AAAA, then BBBB
      derive: mockDerive,
      onEvent: (event) => {
        if (event.type === "collision") {
          collisions.push(event.code);
        }
      },
    });
    // Drive the fake clock: the first window (10 s) stays open long enough
    // for the first party's re-advert to arrive; the retry window then
    // closes so the second creator claims BBBB.
    for (let i = 0; i < 8; i += 1) {
      await flush();
      world.clock.advance(6000);
      await settle(world);
    }
    const second = await secondPromise;
    await settle(world);

    expect(collisions).toEqual(["AAAA"]);
    expect(second.code).toBe("BBBB");
    expect(second.material.secret).not.toBe(creator.material.secret);
    // Each party lives in its own private room and its own rendezvous.
    expect(membersOf(world, rendezvousRoomName("AAAA"))).toEqual(["creator"]);
    expect(membersOf(world, rendezvousRoomName("BBBB"))).toEqual(["second-creator"]);
  });

  it("gives up with a clear error when every code collides", async () => {
    const world = makeWorld();
    await makeCreator(world);
    const secondPromise = createParty({
      memberId: "second-creator",
      transportFactory: world.factory,
      schedule: world.clock.schedule,
      collisionListenMs: 10_000,
      collisionRetries: 0, // only one attempt, which collides
      advertIntervalMs: 5000,
      codeRng: () => 0, // always AAAA
      derive: mockDerive,
    });
    const collision = expect(secondPromise).rejects.toMatchObject({ code: "collision" });
    for (let i = 0; i < 8; i += 1) {
      await flush();
      world.clock.advance(6000);
      await settle(world);
    }
    await collision;
  });

  it("lets the joiner pick a party when a collision exposes more than one", async () => {
    const world = makeWorld();
    const a = await makeCreator(world, { memberId: "A" });

    // A second creator claims the SAME code (its collision window closes
    // before it could hear A's advert), so both parties share the code.
    const bPromise = createParty({
      memberId: "B",
      transportFactory: world.factory,
      schedule: world.clock.schedule,
      collisionListenMs: 0,
      advertIntervalMs: 5000,
      codeRng: () => 0,
      derive: mockDerive,
      onJoinRequest: () => true, // B admits joiners like any greeter
    });
    for (let i = 0; i < 4; i += 1) {
      await flush();
      world.clock.advance(1000);
    }
    const b = await bPromise;
    await settle(world);
    expect(b.code).toBe("AAAA");

    let seen: readonly PartyAdvert[] = [];
    const joinerPromise = joinPartyByCode({
      code: "AAAA",
      memberId: "J",
      displayName: "J",
      transportFactory: world.factory,
      schedule: world.clock.schedule,
      derive: mockDerive,
      selectParty: (adverts) => {
        seen = [...adverts];
        const picked = adverts.find((advert) => advert.greeterMemberId === "B");
        if (picked === undefined) {
          throw new Error("B's advert missing from the picker");
        }
        return picked;
      },
    });
    await flush();
    world.clock.advance(5000);
    await settle(world);
    world.clock.advance(2000);
    await settle(world);
    await settle(world);
    const j = await joinerPromise;
    await settle(world);

    expect(seen.length).toBe(2);
    expect(new Set(seen.map((advert) => advert.greeterMemberId)).size).toBe(2);
    expect(j.greeterMemberId).toBe("B");
    expect(j.material.secret).toBe(b.secret);
    expect(j.material.secret).not.toBe(a.secret);
    expect(sorted(j.members)).toEqual(["B", "J"]);
    expect(membersOf(world, b.material.roomId).sort()).toEqual(["B", "J"]);
  });
});

describe("greeter migration (ADR-0004)", () => {
  it("keeps the four-letter code usable after the creator leaves", async () => {
    const world = makeWorld();
    const creator = await makeCreator(world, { memberId: "creator" });
    const joiner = await makeJoiner(world, { memberId: "joiner" });
    expect(joiner.greeterMemberId).toBe("creator");
    expect(creator.amGreeter).toBe(true);
    expect(joiner.amGreeter).toBe(false);

    // The original greeter leaves: the remaining admitted member is elected
    // deterministically (lowest memberId) and takes over the rendezvous.
    await creator.leave();
    await settle(world);

    expect(joiner.amGreeter).toBe(true);
    expect(joiner.greeterMemberId).toBe("joiner");
    expect(membersOf(world, rendezvousRoomName("AAAA"))).toEqual(["joiner"]);
    expect(creator.rendezvousTransport).toBeNull();
    // The departed creator's private transport is gone too.
    expect(membersOf(world, creator.material.roomId)).toEqual(["joiner"]);

    // A LATE joiner can still join using only the four letters.
    const late = await makeJoiner(world, { memberId: "late", displayName: "Late" });
    expect(late.greeterMemberId).toBe("joiner");
    // Same party: the new greeter re-shared the original session secret.
    expect(late.material.secret).toBe(creator.secret);
    expect(late.material).toEqual(joiner.material);
    expect(sorted(late.members)).toEqual(["joiner", "late"]);
    expect(sorted(joiner.members)).toEqual(["joiner", "late"]);
  });

  it("hands the greeter role off when the greeter's rendezvous drops", async () => {
    const world = makeWorld();
    const creator = await makeCreator(world);
    const joiner = await makeJoiner(world);
    const rendezvous = creator.rendezvousTransport;
    expect(rendezvous).not.toBeNull();
    if (rendezvous === null) {
      throw new Error("creator has no rendezvous transport");
    }

    // Mobile-style suspension of the greeter's rendezvous connection.
    await rendezvous.suspend();
    await settle(world);

    expect(creator.amGreeter).toBe(false);
    expect(joiner.amGreeter).toBe(true);
    expect(joiner.greeterMemberId).toBe("joiner");
    // The joiner now greets the rendezvous room for late joiners.
    expect(membersOf(world, rendezvousRoomName("AAAA"))).toEqual(["joiner"]);
    // The creator stays in the party (greeter status is separate from
    // party membership and from game authority).
    expect(sorted(creator.members)).toEqual(["creator", "joiner"]);
  });

  it("steps the reconnected ex-greeter down so the room never has two advertisers", async () => {
    const world = makeWorld();
    const creator = await makeCreator(world);
    const joiner = await makeJoiner(world);
    expect(creator.amGreeter).toBe(true);

    // The greeter's PRIVATE connection drops (mobile suspension); the
    // remaining member elects itself and takes over the rendezvous.
    await creator.privateTransport.suspend();
    await settle(world);
    expect(joiner.amGreeter).toBe(true);
    expect(joiner.greeterMemberId).toBe("joiner");

    // The original greeter resumes: the new greeter re-announces on the
    // reconnect, and the ex-greeter steps down instead of double-advertising.
    await creator.privateTransport.resume();
    await settle(world);
    expect(creator.amGreeter).toBe(false);
    expect(creator.greeterMemberId).toBe("joiner");
    expect(creator.rendezvousTransport).toBeNull();
    expect(membersOf(world, rendezvousRoomName("AAAA"))).toEqual(["joiner"]);
    // Both stay in the party.
    expect(sorted(creator.members)).toEqual(["creator", "joiner"]);
  });
});

describe("invite links (ADR-0011)", () => {
  it("joins directly from an invite link, bypassing four-letter discovery", async () => {
    const world = makeWorld();
    const admissionSeen: PartyEvent[] = [];
    const creator = await makeCreator(world, { onEvent: (e) => admissionSeen.push(e) });

    const inviteUrl = buildInviteUrl({
      baseUrl: "https://nova.example/join",
      code: "AAAA",
      secret: creator.secret,
    });
    const parsed = parseInviteUrl(inviteUrl);
    expect(parsed).not.toBeNull();
    if (parsed === null || parsed.secret === undefined) {
      throw new Error("invite did not parse");
    }
    expect(parsed.code).toBe("AAAA");

    const invitee = await joinPartyByInvite({
      secret: parsed.secret,
      code: parsed.code,
      memberId: "invitee",
      displayName: "Invitee",
      transportFactory: world.factory,
      schedule: world.clock.schedule,
      derive: mockDerive,
    });
    await settle(world);

    expect(invitee.material).toEqual(creator.material);
    expect(invitee.code).toBe("AAAA");
    expect(sorted(invitee.members)).toEqual(["creator", "invitee"]);
    expect(sorted(creator.members)).toEqual(["creator", "invitee"]);
    // No rendezvous join and no admission exchange happened.
    expect(admissionSeen.some((e) => e.type === "joinRequest")).toBe(false);
    expect(membersOf(world, rendezvousRoomName("AAAA"))).toEqual(["creator"]);
    // The invitee learns the greeter from the private-room announcement.
    expect(invitee.greeterMemberId).toBe("creator");
  });

  it("rejects invite links with malformed secrets", async () => {
    const world = makeWorld();
    await expect(
      joinPartyByInvite({
        secret: "not-a-secret",
        memberId: "x",
        transportFactory: world.factory,
        schedule: world.clock.schedule,
      }),
    ).rejects.toMatchObject({ code: "invalid_invite" });
  });
});

describe("listener cleanup (engineering rule 22 / F11)", () => {
  it("releases both rooms and all listeners on leave", async () => {
    const world = makeWorld();
    const creator = await makeCreator(world);
    const joiner = await makeJoiner(world);
    const rendezvousRoom = rendezvousRoomName("AAAA");
    const privateRoom = creator.material.roomId;

    expect(membersOf(world, rendezvousRoom)).toEqual(["creator"]);
    expect(membersOf(world, privateRoom).sort()).toEqual(["creator", "joiner"]);

    await joiner.leave();
    await settle(world);
    expect(membersOf(world, privateRoom)).toEqual(["creator"]);
    expect(joiner.privateTransport.connectionState).toBe("disconnected");

    await creator.leave();
    await settle(world);
    expect(membersOf(world, rendezvousRoom)).toEqual([]);
    expect(membersOf(world, privateRoom)).toEqual([]);
    expect(creator.privateTransport.connectionState).toBe("disconnected");
    // Adverts stopped: advancing the clock fires no sends (no transport
    // left to receive them — the room is empty).
    world.clock.advance(20_000);
    await settle(world);
    expect(membersOf(world, rendezvousRoom)).toEqual([]);
  });

  it("leaving while joining cleans up without hanging", async () => {
    const world = makeWorld();
    const promise = createParty({
      memberId: "creator",
      transportFactory: world.factory,
      schedule: world.clock.schedule,
      collisionListenMs: 1000,
      advertIntervalMs: 5000,
      codeRng: () => 0,
      derive: mockDerive,
    });
    for (let i = 0; i < 6; i += 1) {
      await flush();
      world.clock.advance(2000);
    }
    const party = await promise;
    await settle(world);
    await party.leave();
    await settle(world);
    expect(party.privateTransport.connectionState).toBe("disconnected");
    expect(party.rendezvousTransport).toBeNull();
    expect(membersOf(world, rendezvousRoomName("AAAA"))).toEqual([]);
  });
});
