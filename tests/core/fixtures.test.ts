import { describe, expect, it } from "vitest";

import type { Problem } from "@/core/domain";
import {
  infeasibleOverbooked,
  labConsecutive,
  tinyFeasible,
  withLocked,
} from "@/core/fixtures";

/** Every id referenced anywhere in the problem must resolve to a real entity. */
function assertReferentiallySound(problem: Problem) {
  const slotIds = new Set(problem.slots.map((s) => s.id));
  const roomIds = new Set(problem.rooms.map((r) => r.id));
  const facultyIds = new Set(problem.faculty.map((f) => f.id));
  const groupIds = new Set(problem.groups.map((g) => g.id));
  const sessionIds = new Set(problem.sessions.map((s) => s.id));

  expect(slotIds.size).toBe(problem.slots.length);
  expect(roomIds.size).toBe(problem.rooms.length);
  expect(facultyIds.size).toBe(problem.faculty.length);
  expect(groupIds.size).toBe(problem.groups.length);
  expect(sessionIds.size).toBe(problem.sessions.length);

  for (const group of problem.groups) {
    if (group.parentId !== null) expect(groupIds).toContain(group.parentId);
  }
  for (const room of problem.rooms) {
    for (const slot of room.unavailableSlots) expect(slotIds).toContain(slot);
  }
  for (const f of problem.faculty) {
    for (const slot of f.unavailableSlots) expect(slotIds).toContain(slot);
  }
  for (const session of problem.sessions) {
    for (const g of session.groupIds) expect(groupIds).toContain(g);
    for (const f of session.eligibleFacultyIds) expect(facultyIds).toContain(f);
    for (const r of session.eligibleRoomIds) expect(roomIds).toContain(r);
    if (session.fixedSlotId !== null) expect(slotIds).toContain(session.fixedSlotId);
    if (session.fixedRoomId !== null) expect(roomIds).toContain(session.fixedRoomId);
    if (session.fixedFacultyId !== null) {
      expect(facultyIds).toContain(session.fixedFacultyId);
    }
    expect(session.durationPeriods).toBeGreaterThanOrEqual(1);
  }
  for (const placement of problem.lockedPlacements) {
    expect(sessionIds).toContain(placement.sessionId);
    expect(roomIds).toContain(placement.roomId);
    expect(facultyIds).toContain(placement.facultyId);
    for (const slot of placement.slotIds) expect(slotIds).toContain(slot);
  }
}

describe("tinyFeasible", () => {
  it("is a 2x2 grid exactly filled by four lectures for one group", () => {
    const p = tinyFeasible();
    assertReferentiallySound(p);

    expect(p.slots.map((s) => s.id).sort()).toEqual([
      "slot-d0-p0",
      "slot-d0-p1",
      "slot-d1-p0",
      "slot-d1-p1",
    ]);
    expect(p.slots.every((s) => !s.isBreak)).toBe(true);
    expect(p.rooms.map((r) => r.id)).toEqual(["room-r1"]);
    expect(p.faculty.map((f) => f.id)).toEqual(["fac-f1"]);
    expect(p.groups.map((g) => g.id)).toEqual(["grp-g1"]);
    expect(p.sessions.map((s) => s.id)).toEqual(["ses-s1", "ses-s2", "ses-s3", "ses-s4"]);
    expect(p.lockedPlacements).toEqual([]);

    // Feasibility by counting: one group, four single-period sessions,
    // four teaching slots.
    const teachingSlots = p.slots.filter((s) => !s.isBreak).length;
    const demand = p.sessions.reduce((n, s) => n + s.durationPeriods, 0);
    expect(demand).toBe(teachingSlots);

    // The single room fits the group.
    const group = p.groups[0]!;
    expect(p.rooms[0]!.capacity).toBeGreaterThanOrEqual(group.strength);
  });

  it("returns fresh objects on every call", () => {
    const a = tinyFeasible();
    const b = tinyFeasible();
    expect(a).toEqual(b);
    expect(a.sessions[0]).not.toBe(b.sessions[0]);
    a.lockedPlacements.push({
      sessionId: "ses-s1",
      slotIds: ["slot-d0-p0"],
      roomId: "room-r1",
      facultyId: "fac-f1",
      locked: true,
    });
    expect(tinyFeasible().lockedPlacements).toEqual([]);
  });
});

