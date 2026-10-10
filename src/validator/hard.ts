/**
 * Hard-constraint checks (requirements.md sections 8 and 9).
 *
 * Every finding produced here carries severity "error": a timetable with any
 * of these findings must never be marked publish-ready.
 */
import type { Finding, Placement } from "@/core/domain";
import * as ruleIds from "./ruleIds";
import {
  LAB_ROOM_TYPE,
  ValidationContext,
  activityValue,
  dayName,
  sortedIds,
} from "./context";

function error(
  ruleId: string,
  message: string,
  sessionIds: readonly string[] = [],
  slotIds: readonly string[] = [],
): Finding {
  return {
    ruleId,
    severity: "error",
    message,
    sessionIds: [...sessionIds],
    slotIds: [...slotIds],
  };
}

/** Iterate a map's entries in ascending key order. */
function sortedEntries<V>(map: Map<string, V>): Array<[string, V]> {
  return [...map.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

// -- referential integrity ---------------------------------------------------

/** Placements that reference an unknown session, room, faculty or slot. */
export function checkOrphans(ctx: ValidationContext): Finding[] {
  const findings: Finding[] = [];
  for (const p of ctx.placements) {
    if (!ctx.sessionsById.has(p.sessionId)) {
      findings.push(
        error(
          ruleIds.ORPHAN_SESSION,
          `Placement references unknown session '${p.sessionId}'` +
            ` (room '${p.roomId}', faculty '${p.facultyId}').` +
            " Suggested: remove this placement or add the session to" +
            " the canonical session list.",
          [p.sessionId],
          p.slotIds,
        ),
      );
    }
    if (!ctx.roomsById.has(p.roomId)) {
      findings.push(
        error(
          ruleIds.ORPHAN_ROOM,
          `Placement of ${ctx.sessionLabel(p.sessionId)} references` +
            ` unknown room '${p.roomId}'.` +
            " Suggested: assign a room that exists in the room list.",
          [p.sessionId],
          p.slotIds,
        ),
      );
    }
    if (!ctx.facultyById.has(p.facultyId)) {
      findings.push(
        error(
          ruleIds.ORPHAN_FACULTY,
          `Placement of ${ctx.sessionLabel(p.sessionId)} references` +
            ` unknown faculty '${p.facultyId}'.` +
            " Suggested: assign a faculty member that exists in the" +
            " faculty list.",
          [p.sessionId],
          p.slotIds,
        ),
      );
    }
    const unknownSlots = p.slotIds.filter((s) => !ctx.slotsById.has(s));
    if (unknownSlots.length > 0) {
      findings.push(
        error(
          ruleIds.ORPHAN_SLOT,
          `Placement of ${ctx.sessionLabel(p.sessionId)} references` +
            ` unknown time slot(s) ${unknownSlots
              .map((s) => `'${s}'`)
              .join(", ")}.` +
            " Suggested: reschedule onto slots defined in the timetable grid.",
          [p.sessionId],
          unknownSlots,
        ),
      );
    }
  }
  return findings;
}

// -- session coverage ----------------------------------------------------------

/** Every required session placed exactly once: none missing, none duplicated. */
export function checkSessionCoverage(ctx: ValidationContext): Finding[] {
  const findings: Finding[] = [];
  const counts = new Map<string, number>();
  for (const p of ctx.placements) {
    counts.set(p.sessionId, (counts.get(p.sessionId) ?? 0) + 1);
  }
  for (const session of ctx.problem.sessions) {
    const n = counts.get(session.id) ?? 0;
    if (n === 0) {
      findings.push(
        error(
          ruleIds.SESSION_MISSING,
          `Required ${ctx.sessionLabel(session.id)} has no placement.` +
            " Suggested: schedule it in a free slot with an eligible" +
            " room and faculty member.",
          [session.id],
        ),
      );
    } else if (n > 1) {
      const slotIds = ctx.placements
        .filter((p) => p.sessionId === session.id)
        .flatMap((p) => p.slotIds);
      findings.push(
        error(
          ruleIds.SESSION_DUPLICATE,
          `${ctx.sessionLabel(session.id)} is placed ${n} times but is` +
            " required exactly once." +
            ` Suggested: keep one placement and remove the other ${n - 1}.`,
          [session.id],
          slotIds,
        ),
      );
    }
  }
  return findings;
}

// -- clashes --------------------------------------------------------------------

interface OccupancyEntry {
  resourceId: string;
  slotId: string;
  placements: Placement[];
}

function clashOccupancy(
  ctx: ValidationContext,
  resourceId: (p: Placement) => string,
): Map<string, OccupancyEntry> {
  const occupancy = new Map<string, OccupancyEntry>();
  for (const p of ctx.placements) {
    for (const sid of new Set(p.slotIds)) {
      const key = `${resourceId(p)} ${sid}`;
      let entry = occupancy.get(key);
      if (entry === undefined) {
        entry = { resourceId: resourceId(p), slotId: sid, placements: [] };
        occupancy.set(key, entry);
      }
      entry.placements.push(p);
    }
  }
  return occupancy;
}

/** No faculty member teaches two different sessions in the same slot. */
export function checkFacultyClashes(ctx: ValidationContext): Finding[] {
  const findings: Finding[] = [];
  for (const [, entry] of sortedEntries(clashOccupancy(ctx, (p) => p.facultyId))) {
    const sessionIds = sortedIds(new Set(entry.placements.map((p) => p.sessionId)));
    if (sessionIds.length < 2) continue; // duplicates of one session are reported by coverage check
    const listed = sessionIds.map((s) => ctx.sessionLabel(s)).join(", ");
    findings.push(
      error(
        ruleIds.FACULTY_CLASH,
        `${ctx.facultyLabel(entry.resourceId)} is double-booked at` +
          ` ${ctx.slotLabel(entry.slotId)}: ${listed}.` +
          " Suggested: move all but one of these sessions to another" +
          " slot, or assign a different eligible faculty member.",
        sessionIds,
        [entry.slotId],
      ),
    );
  }
  return findings;
}

/** No room hosts two different sessions in the same slot. */
export function checkRoomClashes(ctx: ValidationContext): Finding[] {
  const findings: Finding[] = [];
  for (const [, entry] of sortedEntries(clashOccupancy(ctx, (p) => p.roomId))) {
    const sessionIds = sortedIds(new Set(entry.placements.map((p) => p.sessionId)));
    if (sessionIds.length < 2) continue;
    const listed = sessionIds.map((s) => ctx.sessionLabel(s)).join(", ");
    findings.push(
      error(
        ruleIds.ROOM_CLASH,
        `${ctx.roomLabel(entry.resourceId)} is double-booked at` +
          ` ${ctx.slotLabel(entry.slotId)}: ${listed}.` +
          " Suggested: move all but one of these sessions to a different" +
          " room or slot.",
        sessionIds,
        [entry.slotId],
      ),
    );
  }
  return findings;
}

/**
 * No student can be required in two sessions at once.
 *
 * Resolves the parent/child hierarchy: a division session clashes with a
 * session of any of that division's own batches (students overlap), while
 * two sibling batches may be scheduled in parallel.
 */
export function checkGroupClashes(ctx: ValidationContext): Finding[] {
  const bySlot = new Map<string, Placement[]>();
  for (const p of ctx.placements) {
    if (!ctx.sessionsById.has(p.sessionId)) continue;
    for (const sid of new Set(p.slotIds)) {
      const list = bySlot.get(sid);
      if (list === undefined) bySlot.set(sid, [p]);
      else list.push(p);
    }
  }
  const findings: Finding[] = [];
  const reported = new Set<string>();
  for (const [slotId, ps] of sortedEntries(bySlot)) {
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const a = ps[i];
        const b = ps[j];
        if (a.sessionId === b.sessionId) continue;
        const key = `${slotId} ${sortedIds([a.sessionId, b.sessionId]).join(" ")}`;
        if (reported.has(key)) continue;
        const sa = ctx.sessionsById.get(a.sessionId);
        const sb = ctx.sessionsById.get(b.sessionId);
        if (sa === undefined || sb === undefined) continue;
        const pairs = ctx.groupsConflict(sa.groupIds, sb.groupIds);
        if (pairs.length === 0) continue;
        reported.add(key);
        const names = sortedIds(
          new Set(pairs.flatMap((pair) => pair.map((g) => ctx.groupLabel(g)))),
        );
        const sessionIds = sortedIds(new Set([a.sessionId, b.sessionId]));
        findings.push(
          error(
            ruleIds.GROUP_CLASH,
            `Student group clash at ${ctx.slotLabel(slotId)}:` +
              ` ${names.join(" and ")} cannot attend both` +
              ` ${ctx.sessionLabel(a.sessionId)} and` +
              ` ${ctx.sessionLabel(b.sessionId)} at the same time.` +
              " Suggested: move one of the two sessions to a different slot.",
            sessionIds,
            [slotId],
          ),
        );
      }
    }
  }
  return findings;
}

