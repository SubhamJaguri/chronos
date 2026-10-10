/** One test (or more) per hard constraint from requirements.md section 8. */

import { describe, expect, it } from "vitest";

import type { Problem } from "@/core/domain";
import { solve } from "@/solver";
import { assertValid, fac, grp, makeGrid, problem, room, ses } from "./util";

function base(overrides: Partial<Problem>): Problem {
  return problem({
    slots: makeGrid(1, 4),
    rooms: [room("r1"), room("r2")],
    faculty: [fac("f1"), fac("f2")],
    groups: [grp("g1"), grp("g2")],
    sessions: [],
    ...overrides,
  });
}

function disjoint(a: string[], b: string[]): boolean {
  const sa = new Set(a);
  return b.every((s) => !sa.has(s));
}

describe("faculty overlap", () => {
  it("a faculty member is never double-booked", async () => {
    const prob = base({
      sessions: [
        ses("s1", ["g1"], ["f1"], ["r1", "r2"]),
        ses("s2", ["g2"], ["f1"], ["r1", "r2"]),
      ],
    });
    const sol = await solve(prob);
    assertValid(prob, sol);
    const [a, b] = sol.placements;
    expect(disjoint(a.slotIds, b.slotIds)).toBe(true);
  });
});

describe("student-group overlap, including the parent/child hierarchy", () => {
  it("a group is never double-booked", async () => {
    const prob = base({
      sessions: [ses("s1", ["g1"], ["f1"], ["r1"]), ses("s2", ["g1"], ["f2"], ["r2"])],
    });
    const sol = await solve(prob);
    assertValid(prob, sol);
    const [a, b] = sol.placements;
    expect(disjoint(a.slotIds, b.slotIds)).toBe(true);
  });

  it("a parent division conflicts with its child batch", async () => {
    const prob = base({
      groups: [grp("div", 60), grp("batch1", 30, "div")],
      sessions: [
        ses("for-div", ["div"], ["f1"], ["r1"]),
        ses("for-batch", ["batch1"], ["f2"], ["r2"]),
      ],
    });
    const sol = await solve(prob);
    assertValid(prob, sol);
    const [a, b] = sol.placements;
    expect(disjoint(a.slotIds, b.slotIds)).toBe(true);
  });

  it("parentId chains are resolved transitively, not just one level", async () => {
    const prob = base({
      groups: [grp("div", 60), grp("half", 30, "div"), grp("batch", 15, "half")],
      sessions: [
        ses("for-div", ["div"], ["f1"], ["r1"]),
        ses("for-batch", ["batch"], ["f2"], ["r2"]),
      ],
    });
    const sol = await solve(prob);
    assertValid(prob, sol);
    const [a, b] = sol.placements;
    expect(disjoint(a.slotIds, b.slotIds)).toBe(true);
  });

  it("sibling batches may share a slot", async () => {
    // Siblings do not conflict: both fit into the single teaching slot.
    const prob = base({
      slots: makeGrid(1, 1),
      groups: [grp("div", 60), grp("b1", 30, "div"), grp("b2", 30, "div")],
      sessions: [ses("s1", ["b1"], ["f1"], ["r1"]), ses("s2", ["b2"], ["f2"], ["r2"])],
    });
    const sol = await solve(prob);
    expect(sol.status).toBe("optimal");
    assertValid(prob, sol);
  });
});

describe("room constraints", () => {
  it("a room is never double-booked", async () => {
    const prob = base({
      rooms: [room("r1")],
      sessions: [ses("s1", ["g1"], ["f1"], ["r1"]), ses("s2", ["g2"], ["f2"], ["r1"])],
    });
    const sol = await solve(prob);
    assertValid(prob, sol);
    const [a, b] = sol.placements;
    expect(disjoint(a.slotIds, b.slotIds)).toBe(true);
  });

  it("room capacity must cover the combined strength of a shared lecture", async () => {
    const prob = base({
      rooms: [room("small", { capacity: 40 }), room("hall", { capacity: 100 })],
      groups: [grp("g1", 35), grp("g2", 35)],
      sessions: [ses("shared", ["g1", "g2"], ["f1"], ["small", "hall"])],
    });
    const sol = await solve(prob);
    assertValid(prob, sol);
    expect(sol.placements[0].roomId).toBe("hall");
  });

  it("nested groups' strength is not double-counted", async () => {
    // A session listing a division and its own batch needs only the division size.
    const prob = base({
      rooms: [room("hall", { capacity: 60 })],
      groups: [grp("div", 60), grp("b1", 30, "div")],
      sessions: [ses("s1", ["div", "b1"], ["f1"], ["hall"])],
    });
    const sol = await solve(prob);
    expect(sol.status).toBe("optimal"); // 60 + 30 would overflow the hall; 60 fits
    assertValid(prob, sol);
  });

  it("a lab requires roomType 'lab'", async () => {
    const prob = base({
      rooms: [room("r1", { roomType: "classroom" }), room("lab1", { roomType: "lab" })],
      sessions: [ses("s1", ["g1"], ["f1"], ["r1", "lab1"], { activity: "lab" })],
    });
    const sol = await solve(prob);
    assertValid(prob, sol);
    expect(sol.placements[0].roomId).toBe("lab1");
  });
});

