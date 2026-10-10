"""One test (or more) per hard constraint from requirements.md section 8."""

from __future__ import annotations

from util import assert_valid, fac, grp, make_grid, room, ses

from chronos.core.domain import ActivityType, Problem
from chronos.solver import solve


def _problem(**overrides) -> Problem:
    base = dict(
        slots=make_grid(days=1, periods=4),
        rooms=[room("r1"), room("r2")],
        faculty=[fac("f1"), fac("f2")],
        groups=[grp("g1"), grp("g2")],
        sessions=[],
    )
    base.update(overrides)
    return Problem(**base)


# --- faculty overlap -------------------------------------------------------


def test_faculty_never_double_booked():
    problem = _problem(
        sessions=[
            ses("s1", {"g1"}, {"f1"}, {"r1", "r2"}),
            ses("s2", {"g2"}, {"f1"}, {"r1", "r2"}),
        ]
    )
    sol = solve(problem)
    assert_valid(problem, sol)
    a, b = sol.placements
    assert set(a.slot_ids).isdisjoint(b.slot_ids)


# --- group overlap, including the parent/child hierarchy -------------------


def test_group_never_double_booked():
    problem = _problem(
        sessions=[
            ses("s1", {"g1"}, {"f1"}, {"r1"}),
            ses("s2", {"g1"}, {"f2"}, {"r2"}),
        ]
    )
    sol = solve(problem)
    assert_valid(problem, sol)
    a, b = sol.placements
    assert set(a.slot_ids).isdisjoint(b.slot_ids)


def test_parent_division_conflicts_with_child_batch():
    problem = _problem(
        groups=[grp("div", strength=60), grp("batch1", strength=30, parent_id="div")],
        sessions=[
            ses("for-div", {"div"}, {"f1"}, {"r1"}),
            ses("for-batch", {"batch1"}, {"f2"}, {"r2"}),
        ],
    )
    sol = solve(problem)
    assert_valid(problem, sol)
    a, b = sol.placements
    assert set(a.slot_ids).isdisjoint(b.slot_ids), "parent and child batch overlapped"


def test_grandparent_conflicts_through_parent_chain():
    """parent_id chains are resolved transitively, not just one level."""
    problem = _problem(
        groups=[
            grp("div", strength=60),
            grp("half", strength=30, parent_id="div"),
            grp("batch", strength=15, parent_id="half"),
        ],
        sessions=[
            ses("for-div", {"div"}, {"f1"}, {"r1"}),
            ses("for-batch", {"batch"}, {"f2"}, {"r2"}),
        ],
    )
    sol = solve(problem)
    assert_valid(problem, sol)
    a, b = sol.placements
    assert set(a.slot_ids).isdisjoint(b.slot_ids)


def test_sibling_batches_may_share_a_slot():
    """Siblings do not conflict: both labs fit into the single teaching slot."""
    problem = _problem(
        slots=make_grid(days=1, periods=1),
        groups=[
            grp("div", strength=60),
            grp("b1", strength=30, parent_id="div"),
            grp("b2", strength=30, parent_id="div"),
        ],
        sessions=[
            ses("s1", {"b1"}, {"f1"}, {"r1"}),
            ses("s2", {"b2"}, {"f2"}, {"r2"}),
        ],
    )
    sol = solve(problem)
    assert sol.status == "optimal"
    assert_valid(problem, sol)


# --- room constraints ------------------------------------------------------


def test_room_never_double_booked():
    problem = _problem(
        rooms=[room("r1")],
        sessions=[
            ses("s1", {"g1"}, {"f1"}, {"r1"}),
            ses("s2", {"g2"}, {"f2"}, {"r1"}),
        ],
    )
    sol = solve(problem)
    assert_valid(problem, sol)
    a, b = sol.placements
    assert set(a.slot_ids).isdisjoint(b.slot_ids)


def test_room_capacity_must_cover_combined_group_strength():
    """A shared lecture for two groups only fits the large hall."""
    problem = _problem(
        rooms=[room("small", capacity=40), room("hall", capacity=100)],
        groups=[grp("g1", strength=35), grp("g2", strength=35)],
        sessions=[ses("shared", {"g1", "g2"}, {"f1"}, {"small", "hall"})],
    )
    sol = solve(problem)
    assert_valid(problem, sol)
    assert sol.placements[0].room_id == "hall"


def test_nested_groups_strength_not_double_counted():
    """A session listing a division and its own batch needs only the division size."""
    problem = _problem(
        rooms=[room("hall", capacity=60)],
        groups=[grp("div", strength=60), grp("b1", strength=30, parent_id="div")],
        sessions=[ses("s1", {"div", "b1"}, {"f1"}, {"hall"})],
    )
    sol = solve(problem)
    assert sol.status == "optimal"  # 60 + 30 would overflow the hall; 60 fits
    assert_valid(problem, sol)


