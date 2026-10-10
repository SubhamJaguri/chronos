"""Locked-placement preservation and disruption minimisation."""

from __future__ import annotations

from util import assert_valid, fac, grp, make_grid, room, ses

from chronos.core.domain import Placement, Problem
from chronos.core.fixtures import tiny_feasible, with_locked
from chronos.solver import solve


def test_locked_placement_preserved_exactly():
    problem = with_locked()
    sol = solve(problem)
    assert sol.status == "optimal"
    assert_valid(problem, sol)
    locked = next(p for p in sol.placements if p.session_id == "ses-s1")
    assert locked == problem.locked_placements[0]
    assert locked.locked is True


def test_others_schedule_around_the_lock():
    """The lock pins room-r1/fac-f1 at d0p0; nothing else may use them there."""
    problem = with_locked()
    sol = solve(problem)
    for p in sol.placements:
        if p.session_id == "ses-s1":
            continue
        if "slot-d0-p0" in p.slot_ids:
            assert p.room_id != "room-r1"
            assert p.faculty_id != "fac-f1"


def test_locked_placements_leaving_no_room_are_diagnosed():
    """One group, two periods, three sessions: with one session locked onto a
    period, the group provably cannot fit the remaining two sessions."""
    problem = Problem(
        slots=make_grid(days=1, periods=2),
        rooms=[room("r1"), room("r2")],
        faculty=[fac("f1"), fac("f2")],
        groups=[grp("g1")],
        sessions=[
            ses("s1", {"g1"}, {"f1", "f2"}, {"r1", "r2"}),
            ses("s2", {"g1"}, {"f1", "f2"}, {"r1", "r2"}),
            ses("s3", {"g1"}, {"f1", "f2"}, {"r1", "r2"}),
        ],
        locked_placements=[
            Placement("s1", ("d0p0",), "r1", "f1", locked=True),
        ],
    )
    sol = solve(problem)
    assert sol.status == "infeasible"
    assert any("PROVEN" in d and "g1" in d for d in sol.diagnostics)


def test_invalid_lock_is_refused_with_explanation():
    """A lock sitting on a break slot is contradictory input, not something to move."""
    problem = Problem(
        slots=make_grid(days=1, periods=3, breaks=(1,)),
        rooms=[room("r1")],
        faculty=[fac("f1")],
        groups=[grp("g1")],
        sessions=[ses("s1", {"g1"}, {"f1"}, {"r1"})],
        locked_placements=[Placement("s1", ("d0p1",), "r1", "f1", locked=True)],
    )
    sol = solve(problem)
    assert sol.status == "infeasible"
    assert any("PROVEN" in d and "break" in d for d in sol.diagnostics)


def test_two_contradictory_locks_for_one_session_are_refused():
    problem = tiny_feasible()
    problem.locked_placements = [
        Placement("ses-s1", ("slot-d0-p0",), "room-r1", "fac-f1", locked=True),
        Placement("ses-s1", ("slot-d0-p1",), "room-r1", "fac-f1", locked=True),
    ]
    sol = solve(problem)
    assert sol.status == "infeasible"
    assert any("contradictory locked placements" in d for d in sol.diagnostics)


def test_previous_unlocked_placements_minimise_disruption():
    """A full previous timetable with locked=False is kept when still feasible."""
    problem = tiny_feasible()
    previous = [
        Placement("ses-s1", ("slot-d0-p0",), "room-r1", "fac-f1", locked=False),
        Placement("ses-s2", ("slot-d0-p1",), "room-r1", "fac-f1", locked=False),
        Placement("ses-s3", ("slot-d1-p0",), "room-r1", "fac-f1", locked=False),
        Placement("ses-s4", ("slot-d1-p1",), "room-r1", "fac-f1", locked=False),
    ]
    problem.locked_placements = list(previous)
    sol = solve(problem)
    assert sol.status == "optimal"
    assert_valid(problem, sol)
    got = {p.session_id: p for p in sol.placements}
    for prev in previous:
        p = got[prev.session_id]
        assert p.slot_ids == prev.slot_ids
        assert p.room_id == prev.room_id
        assert p.faculty_id == prev.faculty_id
