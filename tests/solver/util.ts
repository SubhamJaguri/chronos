/**
 * Test helpers for the solver suite: grid builders and an independent
 * checker.
 *
 * The checker re-verifies solver output directly against the Problem using
 * plain TypeScript (no CP-SAT, none of the solver's own model code), so a
 * modelling bug in the solver cannot hide itself.
 *
 * Ported from the validated Python prototype (python-prototype branch,
 * tests/solver/util.py).
 */

import type {
  ActivityType,
  Faculty,
  Placement,
  Problem,
  Room,
  Session,
  Solution,
  StudentGroup,
  TimeSlot,
} from "@/core/domain";

// ---------------------------------------------------------------------------
// Problem builders
// ---------------------------------------------------------------------------

/**
 * A days x periods grid; period ordinals in `breaks` become break slots.
 * Slot ids follow the pattern `d{day}p{period}`.
 */
export function makeGrid(days = 1, periods = 4, breaks: number[] = []): TimeSlot[] {
  const slots: TimeSlot[] = [];
  for (let day = 0; day < days; day++) {
    for (let period = 0; period < periods; period++) {
      const start = 9 * 60 + period * 60;
      slots.push({
        id: `d${day}p${period}`,
        day,
        period,
        startMinute: start,
        endMinute: start + 60,
        isBreak: breaks.includes(period),
      });
    }
  }
  return slots;
}

export function room(rid: string, opts: Partial<Omit<Room, "id">> = {}): Room {
  return {
    id: rid,
    name: rid,
    capacity: opts.capacity ?? 60,
    roomType: opts.roomType ?? "classroom",
    facilities: opts.facilities ?? [],
    unavailableSlots: opts.unavailableSlots ?? [],
  };
}

export function fac(fid: string, opts: Partial<Omit<Faculty, "id">> = {}): Faculty {
  return {
    id: fid,
    name: fid,
    unavailableSlots: opts.unavailableSlots ?? [],
    maxPeriodsPerDay: opts.maxPeriodsPerDay ?? null,
  };
}

export function grp(
  gid: string,
  strength = 30,
  parentId: string | null = null,
): StudentGroup {
  return { id: gid, name: gid, strength, parentId };
}

export interface SesOptions {
  subject?: string;
  activity?: ActivityType;
  durationPeriods?: number;
  requiresConsecutive?: boolean;
  fixedSlotId?: string | null;
  fixedRoomId?: string | null;
  fixedFacultyId?: string | null;
}

export function ses(
  sid: string,
  groups: string[],
  faculty: string[],
  rooms: string[],
  opts: SesOptions = {},
): Session {
  const subject = opts.subject ?? `sub-${sid}`;
  return {
    id: sid,
    subjectId: subject,
    subjectName: subject,
    activityType: opts.activity ?? "lecture",
    groupIds: groups,
    eligibleFacultyIds: faculty,
    eligibleRoomIds: rooms,
    durationPeriods: opts.durationPeriods ?? 1,
    requiresConsecutive: opts.requiresConsecutive ?? false,
    fixedSlotId: opts.fixedSlotId ?? null,
    fixedRoomId: opts.fixedRoomId ?? null,
    fixedFacultyId: opts.fixedFacultyId ?? null,
  };
}

export function problem(parts: Partial<Problem>): Problem {
  return {
    slots: parts.slots ?? makeGrid(),
    rooms: parts.rooms ?? [],
    faculty: parts.faculty ?? [],
    groups: parts.groups ?? [],
    sessions: parts.sessions ?? [],
    lockedPlacements: parts.lockedPlacements ?? [],
  };
}

export function placement(
  sessionId: string,
  slotIds: string[],
  roomId: string,
  facultyId: string,
  locked: boolean,
): Placement {
  return { sessionId, slotIds, roomId, facultyId, locked };
}

// ---------------------------------------------------------------------------
// Independent hard-constraint checker
// ---------------------------------------------------------------------------

function check(cond: boolean, message: string): asserts cond {
  if (!cond) throw new Error(`independent checker: ${message}`);
}

