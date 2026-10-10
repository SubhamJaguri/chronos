"""Soft-rule scoring: always WARNING, never ERROR; trigger + clean per rule."""
from __future__ import annotations

from broken_timetables import by_rule, place, problem, rules, session

from chronos.core.domain import Severity
from chronos.validator import rule_ids, validate

# -- W-SUBJECT-CLUSTER --------------------------------------------------------


def test_subject_clustering_same_day():
    prob = problem(
        [session("S1", subject="MATH101"), session("S2", subject="MATH101")]
    )
    placements = [
        place("S1", "D0P0", room="R1", fac="F1"),
        place("S2", "D0P2", room="R1", fac="F1"),
    ]
    findings = validate(prob, placements)
    hits = by_rule(findings, rule_ids.SUBJECT_CLUSTER)
    assert hits, "two MATH101 sessions on Monday for Division 1 must warn"
    assert all(f.severity == Severity.WARNING for f in hits)
    assert "Math" in hits[0].message and "Monday" in hits[0].message
    assert set(hits[0].session_ids) == {"S1", "S2"}


def test_subject_spread_across_days_is_clean():
    prob = problem(
        [session("S1", subject="MATH101"), session("S2", subject="MATH101")]
    )
    placements = [
        place("S1", "D0P0", room="R1", fac="F1"),
        place("S2", "D1P0", room="R1", fac="F1"),
    ]
    assert rule_ids.SUBJECT_CLUSTER not in rules(validate(prob, placements))


def test_single_multi_period_lab_is_not_clustering():
    from chronos.core.domain import ActivityType

    prob = problem(
        [
            session(
                "LAB1",
                activity=ActivityType.LAB,
                groups=("B1",),
                duration=2,
                consecutive=True,
            )
        ]
    )
    findings = validate(prob, [place("LAB1", ("D0P0", "D0P1"), room="R2")])
    assert rule_ids.SUBJECT_CLUSTER not in rules(findings)


# -- W-GROUP-GAPS -------------------------------------------------------------


def test_group_gap_detected():
    prob = problem(
        [
            session("S1", subject="MATH101", groups=("B1",)),
            session("S2", subject="PHY101", groups=("B1",)),
        ]
    )
    placements = [
        place("S1", "D0P0", room="R1", fac="F1"),
        place("S2", "D0P2", room="R1", fac="F2"),  # period 1 idle for Batch 1
    ]
    findings = validate(prob, placements)
    hits = by_rule(findings, rule_ids.GROUP_GAPS)
    assert hits
    assert all(f.severity == Severity.WARNING for f in hits)
    batch1 = [f for f in hits if "Batch 1" in f.message]
    assert len(batch1) == 1
    assert "D0P1" in batch1[0].slot_ids


def test_contiguous_group_day_is_clean():
    prob = problem(
        [
            session("S1", subject="MATH101", groups=("B1",)),
            session("S2", subject="PHY101", groups=("B1",)),
        ]
    )
    placements = [
        place("S1", "D0P0", room="R1", fac="F1"),
        place("S2", "D0P1", room="R1", fac="F2"),
    ]
    assert rule_ids.GROUP_GAPS not in rules(validate(prob, placements))


def test_break_period_is_not_a_gap():
    prob = problem(
        [
            session("S1", subject="MATH101", groups=("B1",)),
            session("S2", subject="PHY101", groups=("B1",)),
        ]
    )
    placements = [
        place("S1", "D0P2", room="R1", fac="F1"),
        place("S2", "D0P4", room="R1", fac="F2"),  # only the break sits between
    ]
    assert rule_ids.GROUP_GAPS not in rules(validate(prob, placements))


def test_gap_counts_sessions_inherited_from_parent_division():
    """A batch attends its division's lectures: DIV1 at P0 plus B1 at P2
    leaves Batch 1 idle at P1."""
    prob = problem(
        [
            session("S1", subject="MATH101", groups=("DIV1",)),
            session("S2", subject="PHY101", groups=("B1",)),
        ]
    )
    placements = [
        place("S1", "D0P0", room="R1", fac="F1"),
        place("S2", "D0P2", room="R1", fac="F2"),
    ]
    hits = by_rule(validate(prob, placements), rule_ids.GROUP_GAPS)
    assert any("Batch 1" in f.message for f in hits)


