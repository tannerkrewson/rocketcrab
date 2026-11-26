import { StateEngineElection } from "./state-engine-election";

/** Run the fixed-step clock while this engine holds authority. */
export abstract class StateEngineTicks extends StateEngineElection {
  /**
   * Run the game's tick on this engine while it is the authority. The rate
   * comes from this player's own game frame, which declares the same rate on
   * every device; null turns ticking off.
   */
  setTickRate(rate: number | null): void {
    this.tickRate = rate;
    this.syncTickClock();
  }

  protected shouldTick(): boolean {
    return (
      this.tickRate !== null &&
      this.started &&
      !this.ended &&
      !this.disposed &&
      this.authorityMemberId === this.selfMemberId &&
      this.restoreDone &&
      this.canonical !== null
    );
  }

  /** Start the tick clock when this engine should tick, stop it when not. */
  protected syncTickClock(): void {
    if (!this.shouldTick()) {
      this.clearTickTimer();
      this.pendingTicks = 0;
      return;
    }
    if (this.tickTimer !== null) return;
    this.tickAnchorAt = this.now();
    this.ticksCounted = 0;
    this.scheduleTick();
  }

  /**
   * Wake at the next tick boundary. The clock follows elapsed time, not
   * timer callbacks: ticks a busy or background tab missed run in one burst
   * (up to a second's worth), and a longer gap or a backwards clock jump is
   * skipped, so the game runs at the same speed on every host.
   */
  private scheduleTick(): void {
    const tickMs = 1000 / (this.tickRate ?? 1);
    const next = this.tickAnchorAt + (this.ticksCounted + 1) * tickMs;
    this.tickTimer = setTimeout(
      () => {
        this.tickTimer = null;
        if (!this.shouldTick()) {
          this.pendingTicks = 0;
          return;
        }
        const now = this.now();
        const due = Math.floor((now - this.tickAnchorAt) / tickMs) - this.ticksCounted;
        const maxBurst = this.tickRate ?? 1;
        if (now < this.tickAnchorAt || due > maxBurst) {
          this.tickAnchorAt = now;
          this.ticksCounted = 0;
        } else {
          this.ticksCounted += Math.max(0, due);
        }
        // A host slower than its tick rate slows the game instead of piling up work.
        this.pendingTicks = Math.min(maxBurst, this.pendingTicks + Math.max(0, due));
        this.scheduleTick(); // before processQueue, which would otherwise start a second clock
        this.processQueue();
      },
      Math.max(0, next - this.now()),
    );
  }

  protected clearTickTimer(): void {
    if (this.tickTimer !== null) {
      clearTimeout(this.tickTimer);
      this.tickTimer = null;
    }
  }

  /** Run `steps` ticks and commit the result once (unchanged state commits nothing). */
  protected async applyTick(steps: number): Promise<void> {
    if (!this.shouldTick()) return;
    const termAtStart = this.term;
    const tick = this.executor.tick?.bind(this.executor);
    if (tick === undefined) return;
    const result = await this.withExecutorTimeout(
      tick({
        state: this.canonical,
        context: {
          ...this.contextFor(this.revision),
          dt: 1 / (this.tickRate ?? 1),
          controls: this.host.controls(),
        },
        steps,
        viewers: this.viewers(),
      }),
    );
    // The tick may have stopped (leave, end, lost authority) while the frame worked.
    if (!this.shouldTick() || this.term !== termAtStart) return;
    const problem = !result.ok
      ? { code: result.code, message: result.message }
      : this.stateProblem(result.state, "tick");
    const committed =
      result.ok && problem === null ? await this.commit(result, undefined, true) : false;
    const failure = typeof committed === "object" ? committed : problem;
    if (failure !== null) {
      // A broken tick fails every step: report it once, not 20 times a second.
      if (this.reportedTickProblem !== failure.code) {
        this.reportedTickProblem = failure.code;
        this.host.emit({ type: "stateError", ...failure });
      }
      return;
    }
    this.reportedTickProblem = null;
  }

  protected abstract commit(
    result: { state: unknown; views: Record<string, unknown>; viewIsState?: true },
    actionId?: string,
    tick?: boolean,
  ): Promise<boolean | { code: string; message: string }>;
}
