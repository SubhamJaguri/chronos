/**
 * Indexed, hierarchy-resolved view of a Problem for the solver.
 *
 * Builds lookup tables, resolves the student-group parent/child hierarchy
 * down to conflict "leaves", computes combined group strengths, and separates
 * locked placements (hard) from previous placements (soft disruption
 * preferences).
 *
 * Ported from the validated Python prototype (python-prototype branch,
 * src/chronos/solver/context.py).
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

export interface ProblemContext {
  problem: Problem;
  slotsById: Map<string, TimeSlot>;
  roomsById: Map<string, Room>;
  facultyById: Map<string, Faculty>;
  groupsById: Map<string, StudentGroup>;
  sessionsById: Map<string, Session>;
  days: number[];
  /**
   * Non-break slots per day, sorted by period. These are the only slots a
   * session may ever occupy.
   */
  dayTeachingSlots: Map<number, TimeSlot[]>;
  totalTeachingSlots: number;
  /** gid -> {gid} | strict ancestors (parent chain, cycle-safe). */
  ancestors: Map<string, Set<string>>;
  /**
   * session id -> the set of conflict leaves the session occupies. Two
   * sessions clash on groups iff their leaf sets intersect; sibling batches
   * map to different leaves and therefore never clash with each other.
   */
  sessionLeaves: Map<string, Set<string>>;
  /** session id -> combined strength of its groups (nested groups deduplicated). */
  sessionStrength: Map<string, number>;
  lockedBySession: Map<string, Placement>;
  previousBySession: Map<string, Placement>;
  /**
   * Locked placements whose sessionId is unknown: preserved verbatim and
   * treated as opaque reservations of their room/faculty at their slots.
   */
  externalReservations: Placement[];
  /** Precomputed unavailable-slot sets for O(1) lookups. */
  roomUnavailable: Map<string, Set<string>>;
  facultyUnavailable: Map<string, Set<string>>;
  warnings: string[];
  fatal: string[];
}

export function placementsEqual(a: Placement, b: Placement): boolean {
  return (
    a.sessionId === b.sessionId &&
    a.roomId === b.roomId &&
    a.facultyId === b.facultyId &&
    a.locked === b.locked &&
    a.slotIds.length === b.slotIds.length &&
    a.slotIds.every((s, i) => s === b.slotIds[i])
  );
}

function ancestorChain(
  gid: string,
  groups: Map<string, StudentGroup>,
  warnings: string[],
): Set<string> {
  const chain = new Set<string>([gid]);
  let cur = groups.get(gid);
  while (cur !== undefined && cur.parentId !== null) {
    if (chain.has(cur.parentId)) {
      warnings.push(
        `WARNING: student group hierarchy contains a cycle at '${cur.parentId}'; ` +
          "the chain was truncated there.",
      );
      break;
    }
    chain.add(cur.parentId);
    cur = groups.get(cur.parentId);
  }
  return chain;
}