describe("infeasibleOverbooked", () => {
  it("overbooks grp-g1: more required periods than teaching slots", () => {
    const p = infeasibleOverbooked();
    assertReferentiallySound(p);

    const teachingSlots = p.slots.filter((s) => !s.isBreak).length;
    const groupDemand = p.sessions
      .filter((s) => s.groupIds.includes("grp-g1"))
      .reduce((n, s) => n + s.durationPeriods, 0);
    expect(groupDemand).toBeGreaterThan(teachingSlots);
  });

  it("is overbooked only through the group, not through rooms or faculty", () => {
    // The infeasibility must be attributable to grp-g1 specifically: with
    // two rooms and two faculty, slots x rooms and slots x faculty both
    // exceed the number of sessions.
    const p = infeasibleOverbooked();
    const teachingSlots = p.slots.filter((s) => !s.isBreak).length;
    expect(teachingSlots * p.rooms.length).toBeGreaterThanOrEqual(p.sessions.length);
    expect(teachingSlots * p.faculty.length).toBeGreaterThanOrEqual(p.sessions.length);
  });
});

describe("labConsecutive", () => {
  it("has a two-period consecutive lab restricted to the lab room", () => {
    const p = labConsecutive();
    assertReferentiallySound(p);

    const lab = p.sessions.find((s) => s.id === "ses-lab1");
    expect(lab).toBeDefined();
    expect(lab!.activityType).toBe("lab");
    expect(lab!.durationPeriods).toBe(2);
    expect(lab!.requiresConsecutive).toBe(true);

    const labRooms = lab!.eligibleRoomIds.map((id) => p.rooms.find((r) => r.id === id)!);
    expect(labRooms.length).toBeGreaterThan(0);
    expect(labRooms.every((r) => r.roomType === "lab")).toBe(true);
    expect(labRooms.every((r) => r.capacity >= 30)).toBe(true);
  });

  it("leaves enough room on one day for the lab plus the lecture", () => {
    const p = labConsecutive();
    const byDay = new Map<number, number>();
    for (const s of p.slots.filter((s) => !s.isBreak)) {
      byDay.set(s.day, (byDay.get(s.day) ?? 0) + 1);
    }
    const demand = p.sessions.reduce((n, s) => n + s.durationPeriods, 0);
    const maxDay = Math.max(...byDay.values());
    expect(maxDay).toBeGreaterThanOrEqual(demand);
  });
});

describe("withLocked", () => {
  it("is tinyFeasible plus one locked placement pinning ses-s1", () => {
    const p = withLocked();
    assertReferentiallySound(p);

    const base = tinyFeasible();
    expect(p.slots).toEqual(base.slots);
    expect(p.rooms).toEqual(base.rooms);
    expect(p.faculty).toEqual(base.faculty);
    expect(p.groups).toEqual(base.groups);
    expect(p.sessions).toEqual(base.sessions);

    expect(p.lockedPlacements).toEqual([
      {
        sessionId: "ses-s1",
        slotIds: ["slot-d0-p0"],
        roomId: "room-r1",
        facultyId: "fac-f1",
        locked: true,
      },
    ]);
  });

  it("locks onto a teaching slot, not a break", () => {
    const p = withLocked();
    const lock = p.lockedPlacements[0]!;
    for (const slotId of lock.slotIds) {
      const slot = p.slots.find((s) => s.id === slotId)!;
      expect(slot.isBreak).toBe(false);
    }
  });
});
