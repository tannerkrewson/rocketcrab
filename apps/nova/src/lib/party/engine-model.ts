import type { GameApiEvent, MemberId } from "@rocketcrab/protocol";
import type { PartyGame, PartyMemberView, PartyPhase, PartySourceSpec } from "./engine-types";

export interface TransferState {
  fraction: number;
  bytesTransferred: number;
  totalBytes: number;
  state: PartyMemberView["transferState"];
  detail: string | null;
}

type PartyLocation =
  | { phase: "joining"; detail: string | null; joinStage: "discovering" | "connecting" | null }
  | { phase: "creating" | "reconnecting"; detail: string | null }
  | { phase: Exclude<PartyPhase, "joining" | "creating" | "reconnecting"> };

type GameRun =
  | { status: "waiting" | "starting" | "playing" | "timed-out" }
  | { status: "ended"; reason: string };

type FrameStage = "awaiting-registration" | "reloading" | "registered" | "started";

type LocalSource = { status: "unverified" } | { status: "verified"; hash: string | null };

interface GameState {
  selection: PartyGame | null;
  run: GameRun;
  frame: FrameStage;
  tickRate: number | null;
  view: GameApiEvent | null;
  source: {
    announcedHash: string | null;
    local: LocalSource;
    pending: PartySourceSpec | null;
  };
}

function emptyGame(): GameState {
  return {
    selection: null,
    run: { status: "waiting" },
    frame: "awaiting-registration",
    tickRate: null,
    view: null,
    source: { announcedHash: null, local: { status: "unverified" }, pending: null },
  };
}

/** Party and game state. The engine applies transitions and owns transport and frame effects. */
export class PartyEngineModel {
  private location: PartyLocation = { phase: "idle" };
  private gameState = emptyGame();
  private readonly transferRows = new Map<MemberId, TransferState>();
  private readonly verifiedHashes = new Map<MemberId, string>();

  get phase(): PartyPhase {
    return this.location.phase;
  }

  get phaseDetail(): string | null {
    return "detail" in this.location ? this.location.detail : null;
  }

  get joinStage(): "discovering" | "connecting" | null {
    return this.location.phase === "joining" ? this.location.joinStage : null;
  }

  get game(): PartyGame | null {
    return this.gameState.selection;
  }

  get gameStarted(): boolean {
    return this.gameState.run.status === "playing";
  }

  get startGaveUp(): boolean {
    return this.gameState.run.status === "timed-out";
  }

  get endedReason(): string | null {
    const { run } = this.gameState;
    return run.status === "ended" ? run.reason : null;
  }

  get frameTickRate(): number | null {
    return this.gameState.tickRate;
  }

  get registered(): boolean {
    return this.gameState.frame === "registered" || this.gameState.frame === "started";
  }

  get frameStartDelivered(): boolean {
    return this.gameState.frame === "started";
  }

  get lastStateApiEvent(): GameApiEvent | null {
    return this.gameState.view;
  }

  get pendingSource(): PartySourceSpec | null {
    return this.gameState.source.pending;
  }

  get currentSourceSha256(): string | null {
    return this.gameState.source.announcedHash;
  }

  get transfers(): ReadonlyMap<MemberId, TransferState> {
    return this.transferRows;
  }

  transitionPhase(location: PartyLocation): void {
    this.location = location;
  }

  finishLeaving(phase: PartyPhase): void {
    switch (phase) {
      case "joining":
        this.transitionPhase({ phase, detail: null, joinStage: null });
        break;
      case "creating":
      case "reconnecting":
        this.transitionPhase({ phase, detail: null });
        break;
      default:
        this.transitionPhase({ phase });
    }
  }

  returnToLobbyOrGame(): void {
    this.location = { phase: this.gameStarted ? "playing" : "lobby" };
  }

  selectGame(game: PartyGame | null): void {
    this.gameState.selection = game;
  }

  reloadExternalGame(): void {
    const game = this.gameState.selection;
    if (game?.kind === "external") {
      this.selectGame({ ...game, frameEpoch: game.frameEpoch + 1 });
    }
  }

  clearGame(): void {
    this.gameState = emptyGame();
    this.transferRows.clear();
    this.verifiedHashes.clear();
  }

