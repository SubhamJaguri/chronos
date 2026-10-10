"""Chronos CP-SAT timetable solver.

Entry point: solve(problem, *, time_limit_s=60.0, seed=0) -> Solution.

Hard constraints are posted as CP-SAT model constraints; soft preferences only
contribute weighted terms to the minimised objective (weights live in
chronos.solver.weights), so a soft preference can never override a hard rule.

Determinism: the model is built in sorted order, the solver runs with a fixed
random_seed and exactly one search worker, so the same input always produces
the same output.
"""

from __future__ import annotations

from collections import defaultdict

from ortools.sat.python import cp_model

from chronos.core.domain import Placement, Problem, Solution
from chronos.solver import weights as W
from chronos.solver.analysis import CandidateSet, build_candidate_sets, run_prechecks
from chronos.solver.context import ProblemContext, build_context

_ASSUMPTION_TIME_LIMIT_S = 10.0


# ---------------------------------------------------------------------------
# Model construction
# ---------------------------------------------------------------------------


class _Model:
    def __init__(self) -> None:
        self.cp = cp_model.CpModel()
        # (session_id) -> list of (Candidate, BoolVar), aligned with candidates
        self.session_vars: dict[str, list[tuple[object, cp_model.IntVar]]] = {}
        self.assumptions: dict[str, cp_model.IntVar] = {}
        # busy booleans for soft terms
        self.fac_busy: dict[str, dict[str, cp_model.IntVar]] = {}
        self.grp_busy: dict[str, dict[str, cp_model.IntVar]] = {}
        self.fac_day_load: dict[tuple[str, int], list[tuple[cp_model.IntVar, int]]] = {}


def _build_model(
    ctx: ProblemContext, candsets: list[CandidateSet], *, relaxed: bool
) -> _Model:
    """Post all hard constraints.

    relaxed=True replaces each session's "must be placed" constraint with an
    assumption literal; CP-SAT's assumption mechanism then lets us extract a
    set of sessions that is sufficient for infeasibility.
    """
    m = _Model()
    cp = m.cp

    room_occ: dict[tuple[str, str], list[cp_model.IntVar]] = defaultdict(list)
    fac_occ: dict[tuple[str, str], list[cp_model.IntVar]] = defaultdict(list)
    grp_occ: dict[tuple[str, str], list[cp_model.IntVar]] = defaultdict(list)
    fac_day: dict[tuple[str, int], list[tuple[cp_model.IntVar, int]]] = defaultdict(list)

    for cs in sorted(candsets, key=lambda c: c.session.id):
        sid = cs.session.id
        dur = cs.session.duration_periods
        pairs: list[tuple[object, cp_model.IntVar]] = []
        for i, cand in enumerate(cs.candidates):
            var = cp.new_bool_var(f"a[{sid}][{i}]")
            pairs.append((cand, var))
            for slot_id in cand.slot_ids:
                room_occ[(cand.room_id, slot_id)].append(var)
                fac_occ[(cand.faculty_id, slot_id)].append(var)
                for leaf in sorted(ctx.session_leaves[sid]):
                    grp_occ[(leaf, slot_id)].append(var)
            fac_day[(cand.faculty_id, cand.day)].append((var, dur))
        m.session_vars[sid] = pairs

        allvars = [v for _, v in pairs]
        if relaxed:
            lit = cp.new_bool_var(f"placed[{sid}]")
            m.assumptions[sid] = lit
            cp.add(sum(allvars) == 1).only_enforce_if(lit)
            cp.add_at_most_one(allvars)
        else:
            cp.add_exactly_one(allvars)

    # No room double-booked; no faculty overlap; no student-group overlap
    # (the parent/child hierarchy is already resolved into shared leaves).
    for key in sorted(room_occ):
        if len(room_occ[key]) > 1:
            cp.add_at_most_one(room_occ[key])
    for key in sorted(fac_occ):
        if len(fac_occ[key]) > 1:
            cp.add_at_most_one(fac_occ[key])
    for key in sorted(grp_occ):
        if len(grp_occ[key]) > 1:
            cp.add_at_most_one(grp_occ[key])

    # Faculty per-day teaching cap across sessions.
    for (fid, day) in sorted(fac_day):
        fac = ctx.faculty_by_id.get(fid)
        if fac is None or fac.max_periods_per_day is None:
            continue
        terms = fac_day[(fid, day)]
        cp.add(sum(v * d for v, d in terms) <= fac.max_periods_per_day)

    m.fac_day_load = dict(fac_day)

    if not relaxed:
        # Busy indicators, needed only for the soft objective.
        for (fid, slot_id) in sorted(fac_occ):
            busy = m.cp.new_bool_var(f"fac_busy[{fid}][{slot_id}]")
            m.cp.add(busy == sum(fac_occ[(fid, slot_id)]))
            m.fac_busy.setdefault(fid, {})[slot_id] = busy
        for (leaf, slot_id) in sorted(grp_occ):
            busy = m.cp.new_bool_var(f"grp_busy[{leaf}][{slot_id}]")
            m.cp.add(busy == sum(grp_occ[(leaf, slot_id)]))
            m.grp_busy.setdefault(leaf, {})[slot_id] = busy

    return m