# -- W-FACULTY-GAPS -----------------------------------------------------------


def test_faculty_gap_detected():
    prob = problem(
        [
            session("S1", subject="MATH101", groups=("DIV1",)),
            session("S2", subject="PHY101", groups=("DIV2",)),
        ]
    )
    placements = [
        place("S1", "D0P0", room="R1", fac="F2"),
        place("S2", "D0P2", room="R1", fac="F2"),  # Dr. Iyer idle at period 1
    ]
    findings = validate(prob, placements)
    hits = by_rule(findings, rule_ids.FACULTY_GAPS)
    assert len(hits) == 1
    assert hits[0].severity == Severity.WARNING
    assert "Dr. Iyer" in hits[0].message
    assert "D0P1" in hits[0].slot_ids


def test_contiguous_faculty_day_is_clean():
    prob = problem(
        [
            session("S1", subject="MATH101", groups=("DIV1",)),
            session("S2", subject="PHY101", groups=("DIV2",)),
        ]
    )
    placements = [
        place("S1", "D0P0", room="R1", fac="F2"),
        place("S2", "D0P1", room="R1", fac="F2"),
    ]
    assert rule_ids.FACULTY_GAPS not in rules(validate(prob, placements))


# -- W-WORKLOAD-IMBALANCE -----------------------------------------------------


def test_faculty_workload_imbalance_across_days():
    sessions = [session(f"S{i}", subject=f"SUB{i}") for i in range(5)]
    prob = problem(sessions)
    placements = [
        place("S0", "D0P0", fac="F2"),
        place("S1", "D0P1", fac="F2"),
        place("S2", "D0P2", fac="F2"),
        place("S3", "D0P4", fac="F2"),  # 4 periods on Monday
        place("S4", "D1P0", fac="F2"),  # 1 period on Tuesday
    ]
    findings = validate(prob, placements)
    hits = by_rule(findings, rule_ids.WORKLOAD_IMBALANCE)
    assert len(hits) == 1
    assert hits[0].severity == Severity.WARNING
    assert "Dr. Iyer" in hits[0].message
    assert "Monday" in hits[0].message and "Tuesday" in hits[0].message


def test_balanced_workload_is_clean():
    sessions = [session(f"S{i}", subject=f"SUB{i}") for i in range(4)]
    prob = problem(sessions)
    placements = [
        place("S0", "D0P0", fac="F2"),
        place("S1", "D0P1", fac="F2"),
        place("S2", "D1P0", fac="F2"),
        place("S3", "D1P1", fac="F2"),
    ]
    assert rule_ids.WORKLOAD_IMBALANCE not in rules(validate(prob, placements))


# -- global severity invariant -------------------------------------------------


def test_soft_rules_are_never_errors_and_hard_rules_never_warnings():
    """On a timetable violating both kinds of rule at once, every W-* finding
    is a WARNING and every H-* finding is an ERROR."""
    prob = problem(
        [
            session("S1", subject="MATH101"),
            session("S2", subject="MATH101"),
            session("S3", subject="PHY101", groups=("DIV2",)),
        ]
    )
    placements = [
        place("S1", "D0P0", room="R1", fac="F1"),
        place("S2", "D0P2", room="R1", fac="F1"),  # clustering + gaps
        place("S3", "D0P3", room="R4", fac="F2"),  # break placement (hard)
    ]
    findings = validate(prob, placements)
    assert any(f.rule_id.startswith("W-") for f in findings)
    assert any(f.rule_id.startswith("H-") for f in findings)
    for f in findings:
        if f.rule_id.startswith("W-"):
            assert f.severity == Severity.WARNING, f.rule_id
        else:
            assert f.severity == Severity.ERROR, f.rule_id