function ancestorsOf(gid: string, groups: Map<string, StudentGroup>): Set<string> {
  const chain = new Set<string>([gid]);
  let cur = groups.get(gid);
  while (cur !== undefined && cur.parentId !== null && !chain.has(cur.parentId)) {
    chain.add(cur.parentId);
    cur = groups.get(cur.parentId);
  }
  return chain;
}

/** True when some group in `a` is an ancestor-or-self/descendant of one in `b`. */
function groupsConflict(
  a: string[],
  b: string[],
  groups: Map<string, StudentGroup>,
): boolean {
  for (const ga of a) {
    const ancA = ancestorsOf(ga, groups);
    for (const gb of b) {
      if (ancA.has(gb) || ancestorsOf(gb, groups).has(ga)) return true;
    }
  }
  return false;
}

function combinedStrength(session: Session, groups: Map<string, StudentGroup>): number {
  const listed = new Set(session.groupIds);
  let total = 0;
  for (const gid of listed) {
    const g = groups.get(gid);
    if (g === undefined) continue;
    const strictAncestors = ancestorsOf(gid, groups);
    strictAncestors.delete(gid);
    let covered = false;
    for (const a of strictAncestors) {
      if (listed.has(a)) {
        covered = true; // covered by a listed ancestor
        break;
      }
    }
    if (!covered) total += g.strength;
  }
  return total;
}

function samePlacement(a: Placement, b: Placement): boolean {
  return (
    a.sessionId === b.sessionId &&
    a.roomId === b.roomId &&
    a.facultyId === b.facultyId &&
    a.locked === b.locked &&
    a.slotIds.length === b.slotIds.length &&
    a.slotIds.every((s, i) => s === b.slotIds[i])
  );
}

