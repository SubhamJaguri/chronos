/**
 * Soft-rule scoring (requirements.md section 8, "Soft constraints").
 *
 * Soft rules describe a timetable that is valid but not ideal. Every finding
 * here carries severity "warning" - never "error" - so soft preferences can
 * never block publication on their own.
 */
import type { Finding } from "@/core/domain";
import * as ruleIds from "./ruleIds";
import { ValidationContext, dayName, sentenceCase, sortedIds } from "./context";

/**
 * A faculty member's busiest teaching day exceeding their lightest teaching
 * day by this many periods is reported as imbalance.
 */
export const WORKLOAD_IMBALANCE_THRESHOLD = 3;

function warning(
  ruleId: string,
  message: string,
  sessionIds: readonly string[] = [],
  slotIds: readonly string[] = [],
): Finding {
  return {
    ruleId,
    severity: "warning",
    message,
    sessionIds: [...sessionIds],
    slotIds: [...slotIds],
  };
}

/**
 * Multiple separate sessions of one subject for one group on one day.
 *
 * A single multi-period session (e.g. a 2-period lab) is not clustering;
 * only distinct sessions of the same subject landing on the same day are.
 */
export function checkSubjectClustering(ctx: ValidationContext): Finding[] {
  interface Cluster {
    groupId: string;
    subjectId: string;
    day: number;
    sessionIds: Set<string>;
    slotIds: Set<string>;
  }
  const clusters = new Map<string, Cluster>();
  for (const p of ctx.placements) {
    const session = ctx.sessionsById.get(p.sessionId);
    if (session === undefined) continue;
    for (const slot of ctx.knownSlots(p)) {
      for (const gid of session.groupIds) {
        const key = `${gid} ${session.subjectId} ${slot.day}`;
        let cluster = clusters.get(key);
        if (cluster === undefined) {
          cluster = {
            groupId: gid,
            subjectId: session.subjectId,
            day: slot.day,
            sessionIds: new Set(),
            slotIds: new Set(),
          };
          clusters.set(key, cluster);
        }
        cluster.sessionIds.add(p.sessionId);
        cluster.slotIds.add(slot.id);
      }
    }
  }
  const findings: Finding[] = [];
  const keys = [...clusters.keys()].sort();
  for (const key of keys) {
    const cluster = clusters.get(key);
    if (cluster === undefined || cluster.sessionIds.size < 2) continue;
    const sessionIds = sortedIds(cluster.sessionIds);
    const anySession = ctx.sessionsById.get(sessionIds[0]);
    if (anySession === undefined) continue;
    findings.push(
      warning(
        ruleIds.SUBJECT_CLUSTER,
        `Subject '${anySession.subjectName}' has ${cluster.sessionIds.size}` +
          ` separate sessions for ${ctx.groupLabel(cluster.groupId)} on` +
          ` ${dayName(cluster.day)}, which clusters the subject.` +
          " Suggested: spread these sessions across different days.",
        sessionIds,
        sortedIds(cluster.slotIds),
      ),
    );
  }
  return findings;
}

/**
 * Shared gap detection: an idle teaching period strictly between the first
 * and last occupied period of a day. Break periods are not gaps.
 */
function gapFindings(
  ctx: ValidationContext,
  ruleId: string,
  ownerLabel: string,
  occupied: Map<number, Set<number>>,
  sessionsByDay: Map<number, Set<string>>,
): Finding[] {
  const findings: Finding[] = [];
  for (const day of [...occupied.keys()].sort((x, y) => x - y)) {
    const periods = occupied.get(day);
    if (periods === undefined || periods.size < 2) continue;
    const sorted = [...periods].sort((x, y) => x - y);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const gapSlots = [];
    for (let q = first + 1; q < last; q++) {
      if (periods.has(q)) continue;
      const slot = ctx.slotAt(day, q);
      if (slot !== undefined && !slot.isBreak) gapSlots.push(slot);
    }
    if (gapSlots.length === 0) continue;
    const listed = gapSlots.map((s) => ctx.slotLabel(s.id)).join(", ");
    findings.push(
      warning(
        ruleId,
        `${ownerLabel} has ${gapSlots.length} idle gap period(s) on` +
          ` ${dayName(day)}: ${listed}.` +
          " Suggested: compact the day's sessions to remove the gap.",
        sortedIds(sessionsByDay.get(day) ?? []),
        gapSlots.map((s) => s.id),
      ),
    );
  }
  return findings;
}

/**
 * Idle gaps in a student group's day.
 *
 * Computed for leaf groups (the finest unit students belong to), counting
 * every session the group attends directly or through an ancestor division.
 */
