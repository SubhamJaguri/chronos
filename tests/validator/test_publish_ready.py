"""is_publish_ready: warnings never block publication, a single ERROR does."""
from __future__ import annotations

from broken_timetables import place, problem, session

from chronos.core.domain import ActivityType, Severity
from chronos.validator import is_publish_ready, validate


def test_warnings_only_is_publish_ready():
    """A timetable whose only findings are soft-rule WARNINGs may be published."""
    prob = problem(
        [session("S1", subject="MATH101"), session("S2", subject="MATH101")]
    )
    placements = [
        place("S1", "D0P0", room="R1", fac="F1"),
        place("S2", "D0P1", room="R1", fac="F1"),  # same subject, same day: cluster
    ]
    findings = validate(prob, placements)
    assert findings, "scenario must produce at least one finding"
    assert all(f.severity == Severity.WARNING for f in findings)
    assert is_publish_ready(findings) is True


def test_single_error_blocks_publication():
    prob = problem([session("S1")])
    findings = validate(prob, [place("S1", "D0P3")])  # on the break slot
    errors = [f for f in findings if f.severity == Severity.ERROR]
    assert len(errors) == 1
    assert is_publish_ready(findings) is False


def test_no_findings_is_publish_ready():
    assert is_publish_ready([]) is True


def test_fully_clean_timetable_has_no_findings_and_is_publish_ready():
    """A sensible little timetable triggers nothing at all."""
    prob = problem(
        [
            session("LEC1", subject="MATH101", groups=("DIV1",)),
            session(
                "LAB1",
                subject="PHY101",
                activity=ActivityType.LAB,
                groups=("B1",),
                duration=2,
                consecutive=True,
            ),
            session("LEC2", subject="CHEM101", groups=("DIV2",)),
        ]
    )
    placements = [
        place("LEC1", "D0P0", room="R1", fac="F1"),
        place("LAB1", ("D0P1", "D0P2"), room="R2", fac="F2"),
        place("LEC2", "D0P1", room="R1", fac="F4"),
    ]
    findings = validate(prob, placements)
    assert findings == []
    assert is_publish_ready(findings) is True
