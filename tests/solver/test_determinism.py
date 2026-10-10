"""Same input must always yield the same output (fixed seed, one worker)."""

from __future__ import annotations

from util import assert_valid, fac, grp, make_grid, room, ses

from chronos.core.domain import Problem
from chronos.core.fixtures import tiny_feasible
from chronos.solver import solve


def _symmetric_problem() -> Problem:
    """Highly symmetric: many interchangeable rooms/faculty/slots, so any
    nondeterminism in the search would almost certainly surface."""
    return Problem(
        slots=make_grid(days=3, periods=5),
        rooms=[room(f"r{i}") for i in range(4)],
        faculty=[fac(f"f{i}") for i in range(4)],
        groups=[grp("g1"), grp("g2")],
        sessions=[
            ses(f"s{i}", {"g1" if i % 2 else "g2"},
                {"f0", "f1", "f2", "f3"}, {"r0", "r1", "r2", "r3"},
                subject=f"sub-{i % 3}")
            for i in range(8)
        ],
    )


def test_same_input_twice_identical_output():
    a = solve(tiny_feasible(), time_limit_s=20, seed=0)
    b = solve(tiny_feasible(), time_limit_s=20, seed=0)
    assert a.status == b.status
    assert a.placements == b.placements
    assert a.diagnostics == b.diagnostics


def test_symmetric_problem_is_reproducible():
    a = solve(_symmetric_problem(), time_limit_s=30, seed=7)
    b = solve(_symmetric_problem(), time_limit_s=30, seed=7)
    assert a.status == b.status == "optimal"
    assert_valid(_symmetric_problem(), a)
    assert a.placements == b.placements


def test_infeasible_diagnostics_are_reproducible():
    from chronos.core.fixtures import infeasible_overbooked

    a = solve(infeasible_overbooked(), seed=3)
    b = solve(infeasible_overbooked(), seed=3)
    assert a.status == b.status == "infeasible"
    assert a.diagnostics == b.diagnostics
