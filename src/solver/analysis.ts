/**
 * Candidate enumeration and pre-solver infeasibility diagnostics.
 *
 * Everything here runs BEFORE the CP-SAT model is built. Diagnostics are
 * worded with an explicit "PROVEN:" prefix when the message states a
 * mathematically certain cause of infeasibility, and "LIKELY:" when it is a
 * plausible contributing factor that is not individually proven
 * (requirements.md section 8 requires that distinction).
 *
 * Ported from the validated Python prototype (python-prototype branch,
 * src/chronos/solver/analysis.py).
 */

import type { Faculty, Placement, Room, Session, TimeSlot } from "@/core/domain";
import type { ProblemContext } from "./context";

/**
 * Activity types that may only be taught in a room of roomType "lab".
 * Facility-level matching (e.g. "needs projectors") is expected to be encoded
 * upstream in Session.eligibleRoomIds; the solver additionally enforces room
 * type and capacity.
 */
export const LAB_ACTIVITY_TYPES: ReadonlySet<string> = new Set(["lab"]);

/** One concrete (slot-run, room, faculty) assignment a session could take. */
export interface Candidate {
  slotIds: string[];
  day: number;
  roomId: string;
  facultyId: string;
}

export interface CandidateSet {
  session: Session;
  candidates: Candidate[];
  locked: Placement | null;
  /** PROVEN reason when candidates is empty. */
  failure: string | null;
}

// ---------------------------------------------------------------------------
// Slot-run enumeration
// ---------------------------------------------------------------------------

/**
 * All slot runs a session could occupy, honouring duration and
 * consecutiveness.
 *
 * Runs never include break slots and never span days. With
 * requiresConsecutive, period ordinals must be strictly contiguous, so a
 * break sitting between two teaching periods splits the day; without it, a
 * multi-period session may straddle a break (occupying the teaching periods
 * on either side) but still stays within one day.
 */
export function runsForSession(ctx: ProblemContext, session: Session): TimeSlot[][] {
  const d = session.durationPeriods;
  const runs: TimeSlot[][] = [];
  if (d < 1) return runs;
  for (const day of ctx.days) {
    const teach = ctx.dayTeachingSlots.get(day)!;
    for (let i = 0; i + d <= teach.length; i++) {
      const win = teach.slice(i, i + d);
      if (d > 1 && session.requiresConsecutive) {
        let contiguous = true;
        for (let j = 0; j + 1 < d; j++) {
          if (win[j + 1].period !== win[j].period + 1) {
            contiguous = false;
            break;
          }
        }
        if (!contiguous) continue;
      }
      runs.push(win);
    }
  }
  return runs;
}

function diagnoseNoRuns(ctx: ProblemContext, session: Session): string {
  const d = session.durationPeriods;
  if (d < 1) {
    return `PROVEN: session '${session.id}' has durationPeriods=${d}, which is invalid.`;
  }
  let longestDay = 0;
  for (const v of ctx.dayTeachingSlots.values()) {
    longestDay = Math.max(longestDay, v.length);
  }
  if (session.requiresConsecutive && d > 1) {
    return (
      `PROVEN: session '${session.id}' needs ${d} consecutive periods, but no day ` +
      `contains a contiguous run of ${d} teaching periods (breaks interrupt every ` +
      "candidate window)."
    );
  }
  return (
    `PROVEN: session '${session.id}' needs ${d} periods in one day, but the longest ` +
    `day has only ${longestDay} teaching periods.`
  );
}

function diagnoseFixedSlot(ctx: ProblemContext, session: Session): string {
  const fid = session.fixedSlotId;
  const slot = fid !== null ? ctx.slotsById.get(fid) : undefined;
  if (slot === undefined) {
    return `PROVEN: session '${session.id}' is fixed to unknown slot '${fid}'.`;
  }
  if (slot.isBreak) {
    return `PROVEN: session '${session.id}' is fixed to slot '${fid}', which is a break.`;
  }
  return (
    `PROVEN: session '${session.id}' is fixed to slot '${fid}', but no run of ` +
    `${session.durationPeriods} period(s) satisfying its consecutiveness requirement ` +
    "can start there."
  );
}

