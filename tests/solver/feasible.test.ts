/** Known-feasible problems must solve and pass independent verification. */

import { describe, expect, it } from "vitest";

import { labConsecutive, tinyFeasible, withLocked } from "@/core/fixtures";
import { solve } from "@/solver";
import { assertValid, fac, grp, makeGrid, problem, room, ses } from "./util";

describe("feasible problems", () => {
  it("tiny feasible fixture solves to optimal", async () => {
    const prob = tinyFeasible();
    const sol = await solve(prob, { timeLimitMs: 20_000 });
    expect(sol.status).toBe("optimal");
    assertValid(prob, sol);
  });

  it("lab fixture solves", async () => {
    const prob = labConsecutive();
    const sol = await solve(prob, { timeLimitMs: 20_000 });
    expect(sol.status).toBe("optimal");
    assertValid(prob, sol);
  });

  it("locked fixture solves", async () => {
    const prob = withLocked();
    const sol = await solve(prob, { timeLimitMs: 20_000 });
    expect(sol.status).toBe("optimal");
    assertValid(prob, sol);
  });

  it("a division-wide lecture plus per-batch labs schedules without clashes", async () => {
    const prob = problem({
      slots: makeGrid(2, 4),
      rooms: [
        room("hall", { capacity: 80 }),
        room("lab1", { capacity: 30, roomType: "lab" }),
      ],
      faculty: [fac("f1"), fac("f2")],
      groups: [
        grp("div-a", 60),
        grp("batch-a1", 30, "div-a"),
        grp("batch-a2", 30, "div-a"),
      ],
      sessions: [
        ses("lecture", ["div-a"], ["f1"], ["hall"]),
        ses("lab-a1", ["batch-a1"], ["f2"], ["lab1"], { activity: "lab" }),
        ses("lab-a2", ["batch-a2"], ["f2"], ["lab1"], { activity: "lab" }),
      ],
    });
    const sol = await solve(prob, { timeLimitMs: 20_000 });
    expect(sol.status).toBe("optimal");
    assertValid(prob, sol);
  });

  it("an empty problem is optimal with no placements", async () => {
    const prob = problem({ slots: makeGrid() });
    const sol = await solve(prob);
    expect(sol.status).toBe("optimal");
    expect(sol.placements).toEqual([]);
  });
});