# ---------------------------------------------------------------------------
# Soft objective
# ---------------------------------------------------------------------------


def _gap_terms(
    ctx: ProblemContext,
    m: _Model,
    busy_by_entity: dict[str, dict[str, cp_model.IntVar]],
    weight: int,
    tag: str,
) -> list[object]:
    """Penalise idle teaching periods strictly between busy periods in a day."""
    terms: list[object] = []
    for eid in sorted(busy_by_entity):
        busy = busy_by_entity[eid]
        for day in ctx.days:
            seq = [busy.get(slot.id) for slot in ctx.day_teaching_slots[day]]
            for i in range(1, len(seq) - 1):
                prior = [v for v in seq[:i] if v is not None]
                later = [v for v in seq[i + 1 :] if v is not None]
                if not prior or not later:
                    continue
                before = m.cp.new_bool_var(f"{tag}_before[{eid}][{day}][{i}]")
                m.cp.add_max_equality(before, prior)
                after = m.cp.new_bool_var(f"{tag}_after[{eid}][{day}][{i}]")
                m.cp.add_max_equality(after, later)
                hole = m.cp.new_bool_var(f"{tag}_gap[{eid}][{day}][{i}]")
                cur = seq[i]
                if cur is None:
                    m.cp.add(hole >= before + after - 1)
                else:
                    m.cp.add(hole >= before + after - cur - 1)
                terms.append(weight * hole)
    return terms


