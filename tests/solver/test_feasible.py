"""Known-feasible problems must solve and pass independent verification."""

from __future__ import annotations

from util import assert_valid, fac, grp, make_grid, room, ses

from chronos.core.domain import ActivityType, Problem
from chronos.core.fixtures import lab_consecutive, tiny_feasible, with_locked
from chronos.solver import solve


def test_tiny_feasible_solves_optimal():
    problem = tiny_feasible()
    sol = solve(problem, time_limit_s=20)
    assert sol.status == "optimal"
    assert_valid(problem, sol)


def test_lab_fixture_solves():
    problem = lab_consecutive()
    sol = solve(problem, time_limit_s=20)
    assert sol.status == "optimal"
    assert_valid(problem, sol)


def test_locked_fixture_solves():
    problem = with_locked()
    sol = solve(problem, time_limit_s=20)
    assert sol.status == "optimal"
    assert_valid(problem, sol)


def test_shared_parent_lecture_with_child_batches():
    """A division-wide lecture plus per-batch labs schedules without clashes."""
    problem = Problem(
        slots=make_grid(days=2, periods=4),
        rooms=[room("hall", capacity=80), room("lab1", capacity=30, room_type="lab")],
        faculty=[fac("f1"), fac("f2")],
        groups=[
            grp("div-a", strength=60),
            grp("batch-a1", strength=30, parent_id="div-a"),
            grp("batch-a2", strength=30, parent_id="div-a"),
        ],
        sessions=[
            ses("lecture", {"div-a"}, {"f1"}, {"hall"}),
            ses("lab-a1", {"batch-a1"}, {"f2"}, {"lab1"}, activity=ActivityType.LAB),
            ses("lab-a2", {"batch-a2"}, {"f2"}, {"lab1"}, activity=ActivityType.LAB),
        ],
    )
    sol = solve(problem, time_limit_s=20)
    assert sol.status == "optimal"
    assert_valid(problem, sol)


def test_empty_problem_is_optimal():
    problem = Problem(slots=make_grid(), rooms=[], faculty=[], groups=[], sessions=[])
    sol = solve(problem)
    assert sol.status == "optimal"
    assert sol.placements == []
