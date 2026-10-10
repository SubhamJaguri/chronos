/**
 * Known test problems for the solver and validator.
 *
 * These are the shared, canonical cases every engine is exercised against:
 * a tiny known-feasible timetable, a provably overbooked one, a consecutive
 * lab case, and a locked-placement case. Ported from the Python prototype;
 * the ID conventions (`slot-d0-p0`, `room-r1`, `fac-f1`, `grp-g1`, `ses-s1`)
 * are load-bearing - solver and validator tests assert on them verbatim.
 *
 * Every builder returns freshly constructed objects, so callers may mutate
 * the returned problem (for example, replacing `lockedPlacements`) without
 * affecting later calls.
 */

import type {
  ActivityType,
  Faculty,
  Placement,
  Problem,
  Room,
  Session,
  StudentGroup,
  TimeSlot,
} from "./domain";

const DAY_START_MINUTE = 9 * 60; // 09:00
const PERIOD_MINUTES = 60;

/** A days x periods grid of 60-minute slots with ids `slot-d{day}-p{period}`. */
function makeSlots(days: number, periods: number, breaks: number[] = []): TimeSlot[] {
  const slots: TimeSlot[] = [];
  for (let day = 0; day < days; day++) {
    for (let period = 0; period < periods; period++) {
      const start = DAY_START_MINUTE + period * PERIOD_MINUTES;
      slots.push({
        id: `slot-d${day}-p${period}`,
        day,
        period,
        startMinute: start,
        endMinute: start + PERIOD_MINUTES,
        isBreak: breaks.includes(period),
      });
    }
  }
  return slots;
}

function makeRoom(
  id: string,
  name: string,
  capacity: number,
  roomType: Room["roomType"] = "classroom",
): Room {
  return { id, name, capacity, roomType, facilities: [], unavailableSlots: [] };
}

function makeFaculty(id: string, name: string): Faculty {
  return { id, name, unavailableSlots: [], maxPeriodsPerDay: null };
}

function makeGroup(id: string, name: string, strength: number): StudentGroup {
  return { id, name, strength, parentId: null };
}

interface SessionOptions {
  activityType?: ActivityType;
  durationPeriods?: number;
  requiresConsecutive?: boolean;
}

function makeSession(
  id: string,
  subjectId: string,
  subjectName: string,
  groupIds: string[],
  eligibleFacultyIds: string[],
  eligibleRoomIds: string[],
  options: SessionOptions = {},
): Session {
  return {
    id,
    subjectId,
    subjectName,
    activityType: options.activityType ?? "lecture",
    groupIds,
    eligibleFacultyIds,
    eligibleRoomIds,
    durationPeriods: options.durationPeriods ?? 1,
    requiresConsecutive: options.requiresConsecutive ?? false,
    fixedSlotId: null,
    fixedRoomId: null,
    fixedFacultyId: null,
  };
}

/**
 * Smallest useful known-feasible problem.
 *
 * Grid: 2 days x 2 periods (4 teaching slots, no breaks).
 * Resources: one classroom `room-r1` (capacity 60), one faculty `fac-f1`,
 * one division `grp-g1` (strength 30).
 * Work: four single-period lectures `ses-s1`..`ses-s4`, all for `grp-g1`
 * with `fac-f1` in `room-r1`.
 *
 * Exactly fills the grid: four sessions, four slots, one group. A correct
 * solver must return status "optimal"; placing every session on
 * `room-r1`/`fac-f1` across the four slots is a complete valid timetable.
 */
export function tinyFeasible(): Problem {
  const subjects = ["Mathematics", "Physics", "Chemistry", "Biology"];
  return {
    slots: makeSlots(2, 2),
    rooms: [makeRoom("room-r1", "Room R1", 60)],
    faculty: [makeFaculty("fac-f1", "Prof. F1")],
    groups: [makeGroup("grp-g1", "Division 1", 30)],
    sessions: subjects.map((name, i) =>
      makeSession(
        `ses-s${i + 1}`,
        `sub-s${i + 1}`,
        name,
        ["grp-g1"],
        ["fac-f1"],
        ["room-r1"],
      ),
    ),
    lockedPlacements: [],
  };
}

/**
 * Provably infeasible by counting: group `grp-g1` needs three sessions but
 * the week has only two teaching slots (1 day x 2 periods). Any correct
 * solver must return status "infeasible" and name `grp-g1` in a PROVEN
 * diagnostic; a validator shown a "solution" to this must find clashes.
 */
export function infeasibleOverbooked(): Problem {
  const subjects = ["Mathematics", "Physics", "Chemistry"];
  return {
    slots: makeSlots(1, 2),
    rooms: [makeRoom("room-r1", "Room R1", 60), makeRoom("room-r2", "Room R2", 60)],
    faculty: [makeFaculty("fac-f1", "Prof. F1"), makeFaculty("fac-f2", "Prof. F2")],
    groups: [makeGroup("grp-g1", "Division 1", 30)],
    sessions: subjects.map((name, i) =>
      makeSession(
        `ses-s${i + 1}`,
        `sub-s${i + 1}`,
        name,
        ["grp-g1"],
        ["fac-f1", "fac-f2"],
        ["room-r1", "room-r2"],
      ),
    ),
    lockedPlacements: [],
  };
}

/**
 * A two-period lab that must land on consecutive periods of one day.
 *
 * Grid: 1 day x 4 periods. `ses-lab1` (lab, duration 2, requiresConsecutive)
 * may only use the lab room `room-lab1`; a single-period lecture `ses-s1`
 * for the same group competes for the group's time but uses `room-r1`.
 * Feasible: e.g. lab on periods 0-1, lecture on period 2.
 */
export function labConsecutive(): Problem {
  return {
    slots: makeSlots(1, 4),
    rooms: [
      makeRoom("room-r1", "Room R1", 60),
      makeRoom("room-lab1", "Lab L1", 30, "lab"),
    ],
    faculty: [makeFaculty("fac-f1", "Prof. F1"), makeFaculty("fac-f2", "Prof. F2")],
    groups: [makeGroup("grp-g1", "Division 1", 30)],
    sessions: [
      makeSession("ses-s1", "sub-s1", "Mathematics", ["grp-g1"], ["fac-f1"], ["room-r1"]),
      makeSession(
        "ses-lab1",
        "sub-lab1",
        "Physics Lab",
        ["grp-g1"],
        ["fac-f2"],
        ["room-lab1"],
        { activityType: "lab", durationPeriods: 2, requiresConsecutive: true },
      ),
    ],
    lockedPlacements: [],
  };
}

/**
 * `tinyFeasible` with `ses-s1` locked onto `slot-d0-p0` in `room-r1` with
 * `fac-f1`. Still feasible; a correct solver must keep the locked placement
 * byte-for-byte (same slot, room, faculty, locked=true) and schedule the
 * remaining three sessions around it.
 */
export function withLocked(): Problem {
  const problem = tinyFeasible();
  const lock: Placement = {
    sessionId: "ses-s1",
    slotIds: ["slot-d0-p0"],
    roomId: "room-r1",
    facultyId: "fac-f1",
    locked: true,
  };
  problem.lockedPlacements = [lock];
  return problem;
}
