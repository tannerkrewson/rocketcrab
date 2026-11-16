import { handshakeTimeoutMs } from "@rocketcrab/protocol";
import type { Scheduler } from "@rocketcrab/party";
import type { PeerLinkStatus } from "./engine";

/** Tracks the generic alert for a peer switching to or failing on a tunnel. */
export class PeerLinkAlert {
  private statusValue: PeerLinkStatus = null;
  private cancelWindow: (() => void) | null = null;

  constructor(
    private readonly schedule: Scheduler,
    private readonly isActive: () => boolean,
    private readonly emit: () => void,
  ) {}

  get status(): PeerLinkStatus {
    return this.statusValue;
  }

  switched(): void {
    if (!this.isActive()) return;
    if (this.statusValue !== "failed") {
      this.cancelTimer();
      this.cancelWindow = this.schedule(() => {
        this.cancelWindow = null;
        if (this.statusValue !== "connecting") return;
        this.statusValue = null;
        this.emit();
      }, handshakeTimeoutMs);
      this.statusValue = "connecting";
    }
    // Emit even when the alert is unchanged: relayed diagnostics may change.
    this.emit();
  }

  failed(): void {
    if (!this.isActive()) return;
    this.cancelTimer();
    if (this.statusValue === "failed") return;
    this.statusValue = "failed";
    this.emit();
  }

  /** Any admitted peer clears the generic alert; the hooks do not identify pairs. */
  peerJoined(): void {
    if (this.statusValue === null) return;
    this.clear();
    this.emit();
  }

  clear(): void {
    this.cancelTimer();
    this.statusValue = null;
  }

  private cancelTimer(): void {
    this.cancelWindow?.();
    this.cancelWindow = null;
  }
}
