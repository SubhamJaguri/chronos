"""Candidate enumeration and pre-solver infeasibility diagnostics.

Everything here runs BEFORE the CP-SAT model is built. Diagnostics are worded
with an explicit "PROVEN:" prefix when the message states a mathematically
certain cause of infeasibility, and "LIKELY:" when it is a plausible
contributing factor that is not individually proven (requirements.md section 8
requires that distinction).
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass

from chronos.core.domain import ActivityType, Faculty, Placement, Room, Session, TimeSlot
from chronos.solver.context import ProblemContext

# Activity types that may only be taught in a room of room_type "lab".
# Facility-level matching (e.g. "needs projectors") is expected to be encoded
# upstream in Session.eligible_room_ids; the solver additionally enforces room
# type and capacity.
LAB_ACTIVITY_TYPES = frozenset({ActivityType.LAB})


@dataclass(frozen=True)
class Candidate:
    """One concrete (slot-run, room, faculty) assignment a session could take."""

    slot_ids: tuple[str, ...]
    day: int
    room_id: str
    faculty_id: str


@dataclass
class CandidateSet:
    session: Session
    candidates: list[Candidate]
    locked: Placement | None = None
    failure: str | None = None  # PROVEN reason when candidates is empty


# ---------------------------------------------------------------------------
# Slot-run enumeration
# ---------------------------------------------------------------------------


def runs_for_session(ctx: ProblemContext, session: Session) -> list[tuple[TimeSlot, ...]]:
    """All slot runs a session could occupy, honouring duration and consecutiveness.

    Runs never include break slots and never span days. With
    requires_consecutive, period ordinals must be strictly contiguous, so a
    break sitting between two teaching periods splits the day; without it, a
    multi-period session may straddle a break (occupying the teaching periods
    on either side) but still stays within one day.
    """
    d = session.duration_periods
    runs: list[tuple[TimeSlot, ...]] = []
    if d < 1:
        return runs
    for day in ctx.days:
        teach = ctx.day_teaching_slots[day]
        for i in range(len(teach) - d + 1):
            win = teach[i : i + d]
            if d > 1 and session.requires_consecutive:
                if any(win[j + 1].period != win[j].period + 1 for j in range(d - 1)):
                    continue
            runs.append(tuple(win))
    return runs


def _diagnose_no_runs(ctx: ProblemContext, session: Session) -> str:
    d = session.duration_periods
    if d < 1:
        return f"PROVEN: session '{session.id}' has duration_periods={d}, which is invalid."
    longest_day = max((len(v) for v in ctx.day_teaching_slots.values()), default=0)
    if session.requires_consecutive and d > 1:
        return (
            f"PROVEN: session '{session.id}' needs {d} consecutive periods, but no day "
            f"contains a contiguous run of {d} teaching periods (breaks interrupt every "
            "candidate window)."
        )
    return (
        f"PROVEN: session '{session.id}' needs {d} periods in one day, but the longest "
        f"day has only {longest_day} teaching periods."
    )


def _diagnose_fixed_slot(ctx: ProblemContext, session: Session) -> str:
    fid = session.fixed_slot_id
    slot = ctx.slots_by_id.get(fid) if fid else None
    if slot is None:
        return f"PROVEN: session '{session.id}' is fixed to unknown slot '{fid}'."
    if slot.is_break:
        return f"PROVEN: session '{session.id}' is fixed to slot '{fid}', which is a break."
    return (
        f"PROVEN: session '{session.id}' is fixed to slot '{fid}', but no run of "
        f"{session.duration_periods} period(s) satisfying its consecutiveness requirement "
        "can start there."
    )


# ---------------------------------------------------------------------------
# Room / faculty pools
# ---------------------------------------------------------------------------


def _room_pool(
    ctx: ProblemContext, session: Session, warnings: list[str]
) -> tuple[list[Room], str | None]:
    if session.fixed_room_id is not None:
        room = ctx.rooms_by_id.get(session.fixed_room_id)
        if room is None:
            return [], (
                f"PROVEN: session '{session.id}' is fixed to unknown room "
                f"'{session.fixed_room_id}'."
            )
        if session.fixed_room_id not in session.eligible_room_ids:
            warnings.append(
                f"WARNING: session '{session.id}' is fixed to room '{session.fixed_room_id}' "
                "which is not in its eligible_room_ids; the fixed room is honoured."
            )
        pool = [room]
    else:
        if not session.eligible_room_ids:
            return [], f"PROVEN: session '{session.id}' declares no eligible rooms."
        pool = []
        for rid in sorted(session.eligible_room_ids):
            room = ctx.rooms_by_id.get(rid)
            if room is None:
                warnings.append(
                    f"WARNING: session '{session.id}' lists unknown room '{rid}'; ignored."
                )
            else:
                pool.append(room)
        if not pool:
            return [], (
                f"PROVEN: session '{session.id}' has no eligible room: none of its "
                "eligible_room_ids exist in the problem."
            )

    if session.activity_type in LAB_ACTIVITY_TYPES:
        typed = [r for r in pool if r.room_type == "lab"]
        if not typed:
            return [], (
                f"PROVEN: session '{session.id}' is a lab but none of its eligible rooms "
                "has room_type 'lab'."
            )
        pool = typed

    need = ctx.session_strength[session.id]
    sized = [r for r in pool if r.capacity >= need]
    if not sized:
        biggest = max(r.capacity for r in pool)
        return [], (
            f"PROVEN: session '{session.id}' needs capacity for {need} students, but its "
            f"largest suitable eligible room holds {biggest}."
        )
    return sized, None


def _faculty_pool(
    ctx: ProblemContext, session: Session, warnings: list[str]
) -> tuple[list[Faculty], str | None]:
    if session.fixed_faculty_id is not None:
        fac = ctx.faculty_by_id.get(session.fixed_faculty_id)
        if fac is None:
            return [], (
                f"PROVEN: session '{session.id}' is fixed to unknown faculty "
                f"'{session.fixed_faculty_id}'."
            )
        if session.fixed_faculty_id not in session.eligible_faculty_ids:
            warnings.append(
                f"WARNING: session '{session.id}' is fixed to faculty "
                f"'{session.fixed_faculty_id}' which is not in its eligible_faculty_ids; "
                "the fixed faculty is honoured."
            )
        return [fac], None
    if not session.eligible_faculty_ids:
        return [], f"PROVEN: session '{session.id}' declares no eligible faculty."
    pool = []
    for fid in sorted(session.eligible_faculty_ids):
        fac = ctx.faculty_by_id.get(fid)
        if fac is None:
            warnings.append(
                f"WARNING: session '{session.id}' lists unknown faculty '{fid}'; ignored."
            )
        else:
            pool.append(fac)
    if not pool:
        return [], (
            f"PROVEN: session '{session.id}' has no eligible faculty: none of its "
            "eligible_faculty_ids exist in the problem."
        )
    return pool, None


# ---------------------------------------------------------------------------
# Candidate assembly
# ---------------------------------------------------------------------------


def _reservation_blocks(
    reservations: list[Placement], slot_ids: tuple[str, ...], room_id: str, faculty_id: str
) -> bool:
    for res in reservations:
        if any(s in res.slot_ids for s in slot_ids) and (
            res.room_id == room_id or res.faculty_id == faculty_id
        ):
            return True
    return False


def build_candidate_sets(ctx: ProblemContext) -> tuple[list[CandidateSet], list[str]]:
    """Enumerate candidates for every session, with PROVEN failure reasons."""
    warnings: list[str] = []
    out: list[CandidateSet] = []
    for sid in sorted(ctx.sessions_by_id):
        session = ctx.sessions_by_id[sid]
        locked = ctx.locked_by_session.get(sid)
        if locked is not None:
            day = min(
                (ctx.slots_by_id[s].day for s in locked.slot_ids if s in ctx.slots_by_id),
                default=-1,
            )
            out.append(
                CandidateSet(
                    session=session,
                    candidates=[
                        Candidate(
                            slot_ids=tuple(locked.slot_ids),
                            day=day,
                            room_id=locked.room_id,
                            faculty_id=locked.faculty_id,
                        )
                    ],
                    locked=locked,
                )
            )
            continue

        runs = runs_for_session(ctx, session)
        if not runs:
            out.append(CandidateSet(session, [], failure=_diagnose_no_runs(ctx, session)))
            continue
        if session.fixed_slot_id is not None:
            runs = [r for r in runs if r[0].id == session.fixed_slot_id]
            if not runs:
                out.append(CandidateSet(session, [], failure=_diagnose_fixed_slot(ctx, session)))
                continue

        rooms, fail = _room_pool(ctx, session, warnings)
        if fail:
            out.append(CandidateSet(session, [], failure=fail))
            continue
        facs, fail = _faculty_pool(ctx, session, warnings)
        if fail:
            out.append(CandidateSet(session, [], failure=fail))
            continue

        cands: list[Candidate] = []
        d = session.duration_periods
        for run in runs:
            run_ids = tuple(s.id for s in run)
            for room in rooms:
                if any(s in room.unavailable_slots for s in run_ids):
                    continue
                for fac in facs:
                    if any(s in fac.unavailable_slots for s in run_ids):
                        continue
                    if fac.max_periods_per_day is not None and d > fac.max_periods_per_day:
                        continue
                    if _reservation_blocks(
                        ctx.external_reservations, run_ids, room.id, fac.id
                    ):
                        continue
                    cands.append(
                        Candidate(
                            slot_ids=run_ids,
                            day=run[0].day,
                            room_id=room.id,
                            faculty_id=fac.id,
                        )
                    )
        if not cands:
            out.append(
                CandidateSet(
                    session,
                    [],
                    failure=(
                        f"PROVEN: session '{sid}' has eligible rooms and faculty, but every "
                        "(slot-run, room, faculty) combination is blocked by room/faculty "
                        "unavailability, a per-day teaching limit below the session duration, "
                        "or locked reservations."
                    ),
                )
            )
            continue
        out.append(CandidateSet(session, cands))
    return out, warnings


# ---------------------------------------------------------------------------
# Locked-placement validation
# ---------------------------------------------------------------------------


def validate_locked(ctx: ProblemContext) -> list[str]:
    """PROVEN diagnostics for locked placements that violate hard constraints.

    A locked placement must be preserved exactly; if it is itself invalid, the
    whole problem is contradictory and we refuse with an explanation rather
    than silently moving or dropping it.
    """
    fatal: list[str] = []
    for sid in sorted(ctx.locked_by_session):
        p = ctx.locked_by_session[sid]
        session = ctx.sessions_by_id[sid]
        label = f"locked placement for session '{sid}'"

        slots: list[TimeSlot] = []
        ok = True
        for slot_id in p.slot_ids:
            slot = ctx.slots_by_id.get(slot_id)
            if slot is None:
                fatal.append(f"PROVEN: {label} uses unknown slot '{slot_id}'.")
                ok = False
            else:
                slots.append(slot)
        if not ok:
            continue
        if len(set(p.slot_ids)) != len(p.slot_ids) or len(p.slot_ids) != session.duration_periods:
            fatal.append(
                f"PROVEN: {label} occupies {len(p.slot_ids)} slot(s) but the session "
                f"requires exactly {session.duration_periods} distinct period(s)."
            )
            continue
        if any(s.is_break for s in slots):
            fatal.append(f"PROVEN: {label} sits on a break slot.")
        if len({s.day for s in slots}) > 1:
            fatal.append(f"PROVEN: {label} spans more than one day.")
        elif session.requires_consecutive and len(slots) > 1:
            periods = sorted(s.period for s in slots)
            contiguous = all(b == a + 1 for a, b in zip(periods, periods[1:], strict=False))
            if not contiguous:
                fatal.append(f"PROVEN: {label} is not consecutive but the session requires it.")

        room = ctx.rooms_by_id.get(p.room_id)
        if room is None:
            fatal.append(f"PROVEN: {label} uses unknown room '{p.room_id}'.")
        else:
            if any(s in room.unavailable_slots for s in p.slot_ids):
                fatal.append(f"PROVEN: {label} uses room '{p.room_id}' while it is unavailable.")
            if session.activity_type in LAB_ACTIVITY_TYPES and room.room_type != "lab":
                fatal.append(
                    f"PROVEN: {label} places a lab in room '{p.room_id}' of type "
                    f"'{room.room_type}'."
                )
            need = ctx.session_strength[sid]
            if room.capacity < need:
                fatal.append(
                    f"PROVEN: {label} uses room '{p.room_id}' (capacity {room.capacity}) "
                    f"for {need} students."
                )

        fac = ctx.faculty_by_id.get(p.faculty_id)
        if fac is None:
            fatal.append(f"PROVEN: {label} uses unknown faculty '{p.faculty_id}'.")
        else:
            if any(s in fac.unavailable_slots for s in p.slot_ids):
                fatal.append(
                    f"PROVEN: {label} assigns faculty '{p.faculty_id}' while they are unavailable."
                )
            if (
                fac.max_periods_per_day is not None
                and session.duration_periods > fac.max_periods_per_day
            ):
                fatal.append(
                    f"PROVEN: {label} gives faculty '{p.faculty_id}' "
                    f"{session.duration_periods} periods in one day, above their limit of "
                    f"{fac.max_periods_per_day}."
                )

        if session.fixed_slot_id is not None and session.fixed_slot_id not in p.slot_ids:
            fatal.append(f"PROVEN: {label} contradicts the session's fixed_slot_id.")
        if session.fixed_room_id is not None and session.fixed_room_id != p.room_id:
            fatal.append(f"PROVEN: {label} contradicts the session's fixed_room_id.")
        if session.fixed_faculty_id is not None and session.fixed_faculty_id != p.faculty_id:
            fatal.append(f"PROVEN: {label} contradicts the session's fixed_faculty_id.")
    return fatal


# ---------------------------------------------------------------------------
# Determined-occupancy collisions (fixed/locked sessions against each other)
# ---------------------------------------------------------------------------


def _determined_occupancy(
    ctx: ProblemContext, cs: CandidateSet
) -> tuple[frozenset[str], str | None, str | None] | None:
    """(slot set, room or None, faculty or None) when the session's time is pinned."""
    if cs.locked is not None:
        return frozenset(cs.locked.slot_ids), cs.locked.room_id, cs.locked.faculty_id
    session = cs.session
    if session.fixed_slot_id is None or not cs.candidates:
        return None
    slot_sets = {c.slot_ids for c in cs.candidates}
    if len(slot_sets) != 1:
        return None
    return (
        frozenset(next(iter(slot_sets))),
        session.fixed_room_id,
        session.fixed_faculty_id,
    )