def _add_objective(ctx: ProblemContext, m: _Model, candsets: list[CandidateSet]) -> None:
    terms: list[object] = []

    # 1. Spread repeated sessions of the same subject (for the same group set)
    #    across different days.
    by_key: dict[tuple[str, frozenset[str]], list[str]] = defaultdict(list)
    for cs in candsets:
        by_key[(cs.session.subject_id, cs.session.group_ids)].append(cs.session.id)
    for key in sorted(by_key, key=lambda k: (k[0], sorted(k[1]))):
        sids = by_key[key]
        if len(sids) < 2:
            continue
        for day in ctx.days:
            day_vars = [
                var
                for sid in sids
                for cand, var in m.session_vars[sid]
                if cand.day == day
            ]
            if len(day_vars) < 2:
                continue
            excess = m.cp.new_int_var(0, len(sids), f"spread[{key[0]}][{day}]")
            m.cp.add(excess >= sum(day_vars) - 1)
            terms.append(W.W_SPREAD_SAME_DAY * excess)

    # 2 & 3. Gaps in student-group days and faculty days.
    terms += _gap_terms(ctx, m, m.grp_busy, W.W_GROUP_GAP, "g")
    terms += _gap_terms(ctx, m, m.fac_busy, W.W_FACULTY_GAP, "f")

    # 4. Excessive consecutive teaching for one faculty member.
    k = W.MAX_DESIRED_CONSECUTIVE_TEACHING
    for fid in sorted(m.fac_busy):
        busy = m.fac_busy[fid]
        for day in ctx.days:
            slots = ctx.day_teaching_slots[day]
            # contiguous segments of period ordinals (a break splits a segment)
            segments: list[list[str]] = []
            for s in slots:
                if segments and ctx.slots_by_id[segments[-1][-1]].period == s.period - 1:
                    segments[-1].append(s.id)
                else:
                    segments.append([s.id])
            for seg in segments:
                for i in range(len(seg) - k):
                    window = [busy.get(s) for s in seg[i : i + k + 1]]
                    window_vars = [v for v in window if v is not None]
                    if len(window_vars) <= k:
                        continue
                    over = m.cp.new_bool_var(f"consec[{fid}][{day}][{i}]")
                    m.cp.add(over >= sum(window_vars) - k)
                    terms.append(W.W_EXCESS_CONSECUTIVE * over)

    # 5. Balance faculty load across days: minimise each faculty's busiest day.
    loads_by_fac: dict[str, list[cp_model.IntVar]] = defaultdict(list)
    for (fid, day) in sorted(m.fac_day_load):
        entries = m.fac_day_load[(fid, day)]
        ub = len(ctx.day_teaching_slots.get(day, []))
        load = m.cp.new_int_var(0, max(ub, 1), f"load[{fid}][{day}]")
        m.cp.add(load == sum(v * d for v, d in entries))
        loads_by_fac[fid].append(load)
    for fid in sorted(loads_by_fac):
        if len(loads_by_fac[fid]) < 2:
            continue
        ub = max(len(v) for v in ctx.day_teaching_slots.values())
        peak = m.cp.new_int_var(0, max(ub, 1), f"peak[{fid}]")
        m.cp.add_max_equality(peak, loads_by_fac[fid])
        terms.append(W.W_DAILY_LOAD_BALANCE * peak)

    # 6. Minimise disruption relative to previous (unlocked) placements.
    for sid in sorted(ctx.previous_by_session):
        if sid not in m.session_vars or sid in ctx.locked_by_session:
            continue
        prev = ctx.previous_by_session[sid]
        pairs = m.session_vars[sid]
        slot_match = [v for c, v in pairs if c.slot_ids == tuple(prev.slot_ids)]
        room_match = [v for c, v in pairs if c.room_id == prev.room_id]
        fac_match = [v for c, v in pairs if c.faculty_id == prev.faculty_id]
        terms.append(W.W_DISRUPTION_SLOT * (1 - sum(slot_match)))
        terms.append(W.W_DISRUPTION_ROOM * (1 - sum(room_match)))
        terms.append(W.W_DISRUPTION_FACULTY * (1 - sum(fac_match)))

    m.cp.minimize(sum(terms) if terms else 0)


# ---------------------------------------------------------------------------
# Solving
# ---------------------------------------------------------------------------


def _make_solver(time_limit_s: float, seed: int) -> cp_model.CpSolver:
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = time_limit_s
    solver.parameters.random_seed = seed
    # One worker and a fixed seed make the search reproducible run-to-run.
    solver.parameters.num_search_workers = 1
    return solver


