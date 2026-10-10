"""Cross-check the solver against the independent validator.

The solver and the validator were built separately from requirements.md and
share no code beyond ``chronos.core.domain``. Neither can mark its own work.
These tests are the only place the two meet: a schedule the solver calls
optimal must survive the validator's independent reading of the same rules.

A failure here means the two components disagree about what the rules mean.
That disagreement is the signal worth having - do not silence it by making
one side import the other.
"""

from __future__ import annotations

import pytest

from chronos.core.domain import Severity
from chronos.core.fixtures import (
    infeasible_overbooked,
    lab_consecutive,
    tiny_feasible,
    with_locked,
)
from chronos.solver import solve
from chronos.validator import is_publish_ready, validate

FEASIBLE_CASES = {
    "tiny_feasible": tiny_feasible,
    "lab_consecutive": lab_consecutive,
    "with_locked": with_locked,
}


@pytest.mark.parametrize("name", sorted(FEASIBLE_CASES))
def test_solver_output_passes_independent_validation(name: str) -> None:
    problem = FEASIBLE_CASES[name]()
    solution = solve(problem, time_limit_s=30.0)

    assert solution.status in ("optimal", "feasible"), (
        f"{name}: expected a solution, got {solution.status}: {solution.diagnostics}"
    )
    assert len(solution.placements) == len(problem.sessions)

    findings = validate(problem, solution.placements)
    errors = [f for f in findings if f.severity == Severity.ERROR]

    assert not errors, (
        f"{name}: solver produced a schedule the independent validator rejects. "
        "The two disagree about a rule.\n"
        + "\n".join(f"  {f.rule_id}: {f.message}" for f in errors)
    )
    assert is_publish_ready(findings)


def test_locked_placements_survive_round_trip() -> None:
    """A lock the solver claims to honour must also satisfy the validator."""
    problem = with_locked()
    solution = solve(problem, time_limit_s=30.0)

    by_session = {p.session_id: p for p in solution.placements}
    for locked in problem.locked_placements:
        placed = by_session[locked.session_id]
        assert set(placed.slot_ids) == set(locked.slot_ids)
        assert placed.room_id == locked.room_id
        assert placed.faculty_id == locked.faculty_id

    errors = [
        f for f in validate(problem, solution.placements) if f.severity == Severity.ERROR
    ]
    assert not errors


def test_infeasible_problem_is_refused_with_a_reason() -> None:
    """Infeasibility must come with a diagnosis, not a bare status."""
    solution = solve(infeasible_overbooked(), time_limit_s=30.0)

    assert solution.status == "infeasible"
    assert solution.diagnostics, "infeasible result carried no explanation"
    assert any(
        d.startswith(("PROVEN:", "LIKELY:")) for d in solution.diagnostics
    ), f"diagnostics must state confidence: {solution.diagnostics}"


def test_solver_is_deterministic_and_validation_is_stable() -> None:
    problem = tiny_feasible()
    first = solve(problem, time_limit_s=30.0, seed=0)
    second = solve(problem, time_limit_s=30.0, seed=0)

    assert first.placements == second.placements
    assert validate(problem, first.placements) == validate(problem, second.placements)