def check_fixed_collisions(ctx: ProblemContext, candsets: list[CandidateSet]) -> list[str]:
    fatal: list[str] = []
    determined: list[tuple[str, frozenset[str], str | None, str | None, frozenset[str]]] = []
    for cs in candsets:
        occ = _determined_occupancy(ctx, cs)
        if occ is not None:
            determined.append(
                (cs.session.id, occ[0], occ[1], occ[2], ctx.session_leaves[cs.session.id])
            )
    for res in ctx.external_reservations:
        determined.append(
            (f"(external) {res.session_id}", frozenset(res.slot_ids), res.room_id,
             res.faculty_id, frozenset())
        )

    for i, (sid_a, slots_a, room_a, fac_a, leaves_a) in enumerate(determined):
        for sid_b, slots_b, room_b, fac_b, leaves_b in determined[i + 1 :]:
            shared = slots_a & slots_b
            if not shared:
                continue
            where = ", ".join(sorted(shared))
            if room_a is not None and room_a == room_b:
                fatal.append(
                    f"PROVEN: fixed/locked sessions '{sid_a}' and '{sid_b}' both require "
                    f"room '{room_a}' at slot(s) {where}."
                )
            if fac_a is not None and fac_a == fac_b:
                fatal.append(
                    f"PROVEN: fixed/locked sessions '{sid_a}' and '{sid_b}' both require "
                    f"faculty '{fac_a}' at slot(s) {where}."
                )
            if leaves_a & leaves_b:
                grp = ", ".join(sorted(leaves_a & leaves_b))
                fatal.append(
                    f"PROVEN: fixed/locked sessions '{sid_a}' and '{sid_b}' overlap at "
                    f"slot(s) {where} for the same student group(s): {grp}."
                )
    return fatal


