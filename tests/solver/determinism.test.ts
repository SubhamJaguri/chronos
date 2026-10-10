/**
 * Same input must always yield the same output (single search worker, fixed
 * internal seed, fully sorted model construction).
 */

import { describe, expect, it } from "vitest";

import type { Problem } from "@/core/domain";
import { infeasibleOverbooked, tinyFeasible } from "@/core/fixtures";
import { solve } from "@/solver";
import { assertValid, fac, grp, makeGrid, problem, room, ses } from "./util";

/**
 * Highly symmetric: many interchangeable rooms/faculty/slots, so any
 * nondeterminism in the search would almost certainly surface.
 */
function symmetricProblem(): Problem {
  return problem({
    slots: makeGrid(3, 5),
    rooms: [0, 1, 2, 3].map((i) => room(`r${i}`)),
    faculty: [0, 1, 2, 3].map((i) => fac(`f${i}`)),
    groups: [grp("g1"), grp("g2")],
    sessions: Array.from({ length: 8 }, (_, i) =>
      ses(
        `s${i}`,
        [i % 2 === 1 ? "g1" : "g2"],
        ["f0", "f1", "f2", "f3"],
        ["r0", "r1", "r2", "r3"],
        { subject: `sub-${i % 3}` },
      ),
    ),
  });
}

describe("determinism", () => {
  it("the same input twice gives identical output", async () => {
    const a = await solve(tinyFeasible(), { timeLimitMs: 20_000, seed: 0 });
    const b = await solve(tinyFeasible(), { timeLimitMs: 20_000, seed: 0 });
    expect(a.status).toBe(b.status);
    expect(a.placements).toEqual(b.placements);
    expect(a.diagnostics).toEqual(b.diagnostics);
  });

  it("a highly symmetric problem is reproducible", async () => {
    const a = await solve(symmetricProblem(), { timeLimitMs: 30_000, seed: 7 });
    const b = await solve(symmetricProblem(), { timeLimitMs: 30_000, seed: 7 });
    expect(a.status).toBe("optimal");
    expect(b.status).toBe("optimal");
    assertValid(symmetricProblem(), a);
    expect(a.placements).toEqual(b.placements);
  });

  it("infeasibility diagnostics are reproducible", async () => {
    const a = await solve(infeasibleOverbooked(), { seed: 3 });
    const b = await solve(infeasibleOverbooked(), { seed: 3 });
    expect(a.status).toBe("infeasible");
    expect(b.status).toBe("infeasible");
    expect(a.diagnostics).toEqual(b.diagnostics);
  });
});
