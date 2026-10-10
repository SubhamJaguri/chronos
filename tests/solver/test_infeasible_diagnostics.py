"""Infeasible problems must come back with concrete, honest diagnostics."""

from __future__ import annotations

from util import fac, grp, make_grid, room, ses

from chronos.core.domain import ActivityType, Problem
from chronos.core.fixtures import infeasible_overbooked
from chronos.solver import solve


def _problem(**overrides) -> Problem:
    base = dict(
        slots=make_grid(days=1, periods=4),
        rooms=[room("r1"), room("r2")],
        faculty=[fac("f1"), fac("f2")],
        groups=[grp("g1"), grp("g2"), grp("g3")],
        sessions=[],
    )
    base.update(overrides)
    return Problem(**base)


def test_overbooked_fixture_is_proven_infeasible():
    sol = solve(infeasible_overbooked())
    assert sol.status == "infeasible"
    assert any("PROVEN" in d and "grp-g1" in d for d in sol.diagnostics)


def test_session_with_no_eligible_room_is_named():
    problem = _problem(sessions=[ses("s1", {"g1"}, {"f1"}, set())])
    sol = solve(problem)
    assert sol.status == "infeasible"
    assert any("PROVEN" in d and "'s1'" in d and "room" in d for d in sol.diagnostics)


def test_session_with_no_eligible_faculty_is_named():
    problem = _problem(sessions=[ses("s1", {"g1"}, set(), {"r1"})])
    sol = solve(problem)
    assert sol.status == "infeasible"
    assert any("PROVEN" in d and "'s1'" in d and "faculty" in d for d in sol.diagnostics)


def test_capacity_shortfall_is_diagnosed_with_numbers():
    problem = _problem(
        rooms=[room("r1", capacity=40)],
        groups=[grp("g1", strength=100)],
        sessions=[ses("s1", {"g1"}, {"f1"}, {"r1"})],
    )
    sol = solve(problem)
    assert sol.status == "infeasible"
    assert any("PROVEN" in d and "100" in d and "40" in d for d in sol.diagnostics)


def test_lab_without_any_lab_room_is_diagnosed():
    problem = _problem(
        rooms=[room("r1", room_type="classroom")],
        sessions=[ses("s1", {"g1"}, {"f1"}, {"r1"}, activity=ActivityType.LAB)],
    )
    sol = solve(problem)
    assert sol.status == "infeasible"
    assert any("PROVEN" in d and "room_type 'lab'" in d for d in sol.diagnostics)


def test_two_fixed_sessions_colliding_is_proven():
    problem = _problem(
        sessions=[
            ses("s1", {"g1"}, {"f1"}, {"r1"}, fixed_slot_id="d0p0", fixed_room_id="r1"),
            ses("s2", {"g2"}, {"f2"}, {"r1"}, fixed_slot_id="d0p0", fixed_room_id="r1"),
        ]
    )
    sol = solve(problem)
    assert sol.status == "infeasible"
    assert any(
        "PROVEN" in d and "'s1'" in d and "'s2'" in d and "room 'r1'" in d
        for d in sol.diagnostics
    )


def test_two_fixed_sessions_same_group_collision_is_proven():
    problem = _problem(
        sessions=[
            ses("s1", {"g1"}, {"f1"}, {"r1"}, fixed_slot_id="d0p1"),
            ses("s2", {"g1"}, {"f2"}, {"r2"}, fixed_slot_id="d0p1"),
        ]
    )
    sol = solve(problem)
    assert sol.status == "infeasible"
    assert any("PROVEN" in d and "student group" in d for d in sol.diagnostics)


def test_sole_faculty_with_insufficient_availability_is_diagnosed():
    problem = _problem(
        faculty=[fac("f1", unavailable_slots=frozenset({"d0p0", "d0p1", "d0p2"}))],
        sessions=[
            ses("s1", {"g1"}, {"f1"}, {"r1", "r2"}),
            ses("s2", {"g2"}, {"f1"}, {"r1", "r2"}),
        ],
    )
    sol = solve(problem)
    assert sol.status == "infeasible"
    assert any("PROVEN" in d and "'f1'" in d for d in sol.diagnostics)


def test_assumption_analysis_narrows_interaction_infeasibility():
    """Three sessions, one slot, two shared faculty: no single-resource count
    fails, so the pre-checks pass and CP-SAT proves infeasibility; the
    assumption core must then name the interacting sessions with the
    PROVEN-set / LIKELY-individual distinction."""
    problem = _problem(
        slots=make_grid(days=1, periods=1),
        rooms=[room("r1"), room("r2"), room("r3")],
        sessions=[
            ses("s1", {"g1"}, {"f1", "f2"}, {"r1", "r2", "r3"}),
            ses("s2", {"g2"}, {"f1", "f2"}, {"r1", "r2", "r3"}),
            ses("s3", {"g3"}, {"f1", "f2"}, {"r1", "r2", "r3"}),
        ],
    )
    sol = solve(problem)
    assert sol.status == "infeasible"
    joined = "\n".join(sol.diagnostics)
    assert "assumption" in joined
    assert "PROVEN" in joined
    assert "LIKELY" in joined
    assert any(f"'s{i}'" in joined for i in (1, 2, 3))


def test_proven_and_likely_wording_is_explicit():
    """Every infeasibility diagnostic must declare its certainty level."""
    sol = solve(infeasible_overbooked())
    assert sol.status == "infeasible"
    assert all(("PROVEN" in d or "LIKELY" in d or d.startswith(("WARNING", "NOTE")))
               for d in sol.diagnostics)