# ---------------------------------------------------------------------------
# Pigeonhole (counting) checks
# ---------------------------------------------------------------------------


def check_capacity_counts(ctx: ProblemContext, candsets: list[CandidateSet]) -> list[str]:
    """Counting lower bounds: demand exceeding supply is PROVEN infeasible."""
    fatal: list[str] = []
    usable = [cs for cs in candsets if cs.candidates]

    # Student groups (resolved to conflict leaves).
    total = ctx.total_teaching_slots
    demand: dict[str, int] = defaultdict(int)
    locked_demand: dict[str, int] = defaultdict(int)
    for cs in usable:
        for leaf in ctx.session_leaves[cs.session.id]:
            demand[leaf] += cs.session.duration_periods
            if cs.locked is not None:
                locked_demand[leaf] += cs.session.duration_periods
    for leaf in sorted(demand):
        if demand[leaf] > total:
            msg = (
                f"PROVEN: student group '{leaf}' requires {demand[leaf]} session-periods "
                f"(including parent/child group sessions) but the week has only {total} "
                "teaching periods."
            )
            if locked_demand[leaf]:
                msg += (
                    f" Locked placements account for {locked_demand[leaf]} of those periods "
                    "and leave insufficient room for the rest."
                )
            fatal.append(msg)

    # Faculty whose sessions have a single possible teacher.
    fac_demand: dict[str, int] = defaultdict(int)
    for cs in usable:
        pool = {c.faculty_id for c in cs.candidates}
        if len(pool) == 1:
            fac_demand[next(iter(pool))] += cs.session.duration_periods
    for fid in sorted(fac_demand):
        fac = ctx.faculty_by_id.get(fid)
        if fac is None:
            continue
        supply = 0
        for day in ctx.days:
            avail = sum(
                1 for s in ctx.day_teaching_slots[day] if s.id not in fac.unavailable_slots
            )
            if fac.max_periods_per_day is not None:
                avail = min(avail, fac.max_periods_per_day)
            supply += avail
        if fac_demand[fid] > supply:
            fatal.append(
                f"PROVEN: faculty '{fid}' is the only possible teacher for "
                f"{fac_demand[fid]} session-periods but can teach at most {supply} periods "
                "per week given their availability and per-day limit."
            )

    # Rooms that are the only option for some sessions.
    room_demand: dict[str, int] = defaultdict(int)
    for cs in usable:
        pool = {c.room_id for c in cs.candidates}
        if len(pool) == 1:
            room_demand[next(iter(pool))] += cs.session.duration_periods
    for rid in sorted(room_demand):
        room = ctx.rooms_by_id.get(rid)
        if room is None:
            continue
        supply = sum(
            1
            for day in ctx.days
            for s in ctx.day_teaching_slots[day]
            if s.id not in room.unavailable_slots
        )
        if room_demand[rid] > supply:
            fatal.append(
                f"PROVEN: room '{rid}' is the only suitable room for {room_demand[rid]} "
                f"session-periods but is available for only {supply} periods per week."
            )
    return fatal


def run_prechecks(ctx: ProblemContext, candsets: list[CandidateSet]) -> list[str]:
    """All PROVEN pre-solver diagnostics. Non-empty means the problem is infeasible."""
    fatal: list[str] = list(ctx.fatal)
    fatal.extend(validate_locked(ctx))
    for cs in candsets:
        if cs.failure is not None:
            fatal.append(cs.failure)
    # Collision and counting checks are only meaningful if the per-session
    # checks passed; still run them to surface as many causes as possible.
    fatal.extend(check_fixed_collisions(ctx, candsets))
    fatal.extend(check_capacity_counts(ctx, candsets))
    # de-duplicate, preserving order
    seen: set[str] = set()
    out = []
    for m in fatal:
        if m not in seen:
            seen.add(m)
            out.append(m)
    return out