  beginSwitch(): void {
    this.gameState.run = { status: "waiting" };
    this.location = { phase: "switching" };
  }

  requestStart(): void {
    this.gameState.run = { status: "starting" };
    this.location = { phase: "starting" };
  }

  timeOutStart(): void {
    this.gameState.run = { status: "timed-out" };
    this.location = { phase: "lobby" };
  }

  receiveStart(): void {
    this.gameState.run = { status: "playing" };
    this.location = { phase: "playing" };
  }

  receiveEnd(reason: string): void {
    this.gameState.run = { status: "ended", reason };
    this.location = { phase: "lobby" };
  }

  resetSessionView(): void {
    this.gameState.view = null;
    if (this.registered) this.resetFrame();
  }

  rememberView(event: GameApiEvent | null): void {
    this.gameState.view = event;
  }

  resetFrame(): void {
    this.gameState.frame = "awaiting-registration";
  }

  /** Ignore old-frame registrations until the runtime acknowledges the reload. */
  requestReload(): void {
    this.gameState.frame = "reloading";
  }

  confirmReload(): void {
    if (this.gameState.frame === "reloading") this.resetFrame();
  }

  registerFrame(tickRate: number | null): boolean {
    if (this.gameState.frame === "reloading") return false;
    if (!this.frameStartDelivered) this.gameState.frame = "registered";
    this.gameState.tickRate = tickRate;
    return true;
  }

  markStartDelivered(): boolean {
    if (
      this.gameState.frame !== "registered" ||
      !this.gameStarted ||
      this.lastStateApiEvent === null
    ) {
      return false;
    }
    this.gameState.frame = "started";
    return true;
  }

  stageSource(source: PartySourceSpec | null): void {
    this.gameState.source.pending = source;
  }

  resetSource(): void {
    this.gameState.source.announcedHash = null;
    this.invalidateLocalSource();
  }

  invalidateLocalSource(): void {
    this.gameState.source.local = { status: "unverified" };
  }

  verifyLocalSource(hash: string | null): void {
    this.gameState.source.local = { status: "verified", hash };
  }

  isSourceVerified(memberId: MemberId, selfMemberId: MemberId): boolean {
    const { announcedHash, local } = this.gameState.source;
    if (memberId === selfMemberId) {
      return local.status === "verified" && local.hash === announcedHash;
    }
    return (
      this.transferRows.get(memberId)?.state === "complete" &&
      this.verifiedHashes.get(memberId) === announcedHash
    );
  }

  /** Retain the currently held bytes while a different advertised hash transfers. */
  adoptSourceHash(sourceSha256: string, selfMemberId: MemberId): void {
    this.gameState.source.announcedHash = sourceSha256;
    for (const [memberId, verified] of this.verifiedHashes) {
      if (verified === sourceSha256) continue;
      this.verifiedHashes.delete(memberId);
      this.recordTransfer(memberId, { state: "waiting", fraction: 0, detail: null });
    }
    const { local } = this.gameState.source;
    if (local.status === "verified" && local.hash !== sourceSha256) {
      this.recordTransfer(selfMemberId, { state: "waiting", fraction: 0, detail: null });
    }
  }

  markSourceVerified(memberId: MemberId, detail: string, sourceSha256: string): void {
    const announcedHash = this.currentSourceSha256;
    if (announcedHash !== null && sourceSha256 !== announcedHash) return;
    this.recordTransfer(memberId, { state: "complete", fraction: 1, detail });
    this.verifiedHashes.set(memberId, sourceSha256);
  }

  setTransfer(memberId: MemberId, transfer: TransferState): void {
    this.transferRows.set(memberId, transfer);
  }

  clearTransfer(memberId: MemberId): void {
    this.transferRows.delete(memberId);
  }

  recordTransfer(
    memberId: MemberId,
    update: {
      state: PartyMemberView["transferState"];
      fraction: number | null;
      detail: string | null;
    },
  ): void {
    const existing = this.transferRows.get(memberId) ?? {
      fraction: 0,
      bytesTransferred: 0,
      totalBytes: 0,
      state: "waiting",
      detail: null,
    };
    this.setTransfer(memberId, {
      ...existing,
      state: update.state,
      fraction: update.fraction ?? existing.fraction,
      detail: update.detail,
    });
  }
}
