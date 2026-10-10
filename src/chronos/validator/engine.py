"""Validator entry points (requirements.md section 9).

``validate`` checks final placements against the canonical problem data and
returns structured findings; ``is_publish_ready`` enforces the rule that a
schedule with unresolved hard-constraint violations must never be
publish-ready.
"""
from __future__ import annotations

from chronos.core.domain import Finding, Placement, Problem, Severity
from chronos.validator import hard, soft
from chronos.validator.context import ValidationContext


def validate(problem: Problem, placements: list[Placement]) -> list[Finding]:
    """Independently validate ``placements`` against ``problem``.

    Returns every finding: hard-constraint violations as ERROR, soft-rule
    observations as WARNING.  An empty list means a fully clean timetable.
    """
    ctx = ValidationContext(problem, placements)
    findings: list[Finding] = []
    for check in hard.ALL_CHECKS:
        findings.extend(check(ctx))
    for check in soft.ALL_CHECKS:
        findings.extend(check(ctx))
    return findings


def is_publish_ready(findings: list[Finding]) -> bool:
    """False if any finding is a hard-constraint violation (severity ERROR).

    Warnings (soft rules) alone never block publication.
    """
    return all(f.severity != Severity.ERROR for f in findings)