def _explain_infeasible(
    ctx: ProblemContext, candsets: list[CandidateSet], time_limit_s: float, seed: int
) -> list[str]:
    """Narrow an infeasibility using CP-SAT's assumption mechanism."""
    m = _build_model(ctx, candsets, relaxed=True)
    ordered = sorted(m.assumptions)
    m.cp.add_assumptions([m.assumptions[sid] for sid in ordered])
    solver = _make_solver(min(time_limit_s, _ASSUMPTION_TIME_LIMIT_S), seed)
    status = solver.solve(m.cp)
    if status != cp_model.INFEASIBLE:
        return [
            "LIKELY: the assumption-based analysis could not narrow the cause within its "
            "time budget; the infeasibility involves interactions between many sessions."
        ]
    index_to_sid = {m.assumptions[sid].index: sid for sid in ordered}
    core = sorted(
        index_to_sid[i]
        for i in solver.sufficient_assumptions_for_infeasibility()
        if i in index_to_sid
    )
    if not core:
        return [
            "PROVEN: the hard constraints are contradictory independently of any "
            "session placement (check locked placements and fixed sessions)."
        ]
    listed = ", ".join(f"'{sid}'" for sid in core)
    return [
        "CP-SAT assumption analysis narrowed the cause: the session set "
        f"[{listed}] cannot all be placed together under the hard constraints - this is "
        "PROVEN for the set as a whole. Each individual session in the list is a LIKELY "
        "contributing factor (the set is sufficient for infeasibility but not guaranteed "
        "minimal)."
    ]


def _extract(
    ctx: ProblemContext, m: _Model, solver: cp_model.CpSolver, candsets: list[CandidateSet]
) -> list[Placement]:
    placements: list[Placement] = []
    for cs in sorted(candsets, key=lambda c: c.session.id):
        if cs.locked is not None:
            placements.append(cs.locked)  # preserved exactly as given
            continue
        for cand, var in m.session_vars[cs.session.id]:
            if solver.value(var) == 1:
                placements.append(
                    Placement(
                        session_id=cs.session.id,
                        slot_ids=cand.slot_ids,
                        room_id=cand.room_id,
                        faculty_id=cand.faculty_id,
                        locked=False,
                    )
                )
                break
    placements.extend(ctx.external_reservations)  # preserved verbatim
    placements.sort(key=lambda p: p.session_id)
    return placements


def solve(problem: Problem, *, time_limit_s: float = 60.0, seed: int = 0) -> Solution:
    """Generate a timetable for ``problem``.

    Returns a Solution whose status is "optimal", "feasible" (a valid timetable
    was found but optimality of the soft objective was not proven in time),
    "infeasible" (with diagnostics explaining why) or "timeout" (the time limit
    expired before feasibility could be decided either way).
    """
    ctx = build_context(problem)
    diagnostics: list[str] = list(ctx.warnings)

    candsets, cand_warnings = build_candidate_sets(ctx)
    diagnostics.extend(cand_warnings)

    proven = run_prechecks(ctx, candsets)
    if proven:
        return Solution(placements=[], status="infeasible", diagnostics=diagnostics + proven)

    m = _build_model(ctx, candsets, relaxed=False)
    _add_objective(ctx, m, candsets)
    solver = _make_solver(time_limit_s, seed)
    status = solver.solve(m.cp)

    if status == cp_model.OPTIMAL:
        return Solution(
            placements=_extract(ctx, m, solver, candsets),
            status="optimal",
            diagnostics=diagnostics,
        )
    if status == cp_model.FEASIBLE:
        diagnostics.append(
            "NOTE: the time limit was reached before the soft-objective optimum was proven; "
            "the timetable satisfies every hard constraint."
        )
        return Solution(
            placements=_extract(ctx, m, solver, candsets),
            status="feasible",
            diagnostics=diagnostics,
        )
    if status == cp_model.INFEASIBLE:
        diagnostics.append(
            "PROVEN: no timetable satisfies all hard constraints (CP-SAT proved the model "
            "infeasible; pre-checks found no single isolated cause)."
        )
        diagnostics.extend(_explain_infeasible(ctx, candsets, time_limit_s, seed))
        return Solution(placements=[], status="infeasible", diagnostics=diagnostics)

    diagnostics.append(
        f"Time limit of {time_limit_s}s expired before the solver could decide feasibility; "
        "nothing is proven either way. Re-run with a larger time_limit_s."
    )
    return Solution(placements=[], status="timeout", diagnostics=diagnostics)
