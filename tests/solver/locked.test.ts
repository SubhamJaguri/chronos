/** Locked-placement preservation and disruption minimisation. */

import { describe, expect, it } from "vitest";

import { tinyFeasible, withLocked } from "@/core/fixtures";
import { solve } from "@/solver";
import { assertValid, fac, grp, makeGrid, placement, problem, room, ses } from "./util";

describe("locked placements", () => {
  it("a locked placement is preserved exactly", async () => {
    const prob = withLocked();
    const sol = await solve(prob);
    expect(sol.status).toBe("optimal");
    assertValid(prob, sol);
    const locked = sol.placements.find((p) => p.sessionId === "ses-s1")!;
    expect(locked).toEqual(prob.lockedPlacements[0]);
    expect(locked.locked).toBe(true);
  });

  it("other sessions schedule around the lock", async () => {
    // The lock pins room-r1/fac-f1 at slot-d0-p0; nothing else may use them there.
    const prob = withLocked();
    const sol = await solve(prob);
    for (const p of sol.placements) {
      if (p.sessionId === "ses-s1") continue;
      if (p.slotIds.includes("slot-d0-p0")) {
        expect(p.roomId).not.toBe("room-r1");
        expect(p.facultyId).not.toBe("fac-f1");
      }
    }
  });

  it("locked placements leaving no room for the rest are diagnosed", async () => {
    // One group, two periods, three sessions: with one session locked onto a
    // period, the group provably cannot fit the remaining two sessions.
    const prob = problem({
      slots: makeGrid(1, 2),
      rooms: [room("r1"), room("r2")],
      faculty: [fac("f1"), fac("f2")],
      groups: [grp("g1")],
      sessions: [
        ses("s1", ["g1"], ["f1", "f2"], ["r1", "r2"]),
        ses("s2", ["g1"], ["f1", "f2"], ["r1", "r2"]),
        ses("s3", ["g1"], ["f1", "f2"], ["r1", "r2"]),
      ],
      lockedPlacements: [placement("s1", ["d0p0"], "r1", "f1", true)],
    });
    const sol = await solve(prob);
    expect(sol.status).toBe("infeasible");
    expect(sol.diagnostics.some((d) => d.includes("PROVEN") && d.includes("g1"))).toBe(
      true,
    );
  });

  it("an invalid lock is refused with an explanation", async () => {
    // A lock sitting on a break slot is contradictory input, not something to move.
    const prob = problem({
      slots: makeGrid(1, 3, [1]),
      rooms: [room("r1")],
      faculty: [fac("f1")],
      groups: [grp("g1")],
      sessions: [ses("s1", ["g1"], ["f1"], ["r1"])],
      lockedPlacements: [placement("s1", ["d0p1"], "r1", "f1", true)],
    });
    const sol = await solve(prob);
    expect(sol.status).toBe("infeasible");
    expect(sol.diagnostics.some((d) => d.includes("PROVEN") && d.includes("break"))).toBe(
      true,
    );
  });

  it("two contradictory locks for one session are refused", async () => {
    const prob = tinyFeasible();
    prob.lockedPlacements = [
      placement("ses-s1", ["slot-d0-p0"], "room-r1", "fac-f1", true),
      placement("ses-s1", ["slot-d0-p1"], "room-r1", "fac-f1", true),
    ];
    const sol = await solve(prob);
    expect(sol.status).toBe("infeasible");
    expect(
      sol.diagnostics.some((d) => d.includes("contradictory locked placements")),
    ).toBe(true);
  });

  it("previous unlocked placements are kept when still feasible", async () => {
    // A full previous timetable with locked=false is kept (disruption minimised).
    const prob = tinyFeasible();
    const previous = [
      placement("ses-s1", ["slot-d0-p0"], "room-r1", "fac-f1", false),
      placement("ses-s2", ["slot-d0-p1"], "room-r1", "fac-f1", false),
      placement("ses-s3", ["slot-d1-p0"], "room-r1", "fac-f1", false),
      placement("ses-s4", ["slot-d1-p1"], "room-r1", "fac-f1", false),
    ];
    prob.lockedPlacements = [...previous];
    const sol = await solve(prob);
    expect(sol.status).toBe("optimal");
    assertValid(prob, sol);
    const got = new Map(sol.placements.map((p) => [p.sessionId, p]));
    for (const prev of previous) {
      const p = got.get(prev.sessionId)!;
      expect(p.slotIds).toEqual(prev.slotIds);
      expect(p.roomId).toBe(prev.roomId);
      expect(p.facultyId).toBe(prev.facultyId);
    }
  });
});
