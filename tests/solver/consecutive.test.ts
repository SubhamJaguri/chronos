/** Multi-period and consecutive-lab placement rules. */

import { describe, expect, it } from "vitest";

import type { Problem, Session, TimeSlot } from "@/core/domain";
import { solve } from "@/solver";
import { assertValid, fac, grp, makeGrid, problem, room, ses } from "./util";

function lab(sid = "lab1", duration = 2, consecutive = true): Session {
  return ses(sid, ["g1"], ["f1"], ["labroom"], {
    activity: "lab",
    durationPeriods: duration,
    requiresConsecutive: consecutive,
  });
}

function labProblem(slots: TimeSlot[], sessions: Session[]): Problem {
  return problem({
    slots,
    rooms: [room("labroom", { capacity: 40, roomType: "lab" })],
    faculty: [fac("f1")],
    groups: [grp("g1")],
    sessions,
  });
}

describe("consecutive multi-period sessions", () => {
  it("a consecutive lab avoids the break window", async () => {
    // Periods 0,1 | break at 2 | 3,4,5: a 3-period lab fits only after the break.
    const prob = labProblem(makeGrid(1, 6, [2]), [lab("lab1", 3)]);
    const sol = await solve(prob);
    expect(sol.status).toBe("optimal");
    assertValid(prob, sol);
    expect(sol.placements[0].slotIds).toEqual(["d0p3", "d0p4", "d0p5"]);
  });

  it("a consecutive lab never wraps across days", async () => {
    // One period at the end of day 0 plus one at the start of day 1 is not a run.
    const slots = makeGrid(2, 2).filter((s) => s.id !== "d0p0" && s.id !== "d1p1");
    const prob = labProblem(slots, [lab("lab1", 2)]);
    const sol = await solve(prob);
    expect(sol.status).toBe("infeasible");
    expect(
      sol.diagnostics.some((d) => d.includes("consecutive") && d.includes("PROVEN")),
    ).toBe(true);
  });

  it("a consecutive lab longer than any window is diagnosed", async () => {
    const prob = labProblem(makeGrid(2, 6, [3]), [lab("lab1", 4)]);
    const sol = await solve(prob);
    expect(sol.status).toBe("infeasible");
    expect(
      sol.diagnostics.some(
        (d) => d.includes("PROVEN") && d.includes("contiguous run of 4 teaching periods"),
      ),
    ).toBe(true);
  });

  it("a non-consecutive multi-period session may straddle a break", async () => {
    // Teaching periods 1 and 3 around breaks: fine without requiresConsecutive...
    const slots = makeGrid(1, 4, [0, 2]);
    const prob = labProblem(slots, [lab("lab1", 2, false)]);
    const sol = await solve(prob);
    expect(sol.status).toBe("optimal");
    assertValid(prob, sol);
    expect(sol.placements[0].slotIds).toEqual(["d0p1", "d0p3"]);
  });

  it("a consecutive multi-period session may not straddle a break", async () => {
    // ...but with requiresConsecutive the same layout is proven infeasible.
    const slots = makeGrid(1, 4, [0, 2]);
    const prob = labProblem(slots, [lab("lab1", 2, true)]);
    const sol = await solve(prob);
    expect(sol.status).toBe("infeasible");
    expect(
      sol.diagnostics.some((d) => d.includes("PROVEN") && d.includes("consecutive")),
    ).toBe(true);
  });

  it("a fixed-start consecutive lab takes the exact run", async () => {
    const prob = labProblem(makeGrid(1, 6, [2]), [
      ses("lab", ["g1"], ["f1"], ["labroom"], {
        activity: "lab",
        durationPeriods: 2,
        requiresConsecutive: true,
        fixedSlotId: "d0p3",
      }),
    ]);
    const sol = await solve(prob);
    expect(sol.status).toBe("optimal");
    assertValid(prob, sol);
    expect(sol.placements[0].slotIds).toEqual(["d0p3", "d0p4"]);
  });

  it("a fixed start that would cross a break is proven infeasible", async () => {
    // Fixed to p1 with a break at p2: the 2-period consecutive run cannot exist.
    const prob = labProblem(makeGrid(1, 6, [2]), [
      ses("lab", ["g1"], ["f1"], ["labroom"], {
        activity: "lab",
        durationPeriods: 2,
        requiresConsecutive: true,
        fixedSlotId: "d0p1",
      }),
    ]);
    const sol = await solve(prob);
    expect(sol.status).toBe("infeasible");
    expect(sol.diagnostics.some((d) => d.includes("PROVEN") && d.includes("d0p1"))).toBe(
      true,
    );
  });
});