// -- availability ----------------------------------------------------------------

/** Faculty and room unavailableSlots are respected. */
export function checkAvailability(ctx: ValidationContext): Finding[] {
  const findings: Finding[] = [];
  for (const p of ctx.placements) {
    const fac = ctx.facultyById.get(p.facultyId);
    if (fac !== undefined) {
      const bad = p.slotIds.filter((s) => fac.unavailableSlots.includes(s));
      if (bad.length > 0) {
        const when = bad.map((s) => ctx.slotLabel(s)).join(", ");
        findings.push(
          error(
            ruleIds.FACULTY_UNAVAILABLE,
            `${ctx.facultyLabel(p.facultyId)} is unavailable at` +
              ` ${when} but is assigned ${ctx.sessionLabel(p.sessionId)}` +
              " there. Suggested: move the session to a slot where" +
              " they are available, or assign another eligible" +
              " faculty member.",
            [p.sessionId],
            bad,
          ),
        );
      }
    }
    const room = ctx.roomsById.get(p.roomId);
    if (room !== undefined) {
      const bad = p.slotIds.filter((s) => room.unavailableSlots.includes(s));
      if (bad.length > 0) {
        const when = bad.map((s) => ctx.slotLabel(s)).join(", ");
        findings.push(
          error(
            ruleIds.ROOM_UNAVAILABLE,
            `${ctx.roomLabel(p.roomId)} is unavailable at ${when}` +
              ` but hosts ${ctx.sessionLabel(p.sessionId)} there.` +
              " Suggested: move the session to another slot or to a" +
              " room that is available then.",
            [p.sessionId],
            bad,
          ),
        );
      }
    }
  }
  return findings;
}