def test_lab_requires_lab_room_type():
    problem = _problem(
        rooms=[room("r1", room_type="classroom"), room("lab1", room_type="lab")],
        sessions=[ses("s1", {"g1"}, {"f1"}, {"r1", "lab1"}, activity=ActivityType.LAB)],
    )
    sol = solve(problem)
    assert_valid(problem, sol)
    assert sol.placements[0].room_id == "lab1"


# --- availability ----------------------------------------------------------


def test_faculty_unavailable_slots_respected():
    problem = _problem(
        faculty=[fac("f1", unavailable_slots=frozenset({"d0p0", "d0p1", "d0p2"}))],
        sessions=[ses("s1", {"g1"}, {"f1"}, {"r1"})],
    )
    sol = solve(problem)
    assert_valid(problem, sol)
    assert sol.placements[0].slot_ids == ("d0p3",)


def test_room_unavailable_slots_respected():
    problem = _problem(
        rooms=[room("r1", unavailable_slots=frozenset({"d0p0", "d0p1", "d0p3"}))],
        sessions=[ses("s1", {"g1"}, {"f1"}, {"r1"})],
    )
    sol = solve(problem)
    assert_valid(problem, sol)
    assert sol.placements[0].slot_ids == ("d0p2",)


# --- breaks ----------------------------------------------------------------


def test_break_slots_never_used_even_under_pressure():
    """Demand exactly fills the non-break periods; the break must stay empty."""
    problem = _problem(
        slots=make_grid(days=1, periods=4, breaks=(2,)),
        sessions=[
            ses("s1", {"g1"}, {"f1", "f2"}, {"r1", "r2"}),
            ses("s2", {"g1"}, {"f1", "f2"}, {"r1", "r2"}),
            ses("s3", {"g1"}, {"f1", "f2"}, {"r1", "r2"}),
        ],
    )
    sol = solve(problem)
    assert sol.status == "optimal"
    assert_valid(problem, sol)
    used = {s for p in sol.placements for s in p.slot_ids}
    assert used == {"d0p0", "d0p1", "d0p3"}


def test_one_session_too_many_for_non_break_slots_is_infeasible():
    problem = _problem(
        slots=make_grid(days=1, periods=4, breaks=(2,)),
        sessions=[
            ses(f"s{i}", {"g1"}, {"f1", "f2"}, {"r1", "r2"}) for i in range(4)
        ],
    )
    sol = solve(problem)
    assert sol.status == "infeasible"
    assert any("3 teaching periods" in d for d in sol.diagnostics)


# --- fixed assignments -----------------------------------------------------


def test_fixed_slot_room_and_faculty_honoured_exactly():
    problem = _problem(
        sessions=[
            ses(
                "pinned",
                {"g1"},
                {"f1", "f2"},
                {"r1", "r2"},
                fixed_slot_id="d0p2",
                fixed_room_id="r2",
                fixed_faculty_id="f2",
            ),
            ses("free", {"g1"}, {"f1", "f2"}, {"r1", "r2"}),
        ]
    )
    sol = solve(problem)
    assert_valid(problem, sol)
    pinned = next(p for p in sol.placements if p.session_id == "pinned")
    assert pinned.slot_ids == ("d0p2",)
    assert pinned.room_id == "r2"
    assert pinned.faculty_id == "f2"


# --- faculty daily cap -----------------------------------------------------


def test_max_periods_per_day_enforced():
    problem = _problem(
        slots=make_grid(days=2, periods=3),
        faculty=[fac("f1", max_periods_per_day=2)],
        groups=[grp(f"g{i}") for i in range(1, 5)],
        sessions=[ses(f"s{i}", {f"g{i}"}, {"f1"}, {"r1", "r2"}) for i in range(1, 5)],
    )
    sol = solve(problem)
    assert_valid(problem, sol)  # util re-checks the per-day cap independently
    per_day: dict[int, int] = {}
    for p in sol.placements:
        day = int(p.slot_ids[0][1])
        per_day[day] = per_day.get(day, 0) + len(p.slot_ids)
    assert all(v <= 2 for v in per_day.values())


def test_max_periods_per_day_can_prove_infeasibility():
    problem = _problem(
        slots=make_grid(days=1, periods=4),
        faculty=[fac("f1", max_periods_per_day=2)],
        groups=[grp(f"g{i}") for i in range(1, 4)],
        sessions=[ses(f"s{i}", {f"g{i}"}, {"f1"}, {"r1", "r2"}) for i in range(1, 4)],
    )
    sol = solve(problem)
    assert sol.status == "infeasible"
    assert any("per-day limit" in d or "at most" in d for d in sol.diagnostics)
