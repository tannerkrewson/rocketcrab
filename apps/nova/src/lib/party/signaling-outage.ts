import type { Scheduler } from "@rocketcrab/party";

export const SIGNALING_OUTAGE_MESSAGE =
  "Can't reach rocketcrab's servers. Check your internet connection.";

/** Tracks continuous loss of our own signaling connection, not peer health. */
export class SignalingOutage {
  private disconnected = false;
  private visible = false;
  private cancelTimer: (() => void) | null = null;

  constructor(
    private readonly schedule: Scheduler,
    private readonly onChange: (visible: boolean) => void,
  ) {}

  update(connected: boolean): void {
    if (connected) {
      this.disconnected = false;
      this.cancelTimer?.();
      this.cancelTimer = null;
      if (this.visible) {
        this.visible = false;
        this.onChange(false);
      }
    } else if (!this.disconnected) {
      this.disconnected = true;
      this.cancelTimer = this.schedule(() => {
        this.cancelTimer = null;
        if (!this.disconnected) return;
        this.visible = true;
        this.onChange(true);
      }, 5_000);
    }
  }

  reset(): void {
    this.update(true);
  }
}