// ---------------------------------------------------------------------------
// Room / faculty pools
// ---------------------------------------------------------------------------

function roomPool(
  ctx: ProblemContext,
  session: Session,
  warnings: string[],
): { pool: Room[]; failure: string | null } {
  let pool: Room[];
  if (session.fixedRoomId !== null) {
    const room = ctx.roomsById.get(session.fixedRoomId);
    if (room === undefined) {
      return {
        pool: [],
        failure:
          `PROVEN: session '${session.id}' is fixed to unknown room ` +
          `'${session.fixedRoomId}'.`,
      };
    }
    if (!session.eligibleRoomIds.includes(session.fixedRoomId)) {
      warnings.push(
        `WARNING: session '${session.id}' is fixed to room '${session.fixedRoomId}' ` +
          "which is not in its eligibleRoomIds; the fixed room is honoured.",
      );
    }
    pool = [room];
  } else {
    if (session.eligibleRoomIds.length === 0) {
      return {
        pool: [],
        failure: `PROVEN: session '${session.id}' declares no eligible rooms.`,
      };
    }
    pool = [];
    for (const rid of [...new Set(session.eligibleRoomIds)].sort()) {
      const room = ctx.roomsById.get(rid);
      if (room === undefined) {
        warnings.push(
          `WARNING: session '${session.id}' lists unknown room '${rid}'; ignored.`,
        );
      } else {
        pool.push(room);
      }
    }
    if (pool.length === 0) {
      return {
        pool: [],
        failure:
          `PROVEN: session '${session.id}' has no eligible room: none of its ` +
          "eligibleRoomIds exist in the problem.",
      };
    }
  }

  if (LAB_ACTIVITY_TYPES.has(session.activityType)) {
    const typed = pool.filter((r) => r.roomType === "lab");
    if (typed.length === 0) {
      return {
        pool: [],
        failure:
          `PROVEN: session '${session.id}' is a lab but none of its eligible rooms ` +
          "has roomType 'lab'.",
      };
    }
    pool = typed;
  }

  const need = ctx.sessionStrength.get(session.id)!;
  const sized = pool.filter((r) => r.capacity >= need);
  if (sized.length === 0) {
    const biggest = Math.max(...pool.map((r) => r.capacity));
    return {
      pool: [],
      failure:
        `PROVEN: session '${session.id}' needs capacity for ${need} students, but its ` +
        `largest suitable eligible room holds ${biggest}.`,
    };
  }
  return { pool: sized, failure: null };
}

function facultyPool(
  ctx: ProblemContext,
  session: Session,
  warnings: string[],
): { pool: Faculty[]; failure: string | null } {
  if (session.fixedFacultyId !== null) {
    const fac = ctx.facultyById.get(session.fixedFacultyId);
    if (fac === undefined) {
      return {
        pool: [],
        failure:
          `PROVEN: session '${session.id}' is fixed to unknown faculty ` +
          `'${session.fixedFacultyId}'.`,
      };
    }
    if (!session.eligibleFacultyIds.includes(session.fixedFacultyId)) {
      warnings.push(
        `WARNING: session '${session.id}' is fixed to faculty ` +
          `'${session.fixedFacultyId}' which is not in its eligibleFacultyIds; ` +
          "the fixed faculty is honoured.",
      );
    }
    return { pool: [fac], failure: null };
  }
  if (session.eligibleFacultyIds.length === 0) {
    return {
      pool: [],
      failure: `PROVEN: session '${session.id}' declares no eligible faculty.`,
    };
  }
  const pool: Faculty[] = [];
  for (const fid of [...new Set(session.eligibleFacultyIds)].sort()) {
    const fac = ctx.facultyById.get(fid);
    if (fac === undefined) {
      warnings.push(
        `WARNING: session '${session.id}' lists unknown faculty '${fid}'; ignored.`,
      );
    } else {
      pool.push(fac);
    }
  }
  if (pool.length === 0) {
    return {
      pool: [],
      failure:
        `PROVEN: session '${session.id}' has no eligible faculty: none of its ` +
        "eligibleFacultyIds exist in the problem.",
    };
  }
  return { pool, failure: null };
}