// -- room suitability --------------------------------------------------------------

/** Lab activities must be placed in a room of roomType 'lab'. */
export function checkRoomType(ctx: ValidationContext): Finding[] {
  const findings: Finding[] = [];
  for (const p of ctx.placements) {
    const session = ctx.sessionsById.get(p.sessionId);
    const room = ctx.roomsById.get(p.roomId);
    if (session === undefined || room === undefined) continue;
    if (
      activityValue(session.activityType) === "lab" &&
      room.roomType !== LAB_ROOM_TYPE
    ) {
      findings.push(
        error(
          ruleIds.ROOM_TYPE_UNSUITABLE,
          `${ctx.sessionLabel(p.sessionId)} is a lab activity but is` +
            ` placed in ${ctx.roomLabel(p.roomId)} of type` +
            ` '${room.roomType}'.` +
            " Suggested: move it to a room with roomType 'lab'.",
          [p.sessionId],
          p.slotIds,
        ),
      );
    }
  }
  return findings;
}

/** Room capacity covers the combined strength of the assigned groups. */
export function checkRoomCapacity(ctx: ValidationContext): Finding[] {
  const findings: Finding[] = [];
  for (const p of ctx.placements) {
    const session = ctx.sessionsById.get(p.sessionId);
    const room = ctx.roomsById.get(p.roomId);
    if (session === undefined || room === undefined) continue;
    const strength = ctx.combinedStrength(session.groupIds);
    if (strength > room.capacity) {
      const groups = sortedIds(session.groupIds)
        .map((g) => ctx.groupLabel(g))
        .join(", ");
      findings.push(
        error(
          ruleIds.ROOM_CAPACITY,
          `${ctx.roomLabel(p.roomId)} seats ${room.capacity} but` +
            ` ${ctx.sessionLabel(p.sessionId)} brings ${strength}` +
            ` students (${groups}).` +
            ` Suggested: assign a room with capacity >= ${strength}.`,
          [p.sessionId],
          p.slotIds,
        ),
      );
    }
  }
  return findings;
}