/** Independently verify every hard constraint on a solved timetable. */
export function assertValid(prob: Problem, solution: Solution): void {
  check(
    solution.status === "optimal" || solution.status === "feasible",
    `expected a solved timetable, got ${solution.status}: ${solution.diagnostics.join(" | ")}`,
  );
  const slots = new Map(prob.slots.map((s) => [s.id, s]));
  const rooms = new Map(prob.rooms.map((r) => [r.id, r]));
  const faculty = new Map(prob.faculty.map((f) => [f.id, f]));
  const groups = new Map(prob.groups.map((g) => [g.id, g]));
  const sessions = new Map(prob.sessions.map((s) => [s.id, s]));

  const placedIds = solution.placements.map((p) => p.sessionId);
  const placedSet = new Set(placedIds);
  check(
    placedSet.size === sessions.size &&
      [...sessions.keys()].every((s) => placedSet.has(s)),
    `placed sessions {${[...placedSet].sort().join(",")}} != problem sessions ` +
      `{${[...sessions.keys()].sort().join(",")}}`,
  );
  check(placedIds.length === placedSet.size, "a session was placed twice");

  const locked = new Map(
    prob.lockedPlacements.filter((p) => p.locked).map((p) => [p.sessionId, p]),
  );

  const roomUse = new Map<string, string[]>();
  const facUse = new Map<string, string[]>();
  const facDayPeriods = new Map<string, number>();
  const bySid = new Map<string, Placement>();

  for (const p of solution.placements) {
    const sess = sessions.get(p.sessionId)!;
    bySid.set(p.sessionId, p);

    // locked placements preserved exactly
    const lock = locked.get(p.sessionId);
    if (lock !== undefined) {
      check(samePlacement(p, lock), `locked placement for ${p.sessionId} was altered`);
    }

    // slots exist, are not breaks, single day, correct duration
    const pslots = p.slotIds.map((s) => {
      const slot = slots.get(s);
      check(slot !== undefined, `${p.sessionId} uses unknown slot ${s}`);
      return slot;
    });
    check(
      p.slotIds.length === sess.durationPeriods,
      `${p.sessionId} occupies ${p.slotIds.length} slots, needs ${sess.durationPeriods}`,
    );
    check(new Set(p.slotIds).size === p.slotIds.length, `${p.sessionId} repeats a slot`);
    check(
      pslots.every((s) => !s.isBreak),
      `${p.sessionId} placed on a break`,
    );
    check(new Set(pslots.map((s) => s.day)).size === 1, `${p.sessionId} spans days`);
    if (sess.requiresConsecutive && pslots.length > 1) {
      const periods = pslots.map((s) => s.period).sort((a, b) => a - b);
      check(
        periods.every((pd, i) => pd === periods[0] + i),
        `${p.sessionId} not consecutive: ${periods.join(",")}`,
      );
    }

    // fixed fields honoured
    if (sess.fixedSlotId !== null) {
      check(
        p.slotIds.includes(sess.fixedSlotId),
        `${p.sessionId} misses its fixed slot ${sess.fixedSlotId}`,
      );
    }
    if (sess.fixedRoomId !== null) {
      check(p.roomId === sess.fixedRoomId, `${p.sessionId} not in its fixed room`);
    }
    if (sess.fixedFacultyId !== null) {
      check(
        p.facultyId === sess.fixedFacultyId,
        `${p.sessionId} not with its fixed faculty`,
      );
    }

    // room suitability
    const r = rooms.get(p.roomId);
    check(r !== undefined, `${p.sessionId} uses unknown room ${p.roomId}`);
    check(
      r.capacity >= combinedStrength(sess, groups),
      `${p.sessionId} over capacity in ${p.roomId}`,
    );
    if (sess.activityType === "lab") {
      check(r.roomType === "lab", `lab ${p.sessionId} in ${r.roomType}`);
    }
    const roomUnavail = new Set(r.unavailableSlots);
    check(!p.slotIds.some((s) => roomUnavail.has(s)), `${p.sessionId} room unavailable`);

    // faculty suitability
    const f = faculty.get(p.facultyId);
    check(f !== undefined, `${p.sessionId} uses unknown faculty ${p.facultyId}`);
    const facUnavail = new Set(f.unavailableSlots);
    check(
      !p.slotIds.some((s) => facUnavail.has(s)),
      `${p.sessionId} faculty unavailable`,
    );

    for (const sl of p.slotIds) {
      const ru = roomUse.get(sl) ?? [];
      ru.push(p.roomId);
      roomUse.set(sl, ru);
      const fu = facUse.get(sl) ?? [];
      fu.push(p.facultyId);
      facUse.set(sl, fu);
    }
    const fdKey = `${p.facultyId}@${pslots[0].day}`;
    facDayPeriods.set(fdKey, (facDayPeriods.get(fdKey) ?? 0) + p.slotIds.length);
  }

  // no double-booking
  for (const [sl, usedRooms] of roomUse) {
    check(usedRooms.length === new Set(usedRooms).size, `room double-booked at ${sl}`);
  }
  for (const [sl, usedFac] of facUse) {
    check(usedFac.length === new Set(usedFac).size, `faculty double-booked at ${sl}`);
  }

  // faculty per-day caps
  for (const [fdKey, count] of facDayPeriods) {
    const fid = fdKey.split("@")[0];
    const cap = faculty.get(fid)?.maxPeriodsPerDay ?? null;
    if (cap !== null) {
      check(count <= cap, `faculty ${fid} exceeds daily cap (${count} > ${cap})`);
    }
  }

  // group overlaps including the parent/child hierarchy
  const sids = [...bySid.keys()].sort();
  for (let i = 0; i < sids.length; i++) {
    for (let j = i + 1; j < sids.length; j++) {
      const sa = sids[i];
      const sb = sids[j];
      const slotsA = new Set(bySid.get(sa)!.slotIds);
      const shared = bySid.get(sb)!.slotIds.filter((s) => slotsA.has(s));
      if (shared.length === 0) continue;
      check(
        !groupsConflict(sessions.get(sa)!.groupIds, sessions.get(sb)!.groupIds, groups),
        `group clash between ${sa} and ${sb} at ${shared.join(",")}`,
      );
    }
  }
}
