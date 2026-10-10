"""One triggering and one clean case for every hard rule (severity ERROR)."""
from __future__ import annotations

from broken_timetables import by_rule, place, problem, rules, session

from chronos.core.domain import ActivityType, Severity
from chronos.validator import rule_ids, validate

# -- H-FACULTY-CLASH ----------------------------------------------------------


def test_faculty_clash_detected():
    prob = problem([session("S1", groups=("DIV1",)), session("S2", groups=("DIV2",))])
    placements = [
        place("S1", "D0P0", room="R1", fac="F2"),
        place("S2", "D0P0", room="R4", fac="F2"),
    ]
    findings = validate(prob, placements)
    hits = by_rule(findings, rule_ids.FACULTY_CLASH)
    assert len(hits) == 1
    f = hits[0]
    assert f.severity == Severity.ERROR
    assert set(f.session_ids) == {"S1", "S2"}
    assert f.slot_ids == ("D0P0",)
    assert "Dr. Iyer" in f.message  # names the actual faculty member
    assert "Suggested" in f.message


def test_no_faculty_clash_when_slots_differ():
    prob = problem([session("S1", groups=("DIV1",)), session("S2", groups=("DIV2",))])
    placements = [
        place("S1", "D0P0", room="R1", fac="F2"),
        place("S2", "D0P1", room="R1", fac="F2"),
    ]
    assert rule_ids.FACULTY_CLASH not in rules(validate(prob, placements))


# -- H-GROUP-CLASH ------------------------------------------------------------


def test_group_clash_same_group():
    prob = problem(
        [session("S1", groups=("DIV1",)), session("S2", subject="PHY101", groups=("DIV1",))]
    )
    placements = [
        place("S1", "D0P0", room="R1", fac="F1"),
        place("S2", "D0P0", room="R4", fac="F2"),
    ]
    hits = by_rule(validate(prob, placements), rule_ids.GROUP_CLASH)
    assert len(hits) == 1
    assert hits[0].severity == Severity.ERROR
    assert set(hits[0].session_ids) == {"S1", "S2"}
    assert "Division 1" in hits[0].message


def test_group_clash_division_vs_its_own_batch():
    """A division lecture clashes with a lab of one of its own batches."""
    prob = problem(
        [
            session("LEC", groups=("DIV1",)),
            session("LAB", subject="PHY101", activity=ActivityType.LAB, groups=("B1",)),
        ]
    )
    placements = [
        place("LEC", "D0P0", room="R1", fac="F1"),
        place("LAB", "D0P0", room="R2", fac="F2"),
    ]
    hits = by_rule(validate(prob, placements), rule_ids.GROUP_CLASH)
    assert len(hits) == 1
    assert set(hits[0].session_ids) == {"LAB", "LEC"}
    assert "Batch 1" in hits[0].message and "Division 1" in hits[0].message


def test_sibling_batches_may_run_in_parallel():
    """Two batches of the same division are disjoint students: no clash."""
    prob = problem(
        [
            session("LAB1", activity=ActivityType.LAB, groups=("B1",)),
            session("LAB2", subject="PHY101", activity=ActivityType.LAB, groups=("B2",)),
        ]
    )
    placements = [
        place("LAB1", "D0P0", room="R2", fac="F1"),
        place("LAB2", "D0P0", room="R4", fac="F2"),
    ]
    assert rule_ids.GROUP_CLASH not in rules(validate(prob, placements))


# -- H-ROOM-CLASH -------------------------------------------------------------


def test_room_clash_detected():
    prob = problem([session("S1", groups=("DIV1",)), session("S2", groups=("DIV2",))])
    placements = [
        place("S1", "D0P0", room="R1", fac="F1"),
        place("S2", "D0P0", room="R1", fac="F2"),
    ]
    hits = by_rule(validate(prob, placements), rule_ids.ROOM_CLASH)
    assert len(hits) == 1
    assert hits[0].severity == Severity.ERROR
    assert set(hits[0].session_ids) == {"S1", "S2"}
    assert "Main Hall" in hits[0].message


def test_no_room_clash_when_rooms_differ():
    prob = problem([session("S1", groups=("DIV1",)), session("S2", groups=("DIV2",))])
    placements = [
        place("S1", "D0P0", room="R1", fac="F1"),
        place("S2", "D0P0", room="R4", fac="F2"),
    ]
    assert rule_ids.ROOM_CLASH not in rules(validate(prob, placements))


# -- H-FACULTY-UNAVAILABLE ----------------------------------------------------


def test_faculty_unavailability_violation():
    prob = problem([session("S1")])
    findings = validate(prob, [place("S1", "D0P1", fac="F3")])  # F3 unavailable at D0P1
    hits = by_rule(findings, rule_ids.FACULTY_UNAVAILABLE)
    assert len(hits) == 1
    assert hits[0].severity == Severity.ERROR
    assert "Dr. Mehta" in hits[0].message
    assert hits[0].slot_ids == ("D0P1",)


