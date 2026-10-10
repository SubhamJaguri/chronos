"""Multi-period and consecutive-lab placement rules."""

from __future__ import annotations

from util import assert_valid, fac, grp, make_grid, room, ses

from chronos.core.domain import ActivityType, Problem
from chronos.solver import solve


def _lab(sid: str = "lab1", duration: int = 2, consecutive: bool = True):
    return ses(
        sid,
        {"g1"},
        {"f1"},
        {"labroom"},
        activity=ActivityType.LAB,
        duration_periods=duration,
        requires_consecutive=consecutive,
    )


def _problem(slots, sessions) -> Problem:
    return Problem(
        slots=slots,
        rooms=[room("labroom", capacity=40, room_type="lab")],
        faculty=[fac("f1")],
        groups=[grp("g1")],
        sessions=sessions,
    )


def test_consecutive_lab_avoids_the_break_window():
    """Periods 0,1 | break at 2 | 3,4,5: a 3-period lab fits only after the break."""
    problem = _problem(make_grid(days=1, periods=6, breaks=(2,)), [_lab(duration=3)])
    sol = solve(problem)
    assert sol.status == "optimal"
    assert_valid(problem, sol)
    assert sol.placements[0].slot_ids == ("d0p3", "d0p4", "d0p5")


def test_consecutive_lab_never_wraps_across_days():
    """One period at the end of day 0 plus one at the start of day 1 is not a run."""
    slots = [s for s in make_grid(days=2, periods=2) if s.id not in ("d0p0", "d1p1")]
    problem = _problem(slots, [_lab(duration=2)])
    sol = solve(problem)
    assert sol.status == "infeasible"
    assert any("consecutive" in d and "PROVEN" in d for d in sol.diagnostics)


def test_consecutive_lab_longer_than_any_window_is_diagnosed():
    problem = _problem(make_grid(days=2, periods=6, breaks=(3,)), [_lab(duration=4)])
    sol = solve(problem)
    assert sol.status == "infeasible"
    assert any(
        "PROVEN" in d and "contiguous run of 4 teaching periods" in d
        for d in sol.diagnostics
    )


def test_non_consecutive_multiperiod_may_straddle_a_break():
    """Teaching periods 1 and 3 around a break: fine without requires_consecutive..."""
    slots = make_grid(days=1, periods=4, breaks=(0, 2))
    problem = _problem(slots, [_lab(duration=2, consecutive=False)])
    sol = solve(problem)
    assert sol.status == "optimal"
    assert_valid(problem, sol)
    assert sol.placements[0].slot_ids == ("d0p1", "d0p3")


def test_consecutive_multiperiod_may_not_straddle_a_break():
    """...but with requires_consecutive the same layout is proven infeasible."""
    slots = make_grid(days=1, periods=4, breaks=(0, 2))
    problem = _problem(slots, [_lab(duration=2, consecutive=True)])
    sol = solve(problem)
    assert sol.status == "infeasible"
    assert any("PROVEN" in d and "consecutive" in d for d in sol.diagnostics)


def test_fixed_start_consecutive_lab_takes_the_exact_run():
    problem = _problem(
        make_grid(days=1, periods=6, breaks=(2,)),
        [
            ses(
                "lab",
                {"g1"},
                {"f1"},
                {"labroom"},
                activity=ActivityType.LAB,
                duration_periods=2,
                requires_consecutive=True,
                fixed_slot_id="d0p3",
            )
        ],
    )
    sol = solve(problem)
    assert sol.status == "optimal"
    assert_valid(problem, sol)
    assert sol.placements[0].slot_ids == ("d0p3", "d0p4")


def test_fixed_start_that_would_cross_a_break_is_proven_infeasible():
    """Fixed to p1 with a break at p2: the 2-period consecutive run cannot exist."""
    problem = _problem(
        make_grid(days=1, periods=6, breaks=(2,)),
        [
            ses(
                "lab",
                {"g1"},
                {"f1"},
                {"labroom"},
                activity=ActivityType.LAB,
                duration_periods=2,
                requires_consecutive=True,
                fixed_slot_id="d0p1",
            )
        ],
    )
    sol = solve(problem)
    assert sol.status == "infeasible"
    assert any("PROVEN" in d and "d0p1" in d for d in sol.diagnostics)
