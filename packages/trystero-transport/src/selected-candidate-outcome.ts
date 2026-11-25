/**
 * Classify only selected native ICE paths; unavailable or ambiguous reports are unknown.
 * A `null` result means "can't tell": callers must map it to the `unknown` connection-log
 * outcome, never to `direct` or `failed`.
 */
export async function selectedCandidateOutcome(
  connection: Pick<RTCPeerConnection, "getStats">,
): Promise<"direct" | "turn" | null> {
  try {
    const report = await connection.getStats();
    const outcomes = new Set<"direct" | "turn">();
    let unresolved = false;
    report.forEach((stat) => {
      if (stat.type !== "transport" || !stat.selectedCandidatePairId) return;
      const pair = report.get(stat.selectedCandidatePairId);
      if (pair?.type !== "candidate-pair") {
        unresolved = true;
        return;
      }
      const local = report.get(pair.localCandidateId);
      const remote = report.get(pair.remoteCandidateId);
      const types = [local?.candidateType, remote?.candidateType];
      if (
        local?.type !== "local-candidate" ||
        remote?.type !== "remote-candidate" ||
        types.some((type) => !["host", "srflx", "prflx", "relay"].includes(type))
      ) {
        unresolved = true;
        return;
      }
      outcomes.add(types.includes("relay") ? "turn" : "direct");
    });
    return !unresolved && outcomes.size === 1 ? ([...outcomes][0] ?? null) : null;
  } catch {
    return null;
  }
}
