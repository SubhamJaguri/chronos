/**
 * Chronos CP-SAT timetable solver.
 *
 * Entry point: solve(problem, opts?) -> Promise<Solution>.
 *
 * Hard constraints are posted as CP-SAT model constraints; soft preferences
 * only contribute weighted terms to the minimised objective (weights live in
 * src/solver/weights.ts), so a soft preference can never override a hard
 * rule.
 *
 * Determinism: the model is built in fully sorted order and the solver runs
 * with exactly one search worker, so the same input always produces the same
 * output - verified across processes. The cpsat-js binding does not expose
 * CP-SAT's random_seed parameter; CP-SAT's internal default seed is a fixed
 * constant, so determinism holds regardless. The `seed` option is accepted
 * for API stability but cannot vary the underlying search until the binding
 * exposes the parameter.
 *
 * Solver backend: cpsat-js (WASM port of Google OR-Tools CP-SAT). The
 * binding has no first-class assumptions API, but it serialises the full
 * CpModelProto, so assumption literals are injected via the raw proto and
 * the infeasibility core is read back from
 * response.sufficientAssumptionsForInfeasibility - the same mechanism the
 * Python prototype used through ortools' native API.
 *
 * Ported from the validated Python prototype (python-prototype branch,
 * src/chronos/solver/engine.py).
 */

import { CpModel, CpSolver, CpSolverStatus, LinearExpr } from "cpsat-js";
import type { IntVar } from "cpsat-js";

import type { Placement, Problem, Solution } from "@/core/domain";
import type { Candidate, CandidateSet } from "./analysis";
import { buildCandidateSets, runPrechecks } from "./analysis";
import type { ProblemContext } from "./context";
import { buildContext } from "./context";
import * as W from "./weights";

const DEFAULT_TIME_LIMIT_MS = 60_000;
const ASSUMPTION_TIME_LIMIT_MS = 10_000;

// ---------------------------------------------------------------------------
// Linear-expression helpers (cpsat-js builds LinearExpr immutably; building
// the term map directly keeps large sums O(n) and the construction order
// deterministic).
// ---------------------------------------------------------------------------

function exprOf(terms: Iterable<readonly [IntVar, number]>, offset = 0): LinearExpr {
  const map = new Map<number, bigint>();
  for (const [v, c] of terms) {
    map.set(v.index, (map.get(v.index) ?? 0n) + BigInt(c));
  }
  return new LinearExpr(map, BigInt(offset));
}

function sumOf(vars: IntVar[]): LinearExpr {
  return exprOf(vars.map((v) => [v, 1] as const));
}

/** Accumulates the weighted soft objective as one linear expression. */
class ObjectiveBuilder {
  private readonly coeffs = new Map<number, bigint>();
  private offset = 0n;
  private touched = false;

  addTerm(v: IntVar, weight: number): void {
    this.coeffs.set(v.index, (this.coeffs.get(v.index) ?? 0n) + BigInt(weight));
    this.touched = true;
  }

  addConstant(weight: number): void {
    this.offset += BigInt(weight);
    this.touched = true;
  }

  get hasTerms(): boolean {
    return this.touched;
  }

  toExpr(): LinearExpr {
    return new LinearExpr(this.coeffs, this.offset);
  }
}

// ---------------------------------------------------------------------------
// Model construction
// ---------------------------------------------------------------------------

interface ModelBundle {
  cp: CpModel;
  /** session id -> (candidate, boolean var) pairs, aligned with candidates. */
  sessionVars: Map<string, Array<[Candidate, IntVar]>>;
  /** relaxed mode only: session id -> "placed" assumption literal. */
  assumptions: Map<string, IntVar>;
  /** busy booleans for soft terms: entity id -> slot id -> var. */
  facBusy: Map<string, Map<string, IntVar>>;
  grpBusy: Map<string, Map<string, IntVar>>;
  /** faculty id -> day -> [(candidate var, duration)]. */
  facDayLoad: Map<string, Map<number, Array<[IntVar, number]>>>;
}

function sortedKeys<V>(m: Map<string, V>): string[] {
  return [...m.keys()].sort();
}

/**
 * Post all hard constraints.
 *
 * relaxed=true replaces each session's "must be placed" constraint with an
 * assumption literal; CP-SAT's assumption mechanism then lets us extract a
 * set of sessions that is sufficient for infeasibility.
 */