// -- duration and contiguity ---------------------------------------------------------

/** A placement covers exactly durationPeriods distinct slots. */
export function checkDuration(ctx: ValidationContext): Finding[] {
  const findings: Finding[] = [];
  for (const p of ctx.placements) {
    const session = ctx.sessionsById.get(p.sessionId);
    if (session === undefined) continue;
    const distinct = new Set(p.slotIds).size;
    if (
      p.slotIds.length !== session.durationPeriods ||
      distinct !== session.durationPeriods
    ) {
      findings.push(
        error(
          ruleIds.DURATION_MISMATCH,
          `${ctx.sessionLabel(p.sessionId)} requires` +
            ` ${session.durationPeriods} period(s) but its placement` +
            ` covers ${p.slotIds.length} slot(s) (${distinct} distinct).` +
            ` Suggested: assign exactly ${session.durationPeriods}` +
            " distinct slot(s).",
          [p.sessionId],
          p.slotIds,
        ),
      );
    }
  }
  return findings;
}

/**
 * Sessions with requiresConsecutive sit in contiguous periods of one day.
 *
 * Catches gaps between periods, runs that span a break period, and
 * placements that wrap across days (requirements.md section 20).
 */
export function checkConsecutive(ctx: ValidationContext): Finding[] {
  const findings: Finding[] = [];
  for (const p of ctx.placements) {
    const session = ctx.sessionsById.get(p.sessionId);
    if (session === undefined || !session.requiresConsecutive) continue;
    const slots = ctx.knownSlots(p);
    if (slots.length !== new Set(p.slotIds).size) continue; // unknown slots already reported as H-ORPHAN-SLOT
    if (slots.length < 2) continue;
    const days = [...new Set(slots.map((s) => s.day))].sort((x, y) => x - y);
    if (days.length > 1) {
      const listed = days.map((d) => dayName(d)).join(" and ");
      findings.push(
        error(
          ruleIds.NOT_CONSECUTIVE,
          `${ctx.sessionLabel(p.sessionId)} requires consecutive` +
            ` periods but its placement wraps across days (${listed}).` +
            ` Suggested: place all ${session.durationPeriods} periods` +
            " contiguously on a single day.",
          [p.sessionId],
          p.slotIds,
        ),
      );
      continue;
    }
    const day = days[0];
    const periods = slots.map((s) => s.period).sort((x, y) => x - y);
    let contiguous = true;
    for (let i = 1; i < periods.length; i++) {
      if (periods[i] - periods[i - 1] !== 1) {
        contiguous = false;
        break;
      }
    }
    if (contiguous) continue;
    const occupied = new Set(periods);
    let spansBreak = false;
    for (let q = periods[0] + 1; q < periods[periods.length - 1]; q++) {
      if (occupied.has(q)) continue;
      const slot = ctx.slotAt(day, q);
      if (slot !== undefined && slot.isBreak) {
        spansBreak = true;
        break;
      }
    }
    const detail = spansBreak
      ? " The assigned periods span a break, which splits the session."
      : "";
    findings.push(
      error(
        ruleIds.NOT_CONSECUTIVE,
        `${ctx.sessionLabel(p.sessionId)} requires consecutive` +
          ` periods but occupies non-contiguous periods` +
          ` [${periods.join(", ")}] on ${dayName(day)}.${detail}` +
          ` Suggested: place all ${session.durationPeriods} periods in` +
          " an unbroken run on one day.",
        [p.sessionId],
        p.slotIds,
      ),
    );
  }
  return findings;
}

