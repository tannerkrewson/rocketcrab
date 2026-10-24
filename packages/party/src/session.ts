import type { ClassicUrlSpecMessage, MemberId, SessionSecret } from "@rocketcrab/protocol";
import { sessionSecretSchema } from "@rocketcrab/protocol";
import type { NovaTransport, TransportMessage } from "@rocketcrab/core";
import { deriveSessionMaterial, generateSessionSecret, type SessionMaterial } from "./secrets";
import {
  PARTY_CONTROL_CHANNEL,
  buildPartyContextMessage,
  buildPartyClassicRoomMessage,
  buildPartyClassicRoomRequestMessage,
  buildPartyKickMessage,
  buildPartyReloadAllMessage,
  buildPartyRenameMessage,
  parsePartyControlMessage,
} from "./messages";

export type Scheduler = (callback: () => void, delayMs: number) => () => void;
export interface PartyIdentity {
  readonly memberId: MemberId;
  readonly displayName?: string;
}
export interface PartyTransportFactory {
  createPrivateTransport(identity: PartyIdentity & { readonly password: string }): NovaTransport;
}
export type PartyEvent =
  | { readonly type: "host"; readonly hostMemberId: MemberId | null }
  | { readonly type: "memberJoined" | "memberLeft"; readonly memberId: MemberId }
  | { readonly type: "memberRenamed"; readonly memberId: MemberId; readonly displayName: string }
  | {
      readonly type: "classicRoom";
      readonly gameId: string;
      readonly player: ClassicUrlSpecMessage;
      readonly host?: Partial<ClassicUrlSpecMessage>;
      readonly senderMemberId: MemberId;
    }
  | { readonly type: "classicRoomRequest"; readonly senderMemberId: MemberId }
  | {
      readonly type: "kick";
      readonly targetMemberId: MemberId;
      readonly reason?: string;
      readonly senderMemberId: MemberId;
    }
  | { readonly type: "reloadAll"; readonly senderMemberId: MemberId }
  | { readonly type: "error"; readonly error: unknown };
export type PartyErrorCode =
  | "invalid_invite"
  | "invalid_state"
  | "peer_unreachable"
  | "connection_lost"
  | "cancelled";
export class PartyError extends Error {
  constructor(
    readonly code: PartyErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PartyError";
  }
}

/** One password-protected room. Discovery and peer recovery belong to Trystero.
 * Anyone with the private invite may join; there is no admission role or room backend.
 * Shell host selection is cooperative, not a consensus algorithm or a security boundary.
 * Game authority and its history reconciliation are owned by nova-api, not this layer.
 */
export class PartySession {
  readonly privateTransport: NovaTransport;
  readonly secret: SessionSecret;
  readonly material: SessionMaterial;
  readonly memberId: MemberId;
  readonly role: "creator" | "joiner";
  readonly factory: PartyTransportFactory;
  private creatorMemberId: MemberId | null;
  private disposed = false;
  private readonly listeners = new Set<(event: PartyEvent) => void>();
  private readonly unsubscribers: Array<() => void> = [];
  private readonly renamedNames = new Map<MemberId, string>();