function buildModel(
  ctx: ProblemContext,
  candidateSets: CandidateSet[],
  relaxed: boolean,
): ModelBundle {
  const cp = new CpModel();
  const m: ModelBundle = {
    cp,
    sessionVars: new Map(),
    assumptions: new Map(),
    facBusy: new Map(),
    grpBusy: new Map(),
    facDayLoad: new Map(),
  };

  // Occupancy keyed by "entityId\u0000slotId"; iterated in sorted key order.
  const roomOcc = new Map<string, IntVar[]>();
  const facOcc = new Map<string, IntVar[]>();
  const grpOcc = new Map<string, IntVar[]>();
  const occKey = (entity: string, slot: string) => `${entity}\u0000${slot}`;
  const push = (map: Map<string, IntVar[]>, key: string, v: IntVar) => {
    const list = map.get(key) ?? [];
    list.push(v);
    map.set(key, list);
  };

  const sorted = [...candidateSets].sort((a, b) =>
    a.session.id < b.session.id ? -1 : a.session.id > b.session.id ? 1 : 0,
  );

  for (const cs of sorted) {
    const sid = cs.session.id;
    const dur = cs.session.durationPeriods;
    const pairs: Array<[Candidate, IntVar]> = [];
    cs.candidates.forEach((cand, i) => {
      const v = cp.newBoolVar(`a[${sid}][${i}]`);
      pairs.push([cand, v]);
      for (const slotId of cand.slotIds) {
        push(roomOcc, occKey(cand.roomId, slotId), v);
        push(facOcc, occKey(cand.facultyId, slotId), v);
        for (const leaf of [...ctx.sessionLeaves.get(sid)!].sort()) {
          push(grpOcc, occKey(leaf, slotId), v);
        }
      }
      const byDay = m.facDayLoad.get(cand.facultyId) ?? new Map();
      const entries = byDay.get(cand.day) ?? [];
      entries.push([v, dur]);
      byDay.set(cand.day, entries);
      m.facDayLoad.set(cand.facultyId, byDay);
    });
    m.sessionVars.set(sid, pairs);

    const allVars = pairs.map(([, v]) => v);
    if (relaxed) {
      const lit = cp.newBoolVar(`placed[${sid}]`);
      m.assumptions.set(sid, lit);
      cp.add(sumOf(allVars).equals(1)).onlyEnforceIf(lit);
      cp.add(sumOf(allVars).le(1));
    } else {
      cp.add(sumOf(allVars).equals(1));
    }
  }

  // No room double-booked; no faculty overlap; no student-group overlap
  // (the parent/child hierarchy is already resolved into shared leaves).
  for (const occ of [roomOcc, facOcc, grpOcc]) {
    for (const key of sortedKeys(occ)) {
      const vars = occ.get(key)!;
      if (vars.length > 1) cp.add(sumOf(vars).le(1));
    }
  }

  // Faculty per-day teaching cap across sessions.
  for (const fid of sortedKeys(m.facDayLoad)) {
    const fac = ctx.facultyById.get(fid);
    if (fac === undefined || fac.maxPeriodsPerDay === null) continue;
    const byDay = m.facDayLoad.get(fid)!;
    for (const day of [...byDay.keys()].sort((a, b) => a - b)) {
      cp.add(exprOf(byDay.get(day)!).le(fac.maxPeriodsPerDay));
    }
  }

  if (!relaxed) {
    // Busy indicators, needed only for the soft objective.
    for (const key of sortedKeys(facOcc)) {
      const [fid, slotId] = key.split("\u0000");
      const busy = cp.newBoolVar(`fac_busy[${fid}][${slotId}]`);
      cp.add(busy.toLinearExpr().equals(sumOf(facOcc.get(key)!)));
      const inner = m.facBusy.get(fid) ?? new Map();
      inner.set(slotId, busy);
      m.facBusy.set(fid, inner);
    }
    for (const key of sortedKeys(grpOcc)) {
      const [leaf, slotId] = key.split("\u0000");
      const busy = cp.newBoolVar(`grp_busy[${leaf}][${slotId}]`);
      cp.add(busy.toLinearExpr().equals(sumOf(grpOcc.get(key)!)));
      const inner = m.grpBusy.get(leaf) ?? new Map();
      inner.set(slotId, busy);
      m.grpBusy.set(leaf, inner);
    }
  }

  return m;
}

// ---------------------------------------------------------------------------
// Soft objective
// ---------------------------------------------------------------------------

