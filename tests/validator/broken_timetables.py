"""Builders for the validator tests.

These construct small timetables - including deliberately broken ones - from
scratch, directly against the domain contract.  They intentionally do not use
any shared fixtures or solver helpers: the validator's reading of
requirements.md section 9 must stay independent.

Standard grid: 2 days (Monday, Tuesday) x 6 periods (0-5), 60 minutes each
starting 09:00, with period 3 a break on every day.

Standard resources:
  Rooms:   R1 'Main Hall'     classroom cap 70
           R2 'Physics Lab'   lab       cap 30
           R3 'Seminar Room'  classroom cap 25, unavailable at D0P2
           R4 'Chemistry Lab' lab       cap 35
  Faculty: F1 'Prof. Rao'  max 4 periods/day
           F2 'Dr. Iyer'   no daily cap
           F3 'Dr. Mehta'  unavailable at D0P1
           F4 'Prof. Shah' no daily cap
  Groups:  DIV1 'Division 1' strength 60
             B1 'Batch 1' strength 30, parent DIV1
             B2 'Batch 2' strength 30, parent DIV1
           DIV2 'Division 2' strength 55
           ELEC1 'Elective Group 1' strength 20
"""
from __future__ import annotations

from collections.abc import Iterable, Sequence

from chronos.core.domain import (
    ActivityType,
    Faculty,
    Finding,
    Placement,
    Problem,
    Room,
    Session,
    StudentGroup,
    TimeSlot,
)

DAY_START = 9 * 60
PERIOD_MINUTES = 60
BREAK_PERIOD = 3


def slot_id(day: int, period: int) -> str:
    return f"D{day}P{period}"


def make_slots(days: int = 2, periods: int = 6) -> list[TimeSlot]:
    slots = []
    for d in range(days):
        for p in range(periods):
            start = DAY_START + p * PERIOD_MINUTES
            slots.append(
                TimeSlot(
                    id=slot_id(d, p),
                    day=d,
                    period=p,
                    start_minute=start,
                    end_minute=start + PERIOD_MINUTES,
                    is_break=(p == BREAK_PERIOD),
                )
            )
    return slots


def make_rooms() -> list[Room]:
    return [
        Room("R1", "Main Hall", 70, "classroom", frozenset(), frozenset()),
        Room("R2", "Physics Lab", 30, "lab", frozenset({"lab-bench"}), frozenset()),
        Room("R3", "Seminar Room", 25, "classroom", frozenset(), frozenset({"D0P2"})),
        Room("R4", "Chemistry Lab", 35, "lab", frozenset(), frozenset()),
    ]


def make_faculty() -> list[Faculty]:
    return [
        Faculty("F1", "Prof. Rao", frozenset(), 4),
        Faculty("F2", "Dr. Iyer", frozenset(), None),
        Faculty("F3", "Dr. Mehta", frozenset({"D0P1"}), None),
        Faculty("F4", "Prof. Shah", frozenset(), None),
    ]


def make_groups() -> list[StudentGroup]:
    return [
        StudentGroup("DIV1", "Division 1", 60, None),
        StudentGroup("B1", "Batch 1", 30, "DIV1"),
        StudentGroup("B2", "Batch 2", 30, "DIV1"),
        StudentGroup("DIV2", "Division 2", 55, None),
        StudentGroup("ELEC1", "Elective Group 1", 20, None),
    ]


def session(
    sid: str,
    *,
    subject: str = "MATH101",
    subject_name: str | None = None,
    activity: ActivityType = ActivityType.LECTURE,
    groups: Sequence[str] = ("DIV1",),
    faculty: Sequence[str] = ("F1", "F2", "F3", "F4"),
    rooms: Sequence[str] = ("R1", "R2", "R3", "R4"),
    duration: int = 1,
    consecutive: bool = False,
    fixed_slot: str | None = None,
    fixed_room: str | None = None,
    fixed_faculty: str | None = None,
) -> Session:
    return Session(
        id=sid,
        subject_id=subject,
        subject_name=subject_name or subject.rstrip("0123456789").title(),
        activity_type=activity,
        group_ids=frozenset(groups),
        eligible_faculty_ids=frozenset(faculty),
        eligible_room_ids=frozenset(rooms),
        duration_periods=duration,
        requires_consecutive=consecutive,
        fixed_slot_id=fixed_slot,
        fixed_room_id=fixed_room,
        fixed_faculty_id=fixed_faculty,
    )


def place(
    sid: str,
    slots: str | Sequence[str],
    *,
    room: str = "R1",
    fac: str = "F2",
    locked: bool = False,
) -> Placement:
    if isinstance(slots, str):
        slots = (slots,)
    return Placement(
        session_id=sid, slot_ids=tuple(slots), room_id=room, faculty_id=fac, locked=locked
    )


def problem(
    sessions: Iterable[Session],
    locked: Iterable[Placement] = (),
    *,
    slots: list[TimeSlot] | None = None,
    rooms: list[Room] | None = None,
    faculty: list[Faculty] | None = None,
    groups: list[StudentGroup] | None = None,
) -> Problem:
    return Problem(
        slots=make_slots() if slots is None else slots,
        rooms=make_rooms() if rooms is None else rooms,
        faculty=make_faculty() if faculty is None else faculty,
        groups=make_groups() if groups is None else groups,
        sessions=list(sessions),
        locked_placements=list(locked),
    )


def rules(findings: Iterable[Finding]) -> set[str]:
    return {f.rule_id for f in findings}


def by_rule(findings: Iterable[Finding], rule_id: str) -> list[Finding]:
    return [f for f in findings if f.rule_id == rule_id]