def test_faculty_available_slot_is_clean():
    prob = problem([session("S1")])
    findings = validate(prob, [place("S1", "D0P0", fac="F3")])
    assert rule_ids.FACULTY_UNAVAILABLE not in rules(findings)


# -- H-ROOM-UNAVAILABLE -------------------------------------------------------


def test_room_unavailability_violation():
    prob = problem([session("S1", groups=("ELEC1",))])
    findings = validate(prob, [place("S1", "D0P2", room="R3")])  # R3 unavailable at D0P2
    hits = by_rule(findings, rule_ids.ROOM_UNAVAILABLE)
    assert len(hits) == 1
    assert "Seminar Room" in hits[0].message
    assert hits[0].slot_ids == ("D0P2",)


def test_room_available_slot_is_clean():
    prob = problem([session("S1", groups=("ELEC1",))])
    findings = validate(prob, [place("S1", "D0P0", room="R3")])
    assert rule_ids.ROOM_UNAVAILABLE not in rules(findings)


# -- H-ROOM-TYPE --------------------------------------------------------------


def test_lab_in_classroom_is_unsuitable():
    prob = problem([session("LAB1", activity=ActivityType.LAB, groups=("B1",))])
    findings = validate(prob, [place("LAB1", "D0P0", room="R1")])
    hits = by_rule(findings, rule_ids.ROOM_TYPE_UNSUITABLE)
    assert len(hits) == 1
    assert hits[0].severity == Severity.ERROR
    assert "Main Hall" in hits[0].message and "'lab'" in hits[0].message


def test_lab_in_lab_room_is_suitable():
    prob = problem([session("LAB1", activity=ActivityType.LAB, groups=("B1",))])
    findings = validate(prob, [place("LAB1", "D0P0", room="R2")])
    assert rule_ids.ROOM_TYPE_UNSUITABLE not in rules(findings)


def test_lecture_in_classroom_is_suitable():
    prob = problem([session("S1")])
    findings = validate(prob, [place("S1", "D0P0", room="R1")])
    assert rule_ids.ROOM_TYPE_UNSUITABLE not in rules(findings)


# -- H-ROOM-CAPACITY ----------------------------------------------------------


def test_capacity_exceeded_by_single_group():
    prob = problem([session("S1", groups=("DIV1",))])  # 60 students
    findings = validate(prob, [place("S1", "D0P0", room="R3")])  # capacity 25
    hits = by_rule(findings, rule_ids.ROOM_CAPACITY)
    assert len(hits) == 1
    assert "60" in hits[0].message and "25" in hits[0].message
    assert "Seminar Room" in hits[0].message


def test_capacity_exceeded_by_combined_groups():
    prob = problem([session("S1", groups=("B1", "B2"))])  # 30 + 30 = 60
    findings = validate(prob, [place("S1", "D0P0", room="R3")])
    assert rule_ids.ROOM_CAPACITY in rules(findings)


def test_capacity_does_not_double_count_batch_inside_its_division():
    """DIV1 (60) already contains B1 (30): combined strength is 60, not 90,
    so Main Hall (70) fits and no capacity finding may fire."""
    prob = problem([session("S1", groups=("DIV1", "B1"))])
    findings = validate(prob, [place("S1", "D0P0", room="R1")])
    assert rule_ids.ROOM_CAPACITY not in rules(findings)


def test_capacity_sufficient_is_clean():
    prob = problem([session("S1", groups=("DIV1",))])
    findings = validate(prob, [place("S1", "D0P0", room="R1")])  # 60 <= 70
    assert rule_ids.ROOM_CAPACITY not in rules(findings)


# -- H-SESSION-MISSING / H-SESSION-DUPLICATE ----------------------------------


def test_missing_required_session():
    prob = problem([session("S1"), session("S2", groups=("DIV2",))])
    findings = validate(prob, [place("S1", "D0P0")])
    hits = by_rule(findings, rule_ids.SESSION_MISSING)
    assert len(hits) == 1
    assert hits[0].session_ids == ("S2",)
    assert hits[0].severity == Severity.ERROR


def test_duplicate_session_placement():
    prob = problem([session("S1")])
    findings = validate(prob, [place("S1", "D0P0"), place("S1", "D0P1")])
    hits = by_rule(findings, rule_ids.SESSION_DUPLICATE)
    assert len(hits) == 1
    assert hits[0].session_ids == ("S1",)
    assert "2 times" in hits[0].message