/** No teaching session sits on a break/blocked slot. */
export function checkBreakPlacement(ctx: ValidationContext): Finding[] {
  const findings: Finding[] = [];
  for (const p of ctx.placements) {
    const bad = p.slotIds.filter((sid) => {
      const slot = ctx.slotsById.get(sid);
      return slot !== undefined && slot.isBreak;
    });
    if (bad.length > 0) {
      const when = bad.map((s) => ctx.slotLabel(s)).join(", ");
      findings.push(
        error(
          ruleIds.BREAK_PLACEMENT,
          `${ctx.sessionLabel(p.sessionId)} is placed on break` +
            ` slot(s): ${when}. Breaks cannot host teaching sessions.` +
            " Suggested: move the session to a teaching period.",
          [p.sessionId],
          bad,
        ),
      );
    }
  }
  return findings;
}

// -- fixed and locked assignments ------------------------------------------------------

/** fixedSlotId / fixedRoomId / fixedFacultyId are honoured. */
export function checkFixedAssignments(ctx: ValidationContext): Finding[] {
  const findings: Finding[] = [];
  for (const p of ctx.placements) {
    const session = ctx.sessionsById.get(p.sessionId);
    if (session === undefined) continue;
    if (session.fixedSlotId !== null && !p.slotIds.includes(session.fixedSlotId)) {
      findings.push(
        error(
          ruleIds.FIXED_SLOT_CHANGED,
          `${ctx.sessionLabel(p.sessionId)} is fixed to` +
            ` ${ctx.slotLabel(session.fixedSlotId)} but is placed at` +
            ` ${p.slotIds.map((s) => ctx.slotLabel(s)).join(", ")}.` +
            " Suggested: move it back to its fixed slot.",
          [p.sessionId],
          [...p.slotIds, session.fixedSlotId],
        ),
      );
    }
    if (session.fixedRoomId !== null && p.roomId !== session.fixedRoomId) {
      findings.push(
        error(
          ruleIds.FIXED_ROOM_CHANGED,
          `${ctx.sessionLabel(p.sessionId)} is fixed to` +
            ` ${ctx.roomLabel(session.fixedRoomId)} but is placed in` +
            ` ${ctx.roomLabel(p.roomId)}.` +
            " Suggested: move it back to its fixed room.",
          [p.sessionId],
          p.slotIds,
        ),
      );
    }
    if (session.fixedFacultyId !== null && p.facultyId !== session.fixedFacultyId) {
      findings.push(
        error(
          ruleIds.FIXED_FACULTY_CHANGED,
          `${ctx.sessionLabel(p.sessionId)} is fixed to` +
            ` ${ctx.facultyLabel(session.fixedFacultyId)} but is` +
            ` assigned ${ctx.facultyLabel(p.facultyId)}.` +
            " Suggested: restore the fixed faculty assignment.",
          [p.sessionId],
          p.slotIds,
        ),
      );
    }
  }
  return findings;
}