export function checkGroupGaps(ctx: ValidationContext): Finding[] {
  const findings: Finding[] = [];
  for (const gid of ctx.leafGroupIds) {
    const occupied = new Map<number, Set<number>>();
    const sessionsByDay = new Map<number, Set<string>>();
    for (const p of ctx.placements) {
      const session = ctx.sessionsById.get(p.sessionId);
      if (session === undefined || !ctx.groupAttends(gid, session.groupIds)) {
        continue;
      }
      for (const slot of ctx.knownSlots(p)) {
        let periods = occupied.get(slot.day);
        if (periods === undefined) {
          periods = new Set();
          occupied.set(slot.day, periods);
        }
        periods.add(slot.period);
        let sessions = sessionsByDay.get(slot.day);
        if (sessions === undefined) {
          sessions = new Set();
          sessionsByDay.set(slot.day, sessions);
        }
        sessions.add(p.sessionId);
      }
    }
    findings.push(
      ...gapFindings(
        ctx,
        ruleIds.GROUP_GAPS,
        sentenceCase(ctx.groupLabel(gid)),
        occupied,
        sessionsByDay,
      ),
    );
  }
  return findings;
}

/** Idle gaps in a faculty member's teaching day. */
export function checkFacultyGaps(ctx: ValidationContext): Finding[] {
  const occupied = new Map<string, Map<number, Set<number>>>();
  const sessionsByDay = new Map<string, Map<number, Set<string>>>();
  for (const p of ctx.placements) {
    for (const slot of ctx.knownSlots(p)) {
      let days = occupied.get(p.facultyId);
      if (days === undefined) {
        days = new Map();
        occupied.set(p.facultyId, days);
      }
      let periods = days.get(slot.day);
      if (periods === undefined) {
        periods = new Set();
        days.set(slot.day, periods);
      }
      periods.add(slot.period);

      let sDays = sessionsByDay.get(p.facultyId);
      if (sDays === undefined) {
        sDays = new Map();
        sessionsByDay.set(p.facultyId, sDays);
      }
      let sessions = sDays.get(slot.day);
      if (sessions === undefined) {
        sessions = new Set();
        sDays.set(slot.day, sessions);
      }
      sessions.add(p.sessionId);
    }
  }
  const findings: Finding[] = [];
  for (const facultyId of sortedIds(occupied.keys())) {
    if (!ctx.facultyById.has(facultyId)) {
      continue; // unknown faculty already reported as H-ORPHAN-FACULTY
    }
    findings.push(
      ...gapFindings(
        ctx,
        ruleIds.FACULTY_GAPS,
        sentenceCase(ctx.facultyLabel(facultyId)),
        occupied.get(facultyId) ?? new Map(),
        sessionsByDay.get(facultyId) ?? new Map(),
      ),
    );
  }
  return findings;
}

/**
 * Faculty workload spread across their teaching days (section 8: "Balance
 * faculty workload across days").
 */
export function checkWorkloadBalance(ctx: ValidationContext): Finding[] {
  const load = new Map<string, Map<number, Set<string>>>();
  const sessionsByDay = new Map<string, Map<number, Set<string>>>();
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
      add(load, p.facultyId, slot.day, slot.id);
      add(sessionsByDay, p.facultyId, slot.day, p.sessionId);
    }
  }
  const findings: Finding[] = [];
  for (const facultyId of sortedIds(load.keys())) {
    if (!ctx.facultyById.has(facultyId)) continue;
    const days = load.get(facultyId);
    if (days === undefined || days.size < 2) continue;
    const perDay = new Map<number, number>();
    for (const [day, slots] of days) perDay.set(day, slots.size);
    // Busiest: highest count, earliest day on ties.
    // Lightest: lowest count, earliest day on ties.
    let busiest = -1;
    let lightest = -1;
    for (const day of [...perDay.keys()].sort((x, y) => x - y)) {
      const n = perDay.get(day) ?? 0;
      if (busiest === -1 || n > (perDay.get(busiest) ?? 0)) busiest = day;
      if (lightest === -1 || n < (perDay.get(lightest) ?? 0)) lightest = day;
    }
    const busiestLoad = perDay.get(busiest) ?? 0;
    const lightestLoad = perDay.get(lightest) ?? 0;
    if (busiestLoad - lightestLoad < WORKLOAD_IMBALANCE_THRESHOLD) continue;
    const facultyDays = sessionsByDay.get(facultyId) ?? new Map<number, Set<string>>();
    const involved = new Set<string>([
      ...(facultyDays.get(busiest) ?? []),
      ...(facultyDays.get(lightest) ?? []),
    ]);
    findings.push(
      warning(
        ruleIds.WORKLOAD_IMBALANCE,
        `${sentenceCase(ctx.facultyLabel(facultyId))} has an uneven` +
          ` weekly load: ${busiestLoad} periods on` +
          ` ${dayName(busiest)} but only ${lightestLoad} on` +
          ` ${dayName(lightest)}.` +
          ` Suggested: move a session from ${dayName(busiest)} to` +
          ` ${dayName(lightest)}.`,
        sortedIds(involved),
        sortedIds(days.get(busiest) ?? []),
      ),
    );
  }
  return findings;
}

export const ALL_SOFT_CHECKS: ReadonlyArray<
  (ctx: ValidationContext) => Finding[]
> = [
  checkSubjectClustering,
  checkGroupGaps,
  checkFacultyGaps,
  checkWorkloadBalance,
];
