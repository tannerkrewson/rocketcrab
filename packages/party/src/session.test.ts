import { describe, expect, it } from "vitest";
import { InMemoryTransportHub } from "@rocketcrab/testing";
import {
  createParty,
  joinPartyByInvite,
  type PartyTransportFactory,
  type PartyEvent,
} from "./session";
import {
  PARTY_CONTROL_CHANNEL,
  buildPartyKickMessage,
  buildPartyReloadAllMessage,
} from "./messages";

function world() {
  const hub = new InMemoryTransportHub({ schedule: () => () => undefined });
  const passwords: string[] = [];
  const factory: PartyTransportFactory = {
    createPrivateTransport(identity) {
      passwords.push(identity.password);
      return hub.createTransport(identity);
    },
  };
  const derive = async (secret: string) => ({
    secret,
    roomId: `party:${secret}`,
    password: `password:${secret}`,
    sessionId: `session:${secret}`,
  });
  const settle = async () => {
    for (let i = 0; i < 8; i++) {
      hub.drain();
      await Promise.resolve();
    }
  };
  return { hub, factory, passwords, derive, settle };
}
describe("private party sessions", () => {
  it("creates exactly one transport per participant, automatically joins and deterministically hands off shell controls", async () => {
    const w = world();
    const a = await createParty({
      memberId: "z-creator",
      transportFactory: w.factory,
      derive: w.derive,
    });
    const b = await joinPartyByInvite({
      memberId: "b",
      secret: a.secret,
      transportFactory: w.factory,
      derive: w.derive,
    });
    const c = await joinPartyByInvite({
      memberId: "c",
      secret: a.secret,
      transportFactory: w.factory,
      derive: w.derive,
    });
    await w.settle();
    expect(w.passwords).toHaveLength(3);
    expect(new Set(w.passwords).size).toBe(1);
    expect([a.hostMemberId, b.hostMemberId, c.hostMemberId]).toEqual([
      a.memberId,
      a.memberId,
      a.memberId,
    ]);
    await a.leave();
    await w.settle();
    expect(b.amHost).toBe(true);
    expect(c.hostMemberId).toBe("b");
    const d = await joinPartyByInvite({
      memberId: "d",
      secret: a.secret,
      transportFactory: w.factory,
      derive: w.derive,
    });
    await w.settle();
    expect(d.hostMemberId).toBe("b");
    await b.leave();
    await w.settle();
    expect(c.amHost).toBe(true);
    expect(d.hostMemberId).toBe("c");
    await c.leave();
    await d.leave();
    await w.settle();
    const stale = await joinPartyByInvite({
      memberId: "stale",
      secret: a.secret,
      transportFactory: w.factory,
      derive: w.derive,
    });
    await w.settle();
    expect(stale.privateTransport.peers).toEqual([]);
    expect(stale.hostMemberId).toBeNull(); // cannot silently recreate an ended party
    await stale.leave();
  });
  it("ignores non-host controls, wrong-session and forged sender envelopes", async () => {
    const w = world();
    const a = await createParty({ memberId: "a", transportFactory: w.factory, derive: w.derive });
    const b = await joinPartyByInvite({
      memberId: "b",
      secret: a.secret,
      transportFactory: w.factory,
      derive: w.derive,
    });
    await w.settle();
    const events: PartyEvent[] = [];
    a.onEvent((e) => events.push(e));
    const base = {
      sessionId: a.material.sessionId,
      senderMemberId: b.memberId,
      senderConnectionId: b.privateTransport.selfConnectionId,
    };
    await b.privateTransport.send({
      channel: PARTY_CONTROL_CHANNEL,
      payload: buildPartyKickMessage(base, { targetMemberId: a.memberId }),
    });
    await b.privateTransport.send({
      channel: PARTY_CONTROL_CHANNEL,
      payload: buildPartyReloadAllMessage({ ...base, senderMemberId: a.memberId }),
    });
    await b.privateTransport.send({
      channel: PARTY_CONTROL_CHANNEL,
      payload: buildPartyReloadAllMessage({ ...base, sessionId: "wrong-session" }),
    });
    await w.settle();
    expect(events).toEqual([]);
    const received: PartyEvent[] = [];
    b.onEvent((e) => received.push(e));
    await a.kickMember(b.memberId, "Leave for now. The invite remains reusable.");
    await w.settle();
    expect(received).toContainEqual(
      expect.objectContaining({ type: "kick", targetMemberId: b.memberId }),
    );
    await a.leave();
    await b.leave();
  });
  it("rejects malformed invites before allocating resources without echoing secrets", async () => {
    const w = world();
    await expect(
      joinPartyByInvite({ memberId: "b", secret: "never-log-me", transportFactory: w.factory }),
    ).rejects.toThrow("This invite link is invalid");
    expect(w.passwords).toEqual([]);
  });
});