/** Locked placements survive regeneration unchanged (slots, room, faculty). */
export function checkLockedPlacements(ctx: ValidationContext): Finding[] {
  const findings: Finding[] = [];
  const bySession = new Map<string, Placement[]>();
  for (const p of ctx.placements) {
    const list = bySession.get(p.sessionId);
    if (list === undefined) bySession.set(p.sessionId, [p]);
    else list.push(p);
  }
  // Slot order is insignificant: compare slot sets, room and faculty.
  const signature = (pl: {
    slotIds: readonly string[];
    roomId: string;
    facultyId: string;
  }) => JSON.stringify([sortedIds(pl.slotIds), pl.roomId, pl.facultyId]);
  for (const locked of ctx.problem.lockedPlacements) {
    const expected = signature(locked);
    const candidates = bySession.get(locked.sessionId) ?? [];
    if (candidates.length === 0) {
      findings.push(
        error(
          ruleIds.LOCKED_CHANGED,
          `Locked ${ctx.sessionLabel(locked.sessionId)} was removed` +
            " from the timetable." +
            " Suggested: restore it at" +
            ` ${locked.slotIds.map((s) => ctx.slotLabel(s)).join(", ")}` +
            ` in ${ctx.roomLabel(locked.roomId)} with` +
            ` ${ctx.facultyLabel(locked.facultyId)}, or have an` +
            " authorized user unlock it first.",
          [locked.sessionId],
          locked.slotIds,
        ),
      );
      continue;
    }
    if (candidates.some((c) => signature(c) === expected)) continue;
    const actual = candidates[0];
    const changed: string[] = [];
    if (
      JSON.stringify(sortedIds(actual.slotIds)) !==
      JSON.stringify(sortedIds(locked.slotIds))
    ) {
      changed.push(
        "time (" +
          locked.slotIds.map((s) => ctx.slotLabel(s)).join(", ") +
          " -> " +
          actual.slotIds.map((s) => ctx.slotLabel(s)).join(", ") +
          ")",
      );
    }
    if (actual.roomId !== locked.roomId) {
      changed.push(
        `room (${ctx.roomLabel(locked.roomId)} ->` +
          ` ${ctx.roomLabel(actual.roomId)})`,
      );
    }
    if (actual.facultyId !== locked.facultyId) {
      changed.push(
        `faculty (${ctx.facultyLabel(locked.facultyId)} ->` +
          ` ${ctx.facultyLabel(actual.facultyId)})`,
      );
    }
    findings.push(
      error(
        ruleIds.LOCKED_CHANGED,
        `Locked ${ctx.sessionLabel(locked.sessionId)} was changed:` +
          ` ${changed.join("; ")}.` +
          " Suggested: restore the locked placement, or have an" +
          " authorized user unlock it before regenerating.",
        [locked.sessionId],
        [...locked.slotIds, ...actual.slotIds],
      ),
    );
  }
  return findings;
}

// -- faculty daily load ------------------------------------------------------------------

/** maxPeriodsPerDay is respected for each faculty member. */
export function checkFacultyDailyLoad(ctx: ValidationContext): Finding[] {
  const slotsPerDay = new Map<string, Map<number, Set<string>>>();
  const sessionsPerDay = new Map<string, Map<number, Set<string>>>();
  const add = (
    store: Map<string, Map<number, Set<string>>>,
    facultyId: string,
    day: number,
    value: string,
  ) => {
    let days = store.get(facultyId);
    if (days === undefined) {
      days = new Map();
      store.set(facultyId, days);
    }
    let values = days.get(day);
    if (values === undefined) {
      values = new Set();
      days.set(day, values);
    }
    values.add(value);
  };
  for (const p of ctx.placements) {
    for (const slot of ctx.knownSlots(p)) {
      add(slotsPerDay, p.facultyId, slot.day, slot.id);
      add(sessionsPerDay, p.facultyId, slot.day, p.sessionId);
    }
  }
  const findings: Finding[] = [];
  for (const facultyId of sortedIds(slotsPerDay.keys())) {
    const fac = ctx.facultyById.get(facultyId);
    if (fac === undefined || fac.maxPeriodsPerDay === null) continue;
    const days = slotsPerDay.get(facultyId);
    if (days === undefined) continue;
    for (const day of [...days.keys()].sort((x, y) => x - y)) {
      const slotIds = days.get(day) ?? new Set<string>();
      const n = slotIds.size;
      if (n > fac.maxPeriodsPerDay) {
        findings.push(
          error(
            ruleIds.FACULTY_MAX_PERIODS,
            `${ctx.facultyLabel(facultyId)} teaches ${n} periods on` +
              ` ${dayName(day)}, exceeding their daily maximum of` +
              ` ${fac.maxPeriodsPerDay}.` +
              ` Suggested: move ${n - fac.maxPeriodsPerDay}` +
              " period(s) to another day.",
            sortedIds(sessionsPerDay.get(facultyId)?.get(day) ?? []),
            sortedIds(slotIds),
          ),
        );
      }
    }
  }
  return findings;
}

export const ALL_HARD_CHECKS: ReadonlyArray<
  (ctx: ValidationContext) => Finding[]
> = [
  checkOrphans,
  checkSessionCoverage,
  checkFacultyClashes,
  checkGroupClashes,
  checkRoomClashes,
  checkAvailability,
  checkRoomType,
  checkRoomCapacity,
  checkDuration,
  checkConsecutive,
  checkBreakPlacement,
  checkFixedAssignments,
  checkLockedPlacements,
  checkFacultyDailyLoad,
];