  constructor(config: {
    role: "creator" | "joiner";
    memberId: MemberId;
    secret: SessionSecret;
    material: SessionMaterial;
    factory: PartyTransportFactory;
    privateTransport: NovaTransport;
  }) {
    this.role = config.role;
    this.memberId = config.memberId;
    this.secret = config.secret;
    this.material = config.material;
    this.factory = config.factory;
    this.privateTransport = config.privateTransport;
    this.creatorMemberId = config.role === "creator" ? config.memberId : null;
    this.unsubscribers.push(
      this.privateTransport.on("peer:joined", (peer) => {
        this.renamedNames.delete(peer.memberId);
        this.emit({ type: "memberJoined", memberId: peer.memberId });
        this.emit({ type: "host", hostMemberId: this.hostMemberId });
        void this.announceContext().catch((error) => this.emit({ type: "error", error }));
      }),
      this.privateTransport.on("peer:left", (peer) => {
        this.renamedNames.delete(peer.memberId);
        this.emit({ type: "memberLeft", memberId: peer.memberId });
        this.emit({ type: "host", hostMemberId: this.hostMemberId });
      }),
      this.privateTransport.on("message:received", (message) => this.receive(message)),
    );
  }
  get members(): readonly MemberId[] {
    return [
      ...new Set([this.memberId, ...this.privateTransport.peers.map((peer) => peer.memberId)]),
    ];
  }
  get hostMemberId(): MemberId | null {
    // Wait for an existing participant's context before offering host controls
    // to a joining player. The creator remains preferred while connected.
    if (this.creatorMemberId === null) return null;
    const members = this.members;
    return members.includes(this.creatorMemberId)
      ? this.creatorMemberId
      : ([...members].sort()[0] ?? null);
  }
  get amHost(): boolean {
    return this.hostMemberId === this.memberId;
  }
  getMemberName(memberId: MemberId): string {
    return (
      this.renamedNames.get(memberId) ??
      this.privateTransport.peers.find((peer) => peer.memberId === memberId)?.displayName ??
      memberId
    );
  }
  onEvent(handler: (event: PartyEvent) => void): () => void {
    this.listeners.add(handler);
    return () => {
      this.listeners.delete(handler);
    };
  }
  async initialize(): Promise<void> {
    try {
      await this.privateTransport.join({
        room: this.material.roomId,
        sessionId: this.material.sessionId,
      });
    } catch (error) {
      await this.leave();
      throw error;
    }
  }
  async leave(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.listeners.clear();
    this.renamedNames.clear();
    await this.privateTransport.leave().catch(() => undefined);
  }
  private base() {
    return {
      sessionId: this.material.sessionId,
      senderMemberId: this.memberId,
      senderConnectionId: this.privateTransport.selfConnectionId,
    };
  }
  private async announceContext(): Promise<void> {
    if (this.creatorMemberId === null || this.disposed) return;
    await this.privateTransport.send({
      channel: PARTY_CONTROL_CHANNEL,
      payload: buildPartyContextMessage(this.base(), { creatorMemberId: this.creatorMemberId }),
    });
  }
  async announceRename(displayName: string): Promise<void> {
    if (this.disposed) return;
    await this.privateTransport.send({
      channel: PARTY_CONTROL_CHANNEL,
      payload: buildPartyRenameMessage(this.base(), { displayName }),
    });
  }
  async announceClassicRoom(input: {
    gameId: string;
    player: ClassicUrlSpecMessage;
    host?: Partial<ClassicUrlSpecMessage>;
  }): Promise<void> {
    if (!this.amHost || this.disposed) return;
    await this.privateTransport.send({
      channel: PARTY_CONTROL_CHANNEL,
      payload: buildPartyClassicRoomMessage(this.base(), input),
    });
  }
  async requestClassicRoom(): Promise<void> {
    if (this.disposed) return;
    await this.privateTransport.send({
      channel: PARTY_CONTROL_CHANNEL,
      payload: buildPartyClassicRoomRequestMessage(this.base()),
    });
  }
  /** Cooperative removal only: a reusable invite cannot permanently exclude its holder. */
  async kickMember(targetMemberId: MemberId, reason?: string): Promise<void> {
    if (!this.amHost || this.disposed) return;
    await this.privateTransport.send({
      channel: PARTY_CONTROL_CHANNEL,
      payload: buildPartyKickMessage(this.base(), {
        targetMemberId,
        ...(reason !== undefined ? { reason } : {}),
      }),
    });
  }
  async announceReloadAll(): Promise<void> {
    if (!this.amHost || this.disposed) return;
    await this.privateTransport.send({
      channel: PARTY_CONTROL_CHANNEL,
      payload: buildPartyReloadAllMessage(this.base()),
    });
  }
  private receive(message: TransportMessage): void {
    if (
      this.disposed ||
      message.channel !== PARTY_CONTROL_CHANNEL ||
      message.sessionId !== this.material.sessionId
    )
      return;
    const parsed = parsePartyControlMessage(message.payload);
    if (!parsed.ok) return;
    const value = parsed.value;
    if (
      value.sessionId !== this.material.sessionId ||
      value.senderMemberId !== message.senderMemberId ||
      value.senderConnectionId !== message.senderConnectionId
    )
      return;
    if (
      !this.privateTransport.peers.some(
        (peer) =>
          peer.memberId === message.senderMemberId &&
          peer.connectionId === message.senderConnectionId,
      )
    )
      return;
    switch (value.type) {
      case "party.context":
        if (this.creatorMemberId === null) {
          this.creatorMemberId = value.creatorMemberId;
          this.emit({ type: "host", hostMemberId: this.hostMemberId });
          // Peers that joined concurrently may have missed each other's context.
          void this.announceContext().catch((error) => this.emit({ type: "error", error }));
        }
        break;
      case "party.rename":
        this.renamedNames.set(message.senderMemberId, value.displayName);
        this.emit({
          type: "memberRenamed",
          memberId: message.senderMemberId,
          displayName: value.displayName,
        });
        break;
      case "party.classicRoom.request":
        this.emit({ type: "classicRoomRequest", senderMemberId: message.senderMemberId });
        break;
      case "party.classicRoom":
        if (message.senderMemberId !== this.hostMemberId) return;
        this.emit({
          type: "classicRoom",
          gameId: value.gameId,
          player: value.player,
          ...(value.host !== undefined ? { host: value.host } : {}),
          senderMemberId: message.senderMemberId,
        });
        break;
      case "party.kick":
        if (message.senderMemberId !== this.hostMemberId) return;
        this.emit({
          type: "kick",
          targetMemberId: value.targetMemberId,
          ...(value.reason !== undefined ? { reason: value.reason } : {}),
          senderMemberId: message.senderMemberId,
        });
        break;
      case "party.reloadAll":
        if (message.senderMemberId === this.hostMemberId)
          this.emit({ type: "reloadAll", senderMemberId: message.senderMemberId });
        break;
    }
  }
  private emit(event: PartyEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

export interface CreatePartyOptions extends PartyIdentity {
  readonly transportFactory: PartyTransportFactory;
  readonly derive?: (secret: SessionSecret) => Promise<SessionMaterial>;
}
export interface JoinByInviteOptions extends CreatePartyOptions {
  readonly secret: string;
}
async function enter(
  options: CreatePartyOptions,
  secret: SessionSecret,
  role: "creator" | "joiner",
): Promise<PartySession> {
  const material = await (options.derive ?? deriveSessionMaterial)(secret);
  const privateTransport = options.transportFactory.createPrivateTransport({
    memberId: options.memberId,
    displayName: options.displayName,
    password: material.password,
  });
  const session = new PartySession({
    role,
    memberId: options.memberId,
    secret,
    material,
    factory: options.transportFactory,
    privateTransport,
  });
  await session.initialize();
  return session;
}
export async function createParty(options: CreatePartyOptions): Promise<PartySession> {
  return enter(options, generateSessionSecret(), "creator");
}
export async function joinPartyByInvite(options: JoinByInviteOptions): Promise<PartySession> {
  const secret = sessionSecretSchema.safeParse(options.secret);
  if (!secret.success)
    throw new PartyError(
      "invalid_invite",
      "This invite link is invalid. Ask a friend for a new link.",
    );
  return enter(options, secret.data, "joiner");
}
