/**
 * Lookup context shared by the validator's rule checks.
 *
 * Everything in this package is derived directly from requirements.md
 * (sections 8, 9 and 20). It deliberately does not import from, or mirror,
 * the solver: the validator re-derives every rule on its own so that a
 * disagreement between solver and validator surfaces as a finding instead of
 * being silently shared.
 */
import type {
  Faculty,
  Placement,
  Problem,
  Room,
  Session,
  StudentGroup,
  TimeSlot,
} from "@/core/domain";

export const DAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

/** The roomType a lab activity must be placed in (requirements.md section 9). */
export const LAB_ROOM_TYPE = "lab";

/** Normalised string value of an ActivityType (tolerates enum-like objects). */
export function activityValue(activity: unknown): string {
  const raw =
    typeof activity === "object" && activity !== null && "value" in activity
      ? (activity as { value: unknown }).value
      : activity;
  return String(raw).toLowerCase();
}

export function hhmm(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function dayName(day: number): string {
  return DAY_NAMES[((day % DAY_NAMES.length) + DAY_NAMES.length) % DAY_NAMES.length];
}

/** Upper-case only the first character, preserving names inside. */
export function sentenceCase(text: string): string {
  return text.slice(0, 1).toUpperCase() + text.slice(1);
}

/** Ascending-sorted copy of string ids. */
export function sortedIds(ids: Iterable<string>): string[] {
  return [...ids].sort();
}

/** Indexes a Problem plus the proposed placements for the rule checks. */
export class ValidationContext {
  readonly problem: Problem;
  readonly placements: Placement[];
  readonly slotsById: Map<string, TimeSlot>;
  readonly roomsById: Map<string, Room>;
  readonly facultyById: Map<string, Faculty>;
  readonly groupsById: Map<string, StudentGroup>;
  readonly sessionsById: Map<string, Session>;
  readonly slotByDayPeriod: Map<string, TimeSlot>;
  /** Groups with no child group: the finest unit students belong to. */
  readonly leafGroupIds: readonly string[];
  private readonly lineageCache = new Map<string, ReadonlySet<string>>();

  constructor(problem: Problem, placements: Placement[]) {
    this.problem = problem;
    this.placements = [...placements];
    this.slotsById = new Map(problem.slots.map((s) => [s.id, s]));
    this.roomsById = new Map(problem.rooms.map((r) => [r.id, r]));
    this.facultyById = new Map(problem.faculty.map((f) => [f.id, f]));
    this.groupsById = new Map(problem.groups.map((g) => [g.id, g]));
    this.sessionsById = new Map(problem.sessions.map((s) => [s.id, s]));
    this.slotByDayPeriod = new Map(
      problem.slots.map((s) => [`${s.day}:${s.period}`, s]),
    );
    const parents = new Set(
      problem.groups.map((g) => g.parentId).filter((p): p is string => p !== null),
    );
    this.leafGroupIds = problem.groups
      .filter((g) => !parents.has(g.id))
      .map((g) => g.id);
  }

  slotAt(day: number, period: number): TimeSlot | undefined {
    return this.slotByDayPeriod.get(`${day}:${period}`);
  }

  // -- group hierarchy -------------------------------------------------------

  /**
   * The group itself plus every ancestor, cycle-safe.
   *
   * A batch's students are a subset of its division's students, so a session
   * for a division occupies all of its batches and vice versa.
   */
  lineage(groupId: string): ReadonlySet<string> {
    const cached = this.lineageCache.get(groupId);
    if (cached !== undefined) return cached;
    const chain = new Set<string>();
    let current: string | null = groupId;
    while (current !== null && !chain.has(current)) {
      chain.add(current);
      const group = this.groupsById.get(current);
      current = group !== undefined ? group.parentId : null;
    }
    this.lineageCache.set(groupId, chain);
    return chain;
  }

  /**
   * Pairs [ga, gb] where one group is the other or contains the other.
   *
   * Sibling batches of the same division do NOT conflict with each other;
   * a division conflicts with each of its own batches.
   */
  groupsConflict(
    a: readonly string[],
    b: readonly string[],
  ): Array<[string, string]> {
    const pairs: Array<[string, string]> = [];
    for (const ga of sortedIds(a)) {
      const la = this.lineage(ga);
      for (const gb of sortedIds(b)) {
        if (la.has(gb) || this.lineage(gb).has(ga)) {
          pairs.push([ga, gb]);
        }
      }
    }
    return pairs;
  }

  /**
   * Total students across the groups, never double-counting a batch whose
   * parent division is also in the set.
   */
  combinedStrength(groupIds: readonly string[]): number {
    const idSet = new Set(groupIds);
    let total = 0;
    for (const gid of groupIds) {
      const group = this.groupsById.get(gid);
      if (group === undefined) continue;
      let ancestorInSet = false;
      for (const ancestor of this.lineage(gid)) {
        if (ancestor !== gid && idSet.has(ancestor)) {
          ancestorInSet = true;
          break;
        }
      }
      if (ancestorInSet) continue; // an ancestor in the set already counts these students
      total += group.strength;
    }
    return total;
  }

  /**
   * Whether students of `groupId` sit in a session assigned to any of
   * `sessionGroupIds` (the session may target the group or an ancestor).
   */
  groupAttends(groupId: string, sessionGroupIds: readonly string[]): boolean {
    const lineage = this.lineage(groupId);
    return sessionGroupIds.some((g) => lineage.has(g));
  }

  // -- placement helpers -----------------------------------------------------

  knownSlots(placement: Placement): TimeSlot[] {
    const slots: TimeSlot[] = [];
    for (const sid of placement.slotIds) {
      const slot = this.slotsById.get(sid);
      if (slot !== undefined) slots.push(slot);
    }
    return slots;
  }

  // -- human-readable labels ---------------------------------------------------

  slotLabel(slotId: string): string {
    const slot = this.slotsById.get(slotId);
    if (slot === undefined) return `unknown slot '${slotId}'`;
    return (
      `${dayName(slot.day)} period ${slot.period}` +
      ` (${hhmm(slot.startMinute)}-${hhmm(slot.endMinute)})`
    );
  }

  roomLabel(roomId: string): string {
    const room = this.roomsById.get(roomId);
    if (room === undefined) return `unknown room '${roomId}'`;
    return `room '${room.name}'`;
  }

  facultyLabel(facultyId: string): string {
    const fac = this.facultyById.get(facultyId);
    if (fac === undefined) return `unknown faculty '${facultyId}'`;
    return `faculty '${fac.name}'`;
  }

  groupLabel(groupId: string): string {
    const group = this.groupsById.get(groupId);
    if (group === undefined) return `unknown group '${groupId}'`;
    return `group '${group.name}'`;
  }

  sessionLabel(sessionId: string): string {
    const session = this.sessionsById.get(sessionId);
    if (session === undefined) return `unknown session '${sessionId}'`;
    return (
      `'${session.subjectName}' ${activityValue(session.activityType)}` +
      ` session '${session.id}'`
    );
  }
}
