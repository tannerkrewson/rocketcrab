import { describe, expect, it } from "vitest";
import { selectedCandidateOutcome } from "./selected-candidate-outcome";

type Stat = { id: string; type: string; [key: string]: unknown };
const classify = (stats: Stat[]) =>
  selectedCandidateOutcome({
    getStats: async () =>
      new Map(stats.map((stat) => [stat.id, stat])) as unknown as RTCStatsReport,
  });
const path = (local: string, remote: string): Stat[] => [
  { id: "t", type: "transport", selectedCandidatePairId: "p" },
  {
    id: "p",
    type: "candidate-pair",
    localCandidateId: "l",
    remoteCandidateId: "r",
  },
  { id: "l", type: "local-candidate", candidateType: local },
  { id: "r", type: "remote-candidate", candidateType: remote },
];

describe("selectedCandidateOutcome", () => {
  it("classifies the selected pair, not another successful pair", async () => {
    expect(
      await classify([
        ...path("host", "srflx"),
        {
          id: "other",
          type: "candidate-pair",
          state: "succeeded",
          nominated: true,
        },
      ]),
    ).toBe("direct");
    expect(await classify(path("relay", "host"))).toBe("turn");
    expect(await classify(path("prflx", "relay"))).toBe("turn");
  });

  it("does not invent an outcome when stats are absent, incomplete, or unsupported", async () => {
    expect(await classify([])).toBeNull();
    expect(await classify(path("host", "unknown"))).toBeNull();
    expect(await classify(path("relay", "host").filter((stat) => stat.id !== "r"))).toBeNull();
    expect(
      await classify([{ id: "t", type: "transport", selectedCandidatePairId: "missing" }]),
    ).toBeNull();
    expect(
      await selectedCandidateOutcome({
        getStats: async () => {
          throw new Error();
        },
      }),
    ).toBeNull();
  });

  it("does not choose arbitrarily when selected transports disagree", async () => {
    expect(
      await classify([
        ...path("host", "host"),
        ...path("relay", "host").map((stat) => ({
          ...stat,
          id: `${stat.id}2`,
          ...(stat.selectedCandidatePairId ? { selectedCandidatePairId: "p2" } : {}),
          ...(stat.localCandidateId ? { localCandidateId: "l2" } : {}),
          ...(stat.remoteCandidateId ? { remoteCandidateId: "r2" } : {}),
        })),
      ]),
    ).toBeNull();
  });
});