def test_exact_coverage_is_clean():
    prob = problem([session("S1"), session("S2", groups=("DIV2",))])
    findings = validate(prob, [place("S1", "D0P0"), place("S2", "D0P1")])
    found = rules(findings)
    assert rule_ids.SESSION_MISSING not in found
    assert rule_ids.SESSION_DUPLICATE not in found


# -- H-DURATION-MISMATCH ------------------------------------------------------


def test_duration_too_short():
    prob = problem([session("LAB1", activity=ActivityType.LAB, groups=("B1",), duration=2)])
    findings = validate(prob, [place("LAB1", "D0P0", room="R2")])
    hits = by_rule(findings, rule_ids.DURATION_MISMATCH)
    assert len(hits) == 1
    assert "2 period(s)" in hits[0].message and "1 slot(s)" in hits[0].message


def test_duration_duplicate_slot_is_mismatch():
    prob = problem([session("LAB1", activity=ActivityType.LAB, groups=("B1",), duration=2)])
    findings = validate(prob, [place("LAB1", ("D0P0", "D0P0"), room="R2")])
    assert rule_ids.DURATION_MISMATCH in rules(findings)


def test_correct_duration_is_clean():
    prob = problem([session("LAB1", activity=ActivityType.LAB, groups=("B1",), duration=2)])
    findings = validate(prob, [place("LAB1", ("D0P0", "D0P1"), room="R2")])
    assert rule_ids.DURATION_MISMATCH not in rules(findings)


# -- H-NOT-CONSECUTIVE --------------------------------------------------------


def _lab2(sid="LAB1"):
    return session(
        sid, activity=ActivityType.LAB, groups=("B1",), duration=2, consecutive=True
    )


def test_non_consecutive_periods_detected():
    prob = problem([_lab2()])
    findings = validate(prob, [place("LAB1", ("D0P0", "D0P2"), room="R2")])
    hits = by_rule(findings, rule_ids.NOT_CONSECUTIVE)
    assert len(hits) == 1
    assert hits[0].severity == Severity.ERROR


def test_consecutive_spanning_break_detected():
    """Periods 2 and 4 are ordinally split by the period-3 break."""
    prob = problem([_lab2()])
    findings = validate(prob, [place("LAB1", ("D0P2", "D0P4"), room="R2")])
    hits = by_rule(findings, rule_ids.NOT_CONSECUTIVE)
    assert len(hits) == 1
    assert "break" in hits[0].message


def test_consecutive_wrapping_across_days_detected():
    prob = problem([_lab2()])
    findings = validate(prob, [place("LAB1", ("D0P5", "D1P0"), room="R2")])
    hits = by_rule(findings, rule_ids.NOT_CONSECUTIVE)
    assert len(hits) == 1
    assert "Monday" in hits[0].message and "Tuesday" in hits[0].message


def test_truly_consecutive_is_clean():
    prob = problem([_lab2()])
    findings = validate(prob, [place("LAB1", ("D0P1", "D0P2"), room="R2")])
    assert rule_ids.NOT_CONSECUTIVE not in rules(findings)


# -- H-BREAK-PLACEMENT --------------------------------------------------------


def test_placement_on_break_slot():
    prob = problem([session("S1")])
    findings = validate(prob, [place("S1", "D0P3")])  # period 3 is the break
    hits = by_rule(findings, rule_ids.BREAK_PLACEMENT)
    assert len(hits) == 1
    assert hits[0].slot_ids == ("D0P3",)
    assert hits[0].severity == Severity.ERROR


def test_teaching_slot_is_not_break_violation():
    prob = problem([session("S1")])
    findings = validate(prob, [place("S1", "D0P2")])
    assert rule_ids.BREAK_PLACEMENT not in rules(findings)


# -- H-FIXED-SLOT / H-FIXED-ROOM / H-FIXED-FACULTY ----------------------------


def test_fixed_slot_not_honoured():
    prob = problem([session("S1", fixed_slot="D0P0")])
    findings = validate(prob, [place("S1", "D0P1")])
    hits = by_rule(findings, rule_ids.FIXED_SLOT_CHANGED)
    assert len(hits) == 1
    assert "Monday period 0" in hits[0].message


def test_fixed_room_not_honoured():
    prob = problem([session("S1", groups=("ELEC1",), fixed_room="R1")])
    findings = validate(prob, [place("S1", "D0P0", room="R3")])
    hits = by_rule(findings, rule_ids.FIXED_ROOM_CHANGED)
    assert len(hits) == 1
    assert "Main Hall" in hits[0].message and "Seminar Room" in hits[0].message


def test_fixed_faculty_not_honoured():
    prob = problem([session("S1", fixed_faculty="F1")])
    findings = validate(prob, [place("S1", "D0P0", fac="F2")])
    hits = by_rule(findings, rule_ids.FIXED_FACULTY_CHANGED)
    assert len(hits) == 1
    assert "Prof. Rao" in hits[0].message and "Dr. Iyer" in hits[0].message