export function buildContext(problem: Problem): ProblemContext {
  const warnings: string[] = [];
  const fatal: string[] = [];

  const slotsById = new Map<string, TimeSlot>();
  for (const s of problem.slots) {
    if (slotsById.has(s.id)) {
      warnings.push(
        `WARNING: duplicate time slot id '${s.id}'; the first definition is used.`,
      );
      continue;
    }
    slotsById.set(s.id, s);
  }

  const roomsById = new Map(problem.rooms.map((r) => [r.id, r]));
  const facultyById = new Map(problem.faculty.map((f) => [f.id, f]));
  const groupsById = new Map(problem.groups.map((g) => [g.id, g]));

  const sessionsById = new Map<string, Session>();
  for (const sess of problem.sessions) {
    if (sessionsById.has(sess.id)) {
      fatal.push(`PROVEN: duplicate session id '${sess.id}' in the problem input.`);
      continue;
    }
    sessionsById.set(sess.id, sess);
  }

  const days = [...new Set([...slotsById.values()].map((s) => s.day))].sort(
    (a, b) => a - b,
  );
  const dayTeachingSlots = new Map<number, TimeSlot[]>();
  for (const d of days) {
    dayTeachingSlots.set(
      d,
      [...slotsById.values()]
        .filter((s) => s.day === d && !s.isBreak)
        .sort((a, b) => a.period - b.period),
    );
  }
  const totalTeachingSlots = [...dayTeachingSlots.values()].reduce(
    (acc, v) => acc + v.length,
    0,
  );

  // --- group hierarchy -----------------------------------------------------
  const ancestors = new Map<string, Set<string>>();
  for (const gid of [...groupsById.keys()].sort()) {
    ancestors.set(gid, ancestorChain(gid, groupsById, warnings));
  }
  const children = new Map<string, string[]>();
  for (const g of problem.groups) {
    if (g.parentId !== null) {
      const list = children.get(g.parentId) ?? [];
      list.push(g.id);
      children.set(g.parentId, list);
    }
  }

  function leavesUnder(gid: string): Set<string> {
    if (!groupsById.has(gid)) {
      return new Set([gid]); // synthetic leaf for an unknown group id
    }
    const out = new Set<string>();
    const stack = [gid];
    const seen = new Set<string>();
    while (stack.length > 0) {
      const cur = stack.pop()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      const kids = children.get(cur) ?? [];
      if (kids.length > 0) {
        stack.push(...kids);
      } else {
        out.add(cur);
      }
    }
    return out;
  }

  const sessionLeaves = new Map<string, Set<string>>();
  const sessionStrength = new Map<string, number>();
  for (const sid of [...sessionsById.keys()].sort()) {
    const sess = sessionsById.get(sid)!;
    const groupIdSet = new Set(sess.groupIds);
    const leaves = new Set<string>();
    for (const gid of [...groupIdSet].sort()) {
      if (!groupsById.has(gid)) {
        warnings.push(
          `WARNING: session '${sid}' references unknown student group '${gid}'; ` +
            "it is treated as an independent group of strength 0.",
        );
      }
      for (const leaf of leavesUnder(gid)) leaves.add(leaf);
    }
    sessionLeaves.set(sid, leaves);

    // Combined strength: sum only the topmost groups so a session listing
    // both a parent division and one of its child batches is not counted twice.
    let strength = 0;
    for (const gid of [...groupIdSet].sort()) {
      const grp = groupsById.get(gid);
      if (grp === undefined) continue;
      const anc = new Set(ancestors.get(gid) ?? [gid]);
      anc.delete(gid);
      let coveredByAncestor = false;
      for (const a of anc) {
        if (groupIdSet.has(a)) {
          coveredByAncestor = true; // an ancestor is also listed; it already covers this group
          break;
        }
      }
      if (coveredByAncestor) continue;
      strength += grp.strength;
    }
    sessionStrength.set(sid, strength);
  }

  // --- locked / previous placements ----------------------------------------
  const lockedBySession = new Map<string, Placement>();
  const previousBySession = new Map<string, Placement>();
  const externalReservations: Placement[] = [];
  for (const p of problem.lockedPlacements) {
    if (p.locked) {
      if (!sessionsById.has(p.sessionId)) {
        warnings.push(
          `WARNING: locked placement references unknown session '${p.sessionId}'; ` +
            "it is preserved verbatim and treated as an opaque room/faculty reservation.",
        );
        externalReservations.push(p);
        continue;
      }
      const existing = lockedBySession.get(p.sessionId);
      if (existing !== undefined && !placementsEqual(existing, p)) {
        fatal.push(
          `PROVEN: session '${p.sessionId}' has two contradictory locked placements.`,
        );
        continue;
      }
      lockedBySession.set(p.sessionId, p);
    } else {
      if (!sessionsById.has(p.sessionId)) {
        warnings.push(
          `WARNING: previous (unlocked) placement references unknown session ` +
            `'${p.sessionId}'; it is ignored.`,
        );
        continue;
      }
      previousBySession.set(p.sessionId, p);
    }
  }

  const roomUnavailable = new Map<string, Set<string>>();
  for (const r of problem.rooms) roomUnavailable.set(r.id, new Set(r.unavailableSlots));
  const facultyUnavailable = new Map<string, Set<string>>();
  for (const f of problem.faculty)
    facultyUnavailable.set(f.id, new Set(f.unavailableSlots));

  return {
    problem,
    slotsById,
    roomsById,
    facultyById,
    groupsById,
    sessionsById,
    days,
    dayTeachingSlots,
    totalTeachingSlots,
    ancestors,
    sessionLeaves,
    sessionStrength,
    lockedBySession,
    previousBySession,
    externalReservations,
    roomUnavailable,
    facultyUnavailable,
    warnings,
    fatal,
  };
}