describe("availability", () => {
  it("faculty unavailableSlots are respected", async () => {
    const prob = base({
      faculty: [fac("f1", { unavailableSlots: ["d0p0", "d0p1", "d0p2"] })],
      sessions: [ses("s1", ["g1"], ["f1"], ["r1"])],
    });
    const sol = await solve(prob);
    assertValid(prob, sol);
    expect(sol.placements[0].slotIds).toEqual(["d0p3"]);
  });

  it("room unavailableSlots are respected", async () => {
    const prob = base({
      rooms: [room("r1", { unavailableSlots: ["d0p0", "d0p1", "d0p3"] })],
      sessions: [ses("s1", ["g1"], ["f1"], ["r1"])],
    });
    const sol = await solve(prob);
    assertValid(prob, sol);
    expect(sol.placements[0].slotIds).toEqual(["d0p2"]);
  });
});

describe("breaks", () => {
  it("break slots are never used, even under pressure", async () => {
    // Demand exactly fills the non-break periods; the break must stay empty.
    const prob = base({
      slots: makeGrid(1, 4, [2]),
      sessions: [
        ses("s1", ["g1"], ["f1", "f2"], ["r1", "r2"]),
        ses("s2", ["g1"], ["f1", "f2"], ["r1", "r2"]),
        ses("s3", ["g1"], ["f1", "f2"], ["r1", "r2"]),
      ],
    });
    const sol = await solve(prob);
    expect(sol.status).toBe("optimal");
    assertValid(prob, sol);
    const used = new Set(sol.placements.flatMap((p) => p.slotIds));
    expect([...used].sort()).toEqual(["d0p0", "d0p1", "d0p3"]);
  });

  it("one session too many for the non-break slots is infeasible", async () => {
    const prob = base({
      slots: makeGrid(1, 4, [2]),
      sessions: [0, 1, 2, 3].map((i) => ses(`s${i}`, ["g1"], ["f1", "f2"], ["r1", "r2"])),
    });
    const sol = await solve(prob);
    expect(sol.status).toBe("infeasible");
    expect(sol.diagnostics.some((d) => d.includes("3 teaching periods"))).toBe(true);
  });
});

describe("fixed assignments", () => {
  it("fixedSlotId, fixedRoomId and fixedFacultyId are honoured exactly", async () => {
    const prob = base({
      sessions: [
        ses("pinned", ["g1"], ["f1", "f2"], ["r1", "r2"], {
          fixedSlotId: "d0p2",
          fixedRoomId: "r2",
          fixedFacultyId: "f2",
        }),
        ses("free", ["g1"], ["f1", "f2"], ["r1", "r2"]),
      ],
    });
    const sol = await solve(prob);
    assertValid(prob, sol);
    const pinned = sol.placements.find((p) => p.sessionId === "pinned")!;
    expect(pinned.slotIds).toEqual(["d0p2"]);
    expect(pinned.roomId).toBe("r2");
    expect(pinned.facultyId).toBe("f2");
  });
});

describe("faculty daily cap", () => {
  it("maxPeriodsPerDay is enforced", async () => {
    const prob = base({
      slots: makeGrid(2, 3),
      faculty: [fac("f1", { maxPeriodsPerDay: 2 })],
      groups: [1, 2, 3, 4].map((i) => grp(`g${i}`)),
      sessions: [1, 2, 3, 4].map((i) => ses(`s${i}`, [`g${i}`], ["f1"], ["r1", "r2"])),
    });
    const sol = await solve(prob);
    assertValid(prob, sol); // util re-checks the per-day cap independently
    const perDay = new Map<string, number>();
    for (const p of sol.placements) {
      const day = p.slotIds[0][1]; // grid ids are d{day}p{period}
      perDay.set(day, (perDay.get(day) ?? 0) + p.slotIds.length);
    }
    expect([...perDay.values()].every((v) => v <= 2)).toBe(true);
  });

  it("maxPeriodsPerDay can prove infeasibility", async () => {
    const prob = base({
      slots: makeGrid(1, 4),
      faculty: [fac("f1", { maxPeriodsPerDay: 2 })],
      groups: [1, 2, 3].map((i) => grp(`g${i}`)),
      sessions: [1, 2, 3].map((i) => ses(`s${i}`, [`g${i}`], ["f1"], ["r1", "r2"])),
    });
    const sol = await solve(prob);
    expect(sol.status).toBe("infeasible");
    expect(
      sol.diagnostics.some((d) => d.includes("per-day limit") || d.includes("at most")),
    ).toBe(true);
  });
});
