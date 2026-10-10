/** Infeasible problems must come back with concrete, honest diagnostics. */

import { describe, expect, it } from "vitest";

import type { Problem } from "@/core/domain";
import { infeasibleOverbooked } from "@/core/fixtures";
import { solve } from "@/solver";
import { fac, grp, makeGrid, problem, room, ses } from "./util";

function base(overrides: Partial<Problem>): Problem {
  return problem({
    slots: makeGrid(1, 4),
    rooms: [room("r1"), room("r2")],
    faculty: [fac("f1"), fac("f2")],
    groups: [grp("g1"), grp("g2"), grp("g3")],
    sessions: [],
    ...overrides,
  });
}

describe("infeasibility diagnostics", () => {
  it("the overbooked fixture is proven infeasible naming the group", async () => {
    const sol = await solve(infeasibleOverbooked());
    expect(sol.status).toBe("infeasible");
    expect(
      sol.diagnostics.some((d) => d.includes("PROVEN") && d.includes("grp-g1")),
    ).toBe(true);
  });

  it("a session with no eligible room is named", async () => {
    const prob = base({ sessions: [ses("s1", ["g1"], ["f1"], [])] });
    const sol = await solve(prob);
    expect(sol.status).toBe("infeasible");
    expect(
      sol.diagnostics.some(
        (d) => d.includes("PROVEN") && d.includes("'s1'") && d.includes("room"),
      ),
    ).toBe(true);
  });

  it("a session with no eligible faculty is named", async () => {
    const prob = base({ sessions: [ses("s1", ["g1"], [], ["r1"])] });
    const sol = await solve(prob);
    expect(sol.status).toBe("infeasible");
    expect(
      sol.diagnostics.some(
        (d) => d.includes("PROVEN") && d.includes("'s1'") && d.includes("faculty"),
      ),
    ).toBe(true);
  });

  it("a capacity shortfall is diagnosed with concrete numbers", async () => {
    const prob = base({
      rooms: [room("r1", { capacity: 40 })],
      groups: [grp("g1", 100)],
      sessions: [ses("s1", ["g1"], ["f1"], ["r1"])],
    });
    const sol = await solve(prob);
    expect(sol.status).toBe("infeasible");
    expect(
      sol.diagnostics.some(
        (d) => d.includes("PROVEN") && d.includes("100") && d.includes("40"),
      ),
    ).toBe(true);
  });

  it("a lab without any lab room is diagnosed", async () => {
    const prob = base({
      rooms: [room("r1", { roomType: "classroom" })],
      sessions: [ses("s1", ["g1"], ["f1"], ["r1"], { activity: "lab" })],
    });
    const sol = await solve(prob);
    expect(sol.status).toBe("infeasible");
    expect(
      sol.diagnostics.some((d) => d.includes("PROVEN") && d.includes("roomType 'lab'")),
    ).toBe(true);
  });

  it("two fixed sessions colliding on a room is proven", async () => {
    const prob = base({
      sessions: [
        ses("s1", ["g1"], ["f1"], ["r1"], { fixedSlotId: "d0p0", fixedRoomId: "r1" }),
        ses("s2", ["g2"], ["f2"], ["r1"], { fixedSlotId: "d0p0", fixedRoomId: "r1" }),
      ],
    });
    const sol = await solve(prob);
    expect(sol.status).toBe("infeasible");
    expect(
      sol.diagnostics.some(
        (d) =>
          d.includes("PROVEN") &&
          d.includes("'s1'") &&
          d.includes("'s2'") &&
          d.includes("room 'r1'"),
      ),
    ).toBe(true);
  });

  it("two fixed sessions colliding on a student group is proven", async () => {
    const prob = base({
      sessions: [
        ses("s1", ["g1"], ["f1"], ["r1"], { fixedSlotId: "d0p1" }),
        ses("s2", ["g1"], ["f2"], ["r2"], { fixedSlotId: "d0p1" }),
      ],
    });
    const sol = await solve(prob);
    expect(sol.status).toBe("infeasible");
    expect(
      sol.diagnostics.some((d) => d.includes("PROVEN") && d.includes("student group")),
    ).toBe(true);
  });

  it("a sole faculty with insufficient availability is diagnosed", async () => {
    const prob = base({
      faculty: [fac("f1", { unavailableSlots: ["d0p0", "d0p1", "d0p2"] })],
      sessions: [
        ses("s1", ["g1"], ["f1"], ["r1", "r2"]),
        ses("s2", ["g2"], ["f1"], ["r1", "r2"]),
      ],
    });
    const sol = await solve(prob);
    expect(sol.status).toBe("infeasible");
    expect(sol.diagnostics.some((d) => d.includes("PROVEN") && d.includes("'f1'"))).toBe(
      true,
    );
  });

  it("assumption analysis narrows interaction infeasibility", async () => {
    // Three sessions, one slot, two shared faculty: no single-resource count
    // fails, so the pre-checks pass and CP-SAT proves infeasibility; the
    // assumption core must then name the interacting sessions with the
    // PROVEN-set / LIKELY-individual distinction.
    const prob = base({
      slots: makeGrid(1, 1),
      rooms: [room("r1"), room("r2"), room("r3")],
      sessions: [
        ses("s1", ["g1"], ["f1", "f2"], ["r1", "r2", "r3"]),
        ses("s2", ["g2"], ["f1", "f2"], ["r1", "r2", "r3"]),
        ses("s3", ["g3"], ["f1", "f2"], ["r1", "r2", "r3"]),
      ],
    });
    const sol = await solve(prob);
    expect(sol.status).toBe("infeasible");
    const joined = sol.diagnostics.join("\n");
    expect(joined).toContain("assumption");
    expect(joined).toContain("PROVEN");
    expect(joined).toContain("LIKELY");
    expect(["'s1'", "'s2'", "'s3'"].some((name) => joined.includes(name))).toBe(true);
  });

  it("every infeasibility diagnostic declares its certainty level", async () => {
    const sol = await solve(infeasibleOverbooked());
    expect(sol.status).toBe("infeasible");
    expect(
      sol.diagnostics.every(
        (d) =>
          d.includes("PROVEN") ||
          d.includes("LIKELY") ||
          d.startsWith("WARNING") ||
          d.startsWith("NOTE"),
      ),
    ).toBe(true);
  });
});