/**
 * Penalise idle teaching periods strictly between busy periods in a day.
 *
 * `before`/`after` are lower-bounded by every earlier/later busy indicator;
 * under minimisation they settle at exactly the max (the Python prototype
 * used add_max_equality, which has the same optimum).
 */
function addGapTerms(
  ctx: ProblemContext,
  m: ModelBundle,
  obj: ObjectiveBuilder,
  busyByEntity: Map<string, Map<string, IntVar>>,
  weight: number,
  tag: string,
): void {
  for (const eid of sortedKeys(busyByEntity)) {
    const busy = busyByEntity.get(eid)!;
    for (const day of ctx.days) {
      const seq = ctx.dayTeachingSlots.get(day)!.map((slot) => busy.get(slot.id) ?? null);
      for (let i = 1; i + 1 < seq.length; i++) {
        const prior = seq.slice(0, i).filter((v): v is IntVar => v !== null);
        const later = seq.slice(i + 1).filter((v): v is IntVar => v !== null);
        if (prior.length === 0 || later.length === 0) continue;
        const before = m.cp.newBoolVar(`${tag}_before[${eid}][${day}][${i}]`);
        for (const v of prior) m.cp.add(before.ge(v));
        const after = m.cp.newBoolVar(`${tag}_after[${eid}][${day}][${i}]`);
        for (const v of later) m.cp.add(after.ge(v));
        const hole = m.cp.newBoolVar(`${tag}_gap[${eid}][${day}][${i}]`);
        const cur = seq[i];
        const terms: Array<readonly [IntVar, number]> =
          cur === null
            ? [
                [before, 1],
                [after, 1],
              ]
            : [
                [before, 1],
                [after, 1],
                [cur, -1],
              ];
        m.cp.add(hole.ge(exprOf(terms, -1)));
        obj.addTerm(hole, weight);
      }
    }
  }
}

function addObjective(
  ctx: ProblemContext,
  m: ModelBundle,
  candidateSets: CandidateSet[],
): void {
  const obj = new ObjectiveBuilder();

  // 1. Spread repeated sessions of the same subject (for the same group set)
  //    across different days.
  const byKey = new Map<string, string[]>();
  for (const cs of candidateSets) {
    const key = `${cs.session.subjectId}\u0000${[...new Set(cs.session.groupIds)]
      .sort()
      .join(",")}`;
    const list = byKey.get(key) ?? [];
    list.push(cs.session.id);
    byKey.set(key, list);
  }
  for (const key of sortedKeys(byKey)) {
    const sids = byKey.get(key)!;
    if (sids.length < 2) continue;
    const subjectId = key.split("\u0000")[0];
    for (const day of ctx.days) {
      const dayVars: IntVar[] = [];
      for (const sid of sids) {
        for (const [cand, v] of m.sessionVars.get(sid)!) {
          if (cand.day === day) dayVars.push(v);
        }
      }
      if (dayVars.length < 2) continue;
      const excess = m.cp.newIntVar(0, sids.length, `spread[${subjectId}][${day}]`);
      m.cp.add(excess.ge(sumOf(dayVars).minus(1)));
      obj.addTerm(excess, W.W_SPREAD_SAME_DAY);
    }
  }

  // 2 & 3. Gaps in student-group days and faculty days.
  addGapTerms(ctx, m, obj, m.grpBusy, W.W_GROUP_GAP, "g");
  addGapTerms(ctx, m, obj, m.facBusy, W.W_FACULTY_GAP, "f");

  // 4. Excessive consecutive teaching for one faculty member.
  const k = W.MAX_DESIRED_CONSECUTIVE_TEACHING;
  for (const fid of sortedKeys(m.facBusy)) {
    const busy = m.facBusy.get(fid)!;
    for (const day of ctx.days) {
      const slots = ctx.dayTeachingSlots.get(day)!;
      // contiguous segments of period ordinals (a break splits a segment)
      const segments: string[][] = [];
      for (const s of slots) {
        const last = segments.length > 0 ? segments[segments.length - 1] : null;
        if (
          last !== null &&
          ctx.slotsById.get(last[last.length - 1])!.period === s.period - 1
        ) {
          last.push(s.id);
        } else {
          segments.push([s.id]);
        }
      }
      for (const seg of segments) {
        for (let i = 0; i + k < seg.length; i++) {
          const windowVars = seg
            .slice(i, i + k + 1)
            .map((s) => busy.get(s))
            .filter((v): v is IntVar => v !== undefined);
          if (windowVars.length <= k) continue;
          const over = m.cp.newBoolVar(`consec[${fid}][${day}][${i}]`);
          m.cp.add(over.ge(sumOf(windowVars).minus(k)));
          obj.addTerm(over, W.W_EXCESS_CONSECUTIVE);
        }
      }
    }
  }

  // 5. Balance faculty load across days: minimise each faculty's busiest day.
  let maxDaySize = 1;
  for (const v of ctx.dayTeachingSlots.values())
    maxDaySize = Math.max(maxDaySize, v.length);
  for (const fid of sortedKeys(m.facDayLoad)) {
    const byDay = m.facDayLoad.get(fid)!;
    const days = [...byDay.keys()].sort((a, b) => a - b);
    if (days.length < 2) continue;
    const peak = m.cp.newIntVar(0, maxDaySize, `peak[${fid}]`);
    for (const day of days) {
      m.cp.add(peak.ge(exprOf(byDay.get(day)!)));
    }
    obj.addTerm(peak, W.W_DAILY_LOAD_BALANCE);
  }

  // 6. Minimise disruption relative to previous (unlocked) placements.
  for (const sid of sortedKeys(ctx.previousBySession)) {
    if (!m.sessionVars.has(sid) || ctx.lockedBySession.has(sid)) continue;
    const prev = ctx.previousBySession.get(sid)!;
    const pairs = m.sessionVars.get(sid)!;
    const sameSlots = (c: Candidate) =>
      c.slotIds.length === prev.slotIds.length &&
      c.slotIds.every((s, i) => s === prev.slotIds[i]);
    // cost W * (1 - sum(match)) == W constant minus W per matching candidate
    obj.addConstant(W.W_DISRUPTION_SLOT + W.W_DISRUPTION_ROOM + W.W_DISRUPTION_FACULTY);
    for (const [cand, v] of pairs) {
      if (sameSlots(cand)) obj.addTerm(v, -W.W_DISRUPTION_SLOT);
      if (cand.roomId === prev.roomId) obj.addTerm(v, -W.W_DISRUPTION_ROOM);
      if (cand.facultyId === prev.facultyId) obj.addTerm(v, -W.W_DISRUPTION_FACULTY);
    }
  }

  if (obj.hasTerms) {
    m.cp.minimize(obj.toExpr());
  }
}

