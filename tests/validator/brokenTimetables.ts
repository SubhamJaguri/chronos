/**
 * Builders for the validator tests.
 *
 * These construct small timetables - including deliberately broken ones -
 * from scratch, directly against the domain contract. They intentionally do
 * not use any shared fixtures or solver helpers: the validator's reading of
 * requirements.md section 9 must stay independent.
 *
 * Standard grid: 2 days (Monday, Tuesday) x 6 periods (0-5), 60 minutes each
 * starting 09:00, with period 3 a break on every day.
 *
 * Standard resources:
 *   Rooms:   R1 'Main Hall'     classroom cap 70
 *            R2 'Physics Lab'   lab       cap 30
 *            R3 'Seminar Room'  classroom cap 25, unavailable at D0P2
 *            R4 'Chemistry Lab' lab       cap 35
 *   Faculty: F1 'Prof. Rao'  max 4 periods/day
 *            F2 'Dr. Iyer'   no daily cap
 *            F3 'Dr. Mehta'  unavailable at D0P1
 *            F4 'Prof. Shah' no daily cap
 *   Groups:  DIV1 'Division 1' strength 60
 *              B1 'Batch 1' strength 30, parent DIV1
 *              B2 'Batch 2' strength 30, parent DIV1
 *            DIV2 'Division 2' strength 55
 *            ELEC1 'Elective Group 1' strength 20
 */
import type {
  ActivityType,
  Faculty,
  Finding,
  Placement,
  Problem,
  Room,
  Session,
  StudentGroup,
  TimeSlot,
} from "@/core/domain";

export const DAY_START = 9 * 60;
export const PERIOD_MINUTES = 60;
export const BREAK_PERIOD = 3;

export function slotId(day: number, period: number): string {
  return `D${day}P${period}`;
}

export function makeSlots(days = 2, periods = 6): TimeSlot[] {
  const slots: TimeSlot[] = [];
  for (let d = 0; d < days; d++) {
    for (let p = 0; p < periods; p++) {
      const start = DAY_START + p * PERIOD_MINUTES;
      slots.push({
        id: slotId(d, p),
        day: d,
        period: p,
        startMinute: start,
        endMinute: start + PERIOD_MINUTES,
        isBreak: p === BREAK_PERIOD,
      });
    }
  }
  return slots;
}

export function makeRooms(): Room[] {
  return [
    {
      id: "R1",
      name: "Main Hall",
      capacity: 70,
      roomType: "classroom",
      facilities: [],
      unavailableSlots: [],
    },
    {
      id: "R2",
      name: "Physics Lab",
      capacity: 30,
      roomType: "lab",
      facilities: ["lab-bench"],
      unavailableSlots: [],
    },
    {
      id: "R3",
      name: "Seminar Room",
      capacity: 25,
      roomType: "classroom",
      facilities: [],
      unavailableSlots: ["D0P2"],
    },
    {
      id: "R4",
      name: "Chemistry Lab",
      capacity: 35,
      roomType: "lab",
      facilities: [],
      unavailableSlots: [],
    },
  ];
}

export function makeFaculty(): Faculty[] {
  return [
    { id: "F1", name: "Prof. Rao", unavailableSlots: [], maxPeriodsPerDay: 4 },
    { id: "F2", name: "Dr. Iyer", unavailableSlots: [], maxPeriodsPerDay: null },
    {
      id: "F3",
      name: "Dr. Mehta",
      unavailableSlots: ["D0P1"],
      maxPeriodsPerDay: null,
    },
    { id: "F4", name: "Prof. Shah", unavailableSlots: [], maxPeriodsPerDay: null },
  ];
}

export function makeGroups(): StudentGroup[] {
  return [
    { id: "DIV1", name: "Division 1", strength: 60, parentId: null },
    { id: "B1", name: "Batch 1", strength: 30, parentId: "DIV1" },
    { id: "B2", name: "Batch 2", strength: 30, parentId: "DIV1" },
    { id: "DIV2", name: "Division 2", strength: 55, parentId: null },
    { id: "ELEC1", name: "Elective Group 1", strength: 20, parentId: null },
  ];
}

export interface SessionOptions {
  subject?: string;
  subjectName?: string;
  activity?: ActivityType;
  groups?: readonly string[];
  faculty?: readonly string[];
  rooms?: readonly string[];
  duration?: number;
  consecutive?: boolean;
  fixedSlot?: string | null;
  fixedRoom?: string | null;
  fixedFaculty?: string | null;
}

/** Python's str.title() over the subject code with trailing digits removed. */
function defaultSubjectName(subject: string): string {
  const stem = subject.replace(/[0-9]+$/, "");
  return stem.slice(0, 1).toUpperCase() + stem.slice(1).toLowerCase();
}

export function session(sid: string, options: SessionOptions = {}): Session {
  const subject = options.subject ?? "MATH101";
  return {
    id: sid,
    subjectId: subject,
    subjectName: options.subjectName ?? defaultSubjectName(subject),
    activityType: options.activity ?? "lecture",
    groupIds: [...(options.groups ?? ["DIV1"])],
    eligibleFacultyIds: [...(options.faculty ?? ["F1", "F2", "F3", "F4"])],
    eligibleRoomIds: [...(options.rooms ?? ["R1", "R2", "R3", "R4"])],
    durationPeriods: options.duration ?? 1,
    requiresConsecutive: options.consecutive ?? false,
    fixedSlotId: options.fixedSlot ?? null,
    fixedRoomId: options.fixedRoom ?? null,
    fixedFacultyId: options.fixedFaculty ?? null,
  };
}

export interface PlaceOptions {
  room?: string;
  fac?: string;
  locked?: boolean;
}

export function place(
  sid: string,
  slots: string | readonly string[],
  options: PlaceOptions = {},
): Placement {
  const slotIds = typeof slots === "string" ? [slots] : [...slots];
  return {
    sessionId: sid,
    slotIds,
    roomId: options.room ?? "R1",
    facultyId: options.fac ?? "F2",
    locked: options.locked ?? false,
  };
}

export interface ProblemOptions {
  slots?: TimeSlot[];
  rooms?: Room[];
  faculty?: Faculty[];
  groups?: StudentGroup[];
}

export function problem(
  sessions: readonly Session[],
  locked: readonly Placement[] = [],
  options: ProblemOptions = {},
): Problem {
  return {
    slots: options.slots ?? makeSlots(),
    rooms: options.rooms ?? makeRooms(),
    faculty: options.faculty ?? makeFaculty(),
    groups: options.groups ?? makeGroups(),
    sessions: [...sessions],
    lockedPlacements: [...locked],
  };
}

export function rules(findings: readonly Finding[]): Set<string> {
  return new Set(findings.map((f) => f.ruleId));
}

export function byRule(
  findings: readonly Finding[],
  ruleId: string,
): Finding[] {
  return findings.filter((f) => f.ruleId === ruleId);
}