// ---------------------------------------------------------------------------
// Candidate assembly
// ---------------------------------------------------------------------------

function reservationBlocks(
  reservations: Placement[],
  slotIds: string[],
  roomId: string,
  facultyId: string,
): boolean {
  for (const res of reservations) {
    const resSlots = new Set(res.slotIds);
    if (
      slotIds.some((s) => resSlots.has(s)) &&
      (res.roomId === roomId || res.facultyId === facultyId)
    ) {
      return true;
    }
  }
  return false;
}

/** Enumerate candidates for every session, with PROVEN failure reasons. */
export function buildCandidateSets(ctx: ProblemContext): {
  candidateSets: CandidateSet[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const out: CandidateSet[] = [];
  for (const sid of [...ctx.sessionsById.keys()].sort()) {
    const session = ctx.sessionsById.get(sid)!;
    const locked = ctx.lockedBySession.get(sid);
    if (locked !== undefined) {
      const knownDays = locked.slotIds
        .filter((s) => ctx.slotsById.has(s))
        .map((s) => ctx.slotsById.get(s)!.day);
      const day = knownDays.length > 0 ? Math.min(...knownDays) : -1;
      out.push({
        session,
        candidates: [
          {
            slotIds: [...locked.slotIds],
            day,
            roomId: locked.roomId,
            facultyId: locked.facultyId,
          },
        ],
        locked,
        failure: null,
      });
      continue;
    }

    let runs = runsForSession(ctx, session);
    if (runs.length === 0) {
      out.push({
        session,
        candidates: [],
        locked: null,
        failure: diagnoseNoRuns(ctx, session),
      });
      continue;
    }
    if (session.fixedSlotId !== null) {
      runs = runs.filter((r) => r[0].id === session.fixedSlotId);
      if (runs.length === 0) {
        out.push({
          session,
          candidates: [],
          locked: null,
          failure: diagnoseFixedSlot(ctx, session),
        });
        continue;
      }
    }

    const { pool: rooms, failure: roomFail } = roomPool(ctx, session, warnings);
    if (roomFail !== null) {
      out.push({ session, candidates: [], locked: null, failure: roomFail });
      continue;
    }
    const { pool: facs, failure: facFail } = facultyPool(ctx, session, warnings);
    if (facFail !== null) {
      out.push({ session, candidates: [], locked: null, failure: facFail });
      continue;
    }

    const cands: Candidate[] = [];
    const d = session.durationPeriods;
    for (const run of runs) {
      const runIds = run.map((s) => s.id);
      for (const room of rooms) {
        const roomUnavail = ctx.roomUnavailable.get(room.id)!;
        if (runIds.some((s) => roomUnavail.has(s))) continue;
        for (const fac of facs) {
          const facUnavail = ctx.facultyUnavailable.get(fac.id)!;
          if (runIds.some((s) => facUnavail.has(s))) continue;
          if (fac.maxPeriodsPerDay !== null && d > fac.maxPeriodsPerDay) continue;
          if (reservationBlocks(ctx.externalReservations, runIds, room.id, fac.id)) {
            continue;
          }
          cands.push({
            slotIds: runIds,
            day: run[0].day,
            roomId: room.id,
            facultyId: fac.id,
          });
        }
      }
    }
    if (cands.length === 0) {
      out.push({
        session,
        candidates: [],
        locked: null,
        failure:
          `PROVEN: session '${sid}' has eligible rooms and faculty, but every ` +
          "(slot-run, room, faculty) combination is blocked by room/faculty " +
          "unavailability, a per-day teaching limit below the session duration, " +
          "or locked reservations.",
      });
      continue;
    }
    out.push({ session, candidates: cands, locked: null, failure: null });
  }
  return { candidateSets: out, warnings };
}

// ---------------------------------------------------------------------------
// Locked-placement validation
// ---------------------------------------------------------------------------

/**
 * PROVEN diagnostics for locked placements that violate hard constraints.
 *
 * A locked placement must be preserved exactly; if it is itself invalid, the
 * whole problem is contradictory and we refuse with an explanation rather
 * than silently moving or dropping it.
 */
export function validateLocked(ctx: ProblemContext): string[] {
  const fatal: string[] = [];
  for (const sid of [...ctx.lockedBySession.keys()].sort()) {
    const p = ctx.lockedBySession.get(sid)!;
    const session = ctx.sessionsById.get(sid)!;
    const label = `locked placement for session '${sid}'`;

    const slots: TimeSlot[] = [];
    let ok = true;
    for (const slotId of p.slotIds) {
      const slot = ctx.slotsById.get(slotId);
      if (slot === undefined) {
        fatal.push(`PROVEN: ${label} uses unknown slot '${slotId}'.`);
        ok = false;
      } else {
        slots.push(slot);
      }
    }
    if (!ok) continue;
    if (
      new Set(p.slotIds).size !== p.slotIds.length ||
      p.slotIds.length !== session.durationPeriods
    ) {
      fatal.push(
        `PROVEN: ${label} occupies ${p.slotIds.length} slot(s) but the session ` +
          `requires exactly ${session.durationPeriods} distinct period(s).`,
      );
      continue;
    }
    if (slots.some((s) => s.isBreak)) {
      fatal.push(`PROVEN: ${label} sits on a break slot.`);
    }
    if (new Set(slots.map((s) => s.day)).size > 1) {
      fatal.push(`PROVEN: ${label} spans more than one day.`);
    } else if (session.requiresConsecutive && slots.length > 1) {
      const periods = slots.map((s) => s.period).sort((a, b) => a - b);
      const contiguous = periods.every((pd, i) => i === 0 || pd === periods[i - 1] + 1);
      if (!contiguous) {
        fatal.push(`PROVEN: ${label} is not consecutive but the session requires it.`);
      }
    }

    const room = ctx.roomsById.get(p.roomId);
    if (room === undefined) {
      fatal.push(`PROVEN: ${label} uses unknown room '${p.roomId}'.`);
    } else {
      const roomUnavail = ctx.roomUnavailable.get(room.id)!;
      if (p.slotIds.some((s) => roomUnavail.has(s))) {
        fatal.push(`PROVEN: ${label} uses room '${p.roomId}' while it is unavailable.`);
      }
      if (LAB_ACTIVITY_TYPES.has(session.activityType) && room.roomType !== "lab") {
        fatal.push(
          `PROVEN: ${label} places a lab in room '${p.roomId}' of type ` +
            `'${room.roomType}'.`,
        );
      }
      const need = ctx.sessionStrength.get(sid)!;
      if (room.capacity < need) {
        fatal.push(
          `PROVEN: ${label} uses room '${p.roomId}' (capacity ${room.capacity}) ` +
            `for ${need} students.`,
        );
      }
    }

    const fac = ctx.facultyById.get(p.facultyId);
    if (fac === undefined) {
      fatal.push(`PROVEN: ${label} uses unknown faculty '${p.facultyId}'.`);
    } else {
      const facUnavail = ctx.facultyUnavailable.get(fac.id)!;
      if (p.slotIds.some((s) => facUnavail.has(s))) {
        fatal.push(
          `PROVEN: ${label} assigns faculty '${p.facultyId}' while they are unavailable.`,
        );
      }
      if (
        fac.maxPeriodsPerDay !== null &&
        session.durationPeriods > fac.maxPeriodsPerDay
      ) {
        fatal.push(
          `PROVEN: ${label} gives faculty '${p.facultyId}' ` +
            `${session.durationPeriods} periods in one day, above their limit of ` +
            `${fac.maxPeriodsPerDay}.`,
        );
      }
    }

    if (session.fixedSlotId !== null && !p.slotIds.includes(session.fixedSlotId)) {
      fatal.push(`PROVEN: ${label} contradicts the session's fixedSlotId.`);
    }
    if (session.fixedRoomId !== null && session.fixedRoomId !== p.roomId) {
      fatal.push(`PROVEN: ${label} contradicts the session's fixedRoomId.`);
    }
    if (session.fixedFacultyId !== null && session.fixedFacultyId !== p.facultyId) {
      fatal.push(`PROVEN: ${label} contradicts the session's fixedFacultyId.`);
    }
  }
  return fatal;
}

// ---------------------------------------------------------------------------
// Determined-occupancy collisions (fixed/locked sessions against each other)
// ---------------------------------------------------------------------------

interface DeterminedOccupancy {
  sessionId: string;
  slots: Set<string>;
  roomId: string | null;
  facultyId: string | null;
  leaves: Set<string>;
}

/** The session's occupancy when its time is pinned, else null. */
function determinedOccupancy(
  ctx: ProblemContext,
  cs: CandidateSet,
): DeterminedOccupancy | null {
  if (cs.locked !== null) {
    return {
      sessionId: cs.session.id,
      slots: new Set(cs.locked.slotIds),
      roomId: cs.locked.roomId,
      facultyId: cs.locked.facultyId,
      leaves: ctx.sessionLeaves.get(cs.session.id)!,
    };
  }
  const session = cs.session;
  if (session.fixedSlotId === null || cs.candidates.length === 0) return null;
  const slotSets = new Set(cs.candidates.map((c) => JSON.stringify(c.slotIds)));
  if (slotSets.size !== 1) return null;
  return {
    sessionId: session.id,
    slots: new Set(cs.candidates[0].slotIds),
    roomId: session.fixedRoomId,
    facultyId: session.fixedFacultyId,
    leaves: ctx.sessionLeaves.get(session.id)!,
  };
}

export function checkFixedCollisions(
  ctx: ProblemContext,
  candidateSets: CandidateSet[],
): string[] {
  const fatal: string[] = [];
  const determined: DeterminedOccupancy[] = [];
  for (const cs of candidateSets) {
    const occ = determinedOccupancy(ctx, cs);
    if (occ !== null) determined.push(occ);
  }
  for (const res of ctx.externalReservations) {
    determined.push({
      sessionId: `(external) ${res.sessionId}`,
      slots: new Set(res.slotIds),
      roomId: res.roomId,
      facultyId: res.facultyId,
      leaves: new Set(),
    });
  }

  for (let i = 0; i < determined.length; i++) {
    const a = determined[i];
    for (let j = i + 1; j < determined.length; j++) {
      const b = determined[j];
      const shared = [...a.slots].filter((s) => b.slots.has(s));
      if (shared.length === 0) continue;
      const where = shared.sort().join(", ");
      if (a.roomId !== null && a.roomId === b.roomId) {
        fatal.push(
          `PROVEN: fixed/locked sessions '${a.sessionId}' and '${b.sessionId}' ` +
            `both require room '${a.roomId}' at slot(s) ${where}.`,
        );
      }
      if (a.facultyId !== null && a.facultyId === b.facultyId) {
        fatal.push(
          `PROVEN: fixed/locked sessions '${a.sessionId}' and '${b.sessionId}' ` +
            `both require faculty '${a.facultyId}' at slot(s) ${where}.`,
        );
      }
      const sharedLeaves = [...a.leaves].filter((l) => b.leaves.has(l));
      if (sharedLeaves.length > 0) {
        const grp = sharedLeaves.sort().join(", ");
        fatal.push(
          `PROVEN: fixed/locked sessions '${a.sessionId}' and '${b.sessionId}' ` +
            `overlap at slot(s) ${where} for the same student group(s): ${grp}.`,
        );
      }
    }
  }
  return fatal;
}

// ---------------------------------------------------------------------------
// Pigeonhole (counting) checks
// ---------------------------------------------------------------------------

/** Counting lower bounds: demand exceeding supply is PROVEN infeasible. */
export function checkCapacityCounts(
  ctx: ProblemContext,
  candidateSets: CandidateSet[],
): string[] {
  const fatal: string[] = [];
  const usable = candidateSets.filter((cs) => cs.candidates.length > 0);

  // Student groups (resolved to conflict leaves).
  const total = ctx.totalTeachingSlots;
  const demand = new Map<string, number>();
  const lockedDemand = new Map<string, number>();
  for (const cs of usable) {
    for (const leaf of ctx.sessionLeaves.get(cs.session.id)!) {
      demand.set(leaf, (demand.get(leaf) ?? 0) + cs.session.durationPeriods);
      if (cs.locked !== null) {
        lockedDemand.set(
          leaf,
          (lockedDemand.get(leaf) ?? 0) + cs.session.durationPeriods,
        );
      }
    }
  }
  for (const leaf of [...demand.keys()].sort()) {
    if (demand.get(leaf)! > total) {
      let msg =
        `PROVEN: student group '${leaf}' requires ${demand.get(leaf)} session-periods ` +
        `(including parent/child group sessions) but the week has only ${total} ` +
        "teaching periods.";
      const lockedCount = lockedDemand.get(leaf) ?? 0;
      if (lockedCount > 0) {
        msg +=
          ` Locked placements account for ${lockedCount} of those periods ` +
          "and leave insufficient room for the rest.";
      }
      fatal.push(msg);
    }
  }

  // Faculty whose sessions have a single possible teacher.
  const facDemand = new Map<string, number>();
  for (const cs of usable) {
    const pool = new Set(cs.candidates.map((c) => c.facultyId));
    if (pool.size === 1) {
      const fid = [...pool][0];
      facDemand.set(fid, (facDemand.get(fid) ?? 0) + cs.session.durationPeriods);
    }
  }
  for (const fid of [...facDemand.keys()].sort()) {
    const fac = ctx.facultyById.get(fid);
    if (fac === undefined) continue;
    const facUnavail = ctx.facultyUnavailable.get(fid)!;
    let supply = 0;
    for (const day of ctx.days) {
      let avail = ctx.dayTeachingSlots
        .get(day)!
        .filter((s) => !facUnavail.has(s.id)).length;
      if (fac.maxPeriodsPerDay !== null) avail = Math.min(avail, fac.maxPeriodsPerDay);
      supply += avail;
    }
    if (facDemand.get(fid)! > supply) {
      fatal.push(
        `PROVEN: faculty '${fid}' is the only possible teacher for ` +
          `${facDemand.get(fid)} session-periods but can teach at most ${supply} ` +
          "periods per week given their availability and per-day limit.",
      );
    }
  }

  // Rooms that are the only option for some sessions.
  const roomDemand = new Map<string, number>();
  for (const cs of usable) {
    const pool = new Set(cs.candidates.map((c) => c.roomId));
    if (pool.size === 1) {
      const rid = [...pool][0];
      roomDemand.set(rid, (roomDemand.get(rid) ?? 0) + cs.session.durationPeriods);
    }
  }
  for (const rid of [...roomDemand.keys()].sort()) {
    const room = ctx.roomsById.get(rid);
    if (room === undefined) continue;
    const roomUnavail = ctx.roomUnavailable.get(rid)!;
    let supply = 0;
    for (const day of ctx.days) {
      supply += ctx.dayTeachingSlots
        .get(day)!
        .filter((s) => !roomUnavail.has(s.id)).length;
    }
    if (roomDemand.get(rid)! > supply) {
      fatal.push(
        `PROVEN: room '${rid}' is the only suitable room for ${roomDemand.get(rid)} ` +
          `session-periods but is available for only ${supply} periods per week.`,
      );
    }
  }
  return fatal;
}

/** All PROVEN pre-solver diagnostics. Non-empty means the problem is infeasible. */
export function runPrechecks(
  ctx: ProblemContext,
  candidateSets: CandidateSet[],
): string[] {
  const fatal: string[] = [...ctx.fatal];
  fatal.push(...validateLocked(ctx));
  for (const cs of candidateSets) {
    if (cs.failure !== null) fatal.push(cs.failure);
  }
  // Collision and counting checks are only meaningful if the per-session
  // checks passed; still run them to surface as many causes as possible.
  fatal.push(...checkFixedCollisions(ctx, candidateSets));
  fatal.push(...checkCapacityCounts(ctx, candidateSets));
  // de-duplicate, preserving order
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of fatal) {
    if (!seen.has(m)) {
      seen.add(m);
      out.push(m);
    }
  }
  return out;
}