// ---------------------------------------------------------------------------
// Solving
// ---------------------------------------------------------------------------

let solverSingleton: Promise<CpSolver> | null = null;

/** The WASM module initialises asynchronously; load it once per process. */
function getSolver(): Promise<CpSolver> {
  if (solverSingleton === null) {
    solverSingleton = CpSolver.create();
  }
  return solverSingleton;
}

/**
 * Narrow an infeasibility using CP-SAT's assumption mechanism.
 *
 * cpsat-js has no assumptions API, but it serialises the raw CpModelProto,
 * so the assumption literals are written into the proto directly and the
 * core is read back from response.sufficientAssumptionsForInfeasibility.
 */
function explainInfeasible(
  ctx: ProblemContext,
  candidateSets: CandidateSet[],
  solver: CpSolver,
  timeLimitMs: number,
): string[] {
  const m = buildModel(ctx, candidateSets, true);
  const ordered = sortedKeys(m.assumptions);
  const proto = m.cp.toProto() as { assumptions?: number[] };
  proto.assumptions = ordered.map((sid) => m.assumptions.get(sid)!.index);
  const result = solver.solve(m.cp, {
    maxTimeInSeconds: Math.min(timeLimitMs, ASSUMPTION_TIME_LIMIT_MS) / 1000,
    numWorkers: 1,
  });
  if (result.status !== CpSolverStatus.INFEASIBLE) {
    return [
      "LIKELY: the assumption-based analysis could not narrow the cause within its " +
        "time budget; the infeasibility involves interactions between many sessions.",
    ];
  }
  const indexToSid = new Map<number, string>();
  for (const sid of ordered) indexToSid.set(m.assumptions.get(sid)!.index, sid);
  const rawCore = (
    result.response as unknown as { sufficientAssumptionsForInfeasibility?: number[] }
  ).sufficientAssumptionsForInfeasibility;
  const core = (rawCore ?? [])
    .map((i) => indexToSid.get(i))
    .filter((sid): sid is string => sid !== undefined)
    .sort();
  if (core.length === 0) {
    return [
      "PROVEN: the hard constraints are contradictory independently of any " +
        "session placement (check locked placements and fixed sessions).",
    ];
  }
  const listed = core.map((sid) => `'${sid}'`).join(", ");
  return [
    "CP-SAT assumption analysis narrowed the cause: the session set " +
      `[${listed}] cannot all be placed together under the hard constraints - this is ` +
      "PROVEN for the set as a whole. Each individual session in the list is a LIKELY " +
      "contributing factor (the set is sufficient for infeasibility but not guaranteed " +
      "minimal).",
  ];
}