def test_honoured_fixed_assignments_are_clean():
    prob = problem(
        [session("S1", fixed_slot="D0P0", fixed_room="R1", fixed_faculty="F1")]
    )
    findings = validate(prob, [place("S1", "D0P0", room="R1", fac="F1")])
    found = rules(findings)
    assert rule_ids.FIXED_SLOT_CHANGED not in found
    assert rule_ids.FIXED_ROOM_CHANGED not in found
    assert rule_ids.FIXED_FACULTY_CHANGED not in found


# -- H-LOCKED-CHANGED ---------------------------------------------------------


def test_locked_placement_moved():
    locked = place("S1", "D0P0", room="R1", fac="F2", locked=True)
    prob = problem([session("S1")], locked=[locked])
    findings = validate(prob, [place("S1", "D0P1", room="R1", fac="F2")])
    hits = by_rule(findings, rule_ids.LOCKED_CHANGED)
    assert len(hits) == 1
    assert hits[0].severity == Severity.ERROR
    assert "unlock" in hits[0].message


def test_locked_placement_removed():
    locked = place("S1", "D0P0", room="R1", fac="F2", locked=True)
    prob = problem([session("S1")], locked=[locked])
    findings = validate(prob, [])
    assert rule_ids.LOCKED_CHANGED in rules(findings)
    assert rule_ids.SESSION_MISSING in rules(findings)


def test_locked_placement_preserved_is_clean_even_with_reordered_slots():
    locked = place("S1", ("D0P0", "D0P1"), room="R1", fac="F2", locked=True)
    prob = problem([session("S1", duration=2)], locked=[locked])
    findings = validate(prob, [place("S1", ("D0P1", "D0P0"), room="R1", fac="F2")])
    assert rule_ids.LOCKED_CHANGED not in rules(findings)


# -- H-FACULTY-MAX-PERIODS ----------------------------------------------------


def test_faculty_daily_maximum_exceeded():
    sessions = [session(f"S{i}", subject=f"SUB{i}") for i in range(5)]
    prob = problem(sessions)
    periods = (0, 1, 2, 4, 5)  # five teaching periods on Monday (3 is break)
    placements = [
        place(f"S{i}", f"D0P{p}", fac="F1") for i, p in enumerate(periods)
    ]
    findings = validate(prob, placements)
    hits = by_rule(findings, rule_ids.FACULTY_MAX_PERIODS)
    assert len(hits) == 1
    assert "Prof. Rao" in hits[0].message
    assert "5 periods" in hits[0].message and "maximum of 4" in hits[0].message


def test_faculty_daily_maximum_respected():
    sessions = [session(f"S{i}", subject=f"SUB{i}") for i in range(4)]
    prob = problem(sessions)
    periods = (0, 1, 2, 4)
    placements = [
        place(f"S{i}", f"D0P{p}", fac="F1") for i, p in enumerate(periods)
    ]
    assert rule_ids.FACULTY_MAX_PERIODS not in rules(validate(prob, placements))


# -- H-ORPHAN-* ---------------------------------------------------------------


def test_orphaned_session_reference():
    prob = problem([session("S1")])
    findings = validate(prob, [place("S1", "D0P0"), place("GHOST", "D0P1")])
    hits = by_rule(findings, rule_ids.ORPHAN_SESSION)
    assert len(hits) == 1
    assert hits[0].session_ids == ("GHOST",)


def test_orphaned_room_reference():
    prob = problem([session("S1")])
    findings = validate(prob, [place("S1", "D0P0", room="NO-SUCH-ROOM")])
    hits = by_rule(findings, rule_ids.ORPHAN_ROOM)
    assert len(hits) == 1
    assert "NO-SUCH-ROOM" in hits[0].message


def test_orphaned_faculty_reference():
    prob = problem([session("S1")])
    findings = validate(prob, [place("S1", "D0P0", fac="NO-SUCH-FACULTY")])
    hits = by_rule(findings, rule_ids.ORPHAN_FACULTY)
    assert len(hits) == 1
    assert "NO-SUCH-FACULTY" in hits[0].message


def test_orphaned_slot_reference():
    prob = problem([session("S1")])
    findings = validate(prob, [place("S1", "D9P9")])
    hits = by_rule(findings, rule_ids.ORPHAN_SLOT)
    assert len(hits) == 1
    assert "D9P9" in hits[0].message


def test_valid_references_produce_no_orphans():
    prob = problem([session("S1")])
    found = rules(validate(prob, [place("S1", "D0P0")]))
    assert not found & {
        rule_ids.ORPHAN_SESSION,
        rule_ids.ORPHAN_ROOM,
        rule_ids.ORPHAN_FACULTY,
        rule_ids.ORPHAN_SLOT,
    }