function extract(
  ctx: ProblemContext,
  m: ModelBundle,
  value: (v: IntVar) => number,
  candidateSets: CandidateSet[],
): Placement[] {
  const placements: Placement[] = [];
  const sorted = [...candidateSets].sort((a, b) =>
    a.session.id < b.session.id ? -1 : a.session.id > b.session.id ? 1 : 0,
  );
  for (const cs of sorted) {
    if (cs.locked !== null) {
      placements.push(cs.locked); // preserved exactly as given
      continue;
    }
    for (const [cand, v] of m.sessionVars.get(cs.session.id)!) {
      if (value(v) === 1) {
        placements.push({
          sessionId: cs.session.id,
          slotIds: [...cand.slotIds],
          roomId: cand.roomId,
          facultyId: cand.facultyId,
          locked: false,
        });
        break;
      }
    }
  }
  placements.push(...ctx.externalReservations); // preserved verbatim
  placements.sort((a, b) =>
    a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0,
  );
  return placements;
}

export interface SolveOptions {
  /** Wall-clock limit for the solve. Default 60000. */
  timeLimitMs?: number;
  /**
   * Accepted for API stability. The cpsat-js binding does not expose
   * CP-SAT's random_seed parameter, so this value cannot vary the search;
   * determinism is guaranteed regardless (fixed internal seed, one search
   * worker, fully sorted model construction).
   */
  seed?: number;
}

/**
 * Generate a timetable for `problem`.
 *
 * Returns a Solution whose status is "optimal", "feasible" (a valid
 * timetable was found but optimality of the soft objective was not proven in
 * time), "infeasible" (with diagnostics explaining why) or "timeout" (the
 * time limit expired before feasibility could be decided either way).
 */
export async function solve(problem: Problem, opts?: SolveOptions): Promise<Solution> {
  const timeLimitMs = opts?.timeLimitMs ?? DEFAULT_TIME_LIMIT_MS;

  const ctx = buildContext(problem);
  const diagnostics: string[] = [...ctx.warnings];

  const { candidateSets, warnings: candWarnings } = buildCandidateSets(ctx);
  diagnostics.push(...candWarnings);

  const proven = runPrechecks(ctx, candidateSets);
  if (proven.length > 0) {
    return {
      placements: [],
      status: "infeasible",
      diagnostics: [...diagnostics, ...proven],
    };
  }

  const solver = await getSolver();
  const m = buildModel(ctx, candidateSets, false);
  addObjective(ctx, m, candidateSets);
  const result = solver.solve(m.cp, {
    maxTimeInSeconds: timeLimitMs / 1000,
    numWorkers: 1,
  });

  if (result.status === CpSolverStatus.OPTIMAL) {
    return {
      placements: extract(ctx, m, (v) => result.value(v), candidateSets),
      status: "optimal",
      diagnostics,
    };
  }
  if (result.status === CpSolverStatus.FEASIBLE) {
    diagnostics.push(
      "NOTE: the time limit was reached before the soft-objective optimum was proven; " +
        "the timetable satisfies every hard constraint.",
    );
    return {
      placements: extract(ctx, m, (v) => result.value(v), candidateSets),
      status: "feasible",
      diagnostics,
    };
  }
  if (result.status === CpSolverStatus.INFEASIBLE) {
    diagnostics.push(
      "PROVEN: no timetable satisfies all hard constraints (CP-SAT proved the model " +
        "infeasible; pre-checks found no single isolated cause).",
    );
    diagnostics.push(...explainInfeasible(ctx, candidateSets, solver, timeLimitMs));
    return { placements: [], status: "infeasible", diagnostics };
  }

  diagnostics.push(
    `Time limit of ${timeLimitMs}ms expired before the solver could decide ` +
      "feasibility; nothing is proven either way. Re-run with a larger timeLimitMs.",
  );
  return { placements: [], status: "timeout", diagnostics };
}
