from __future__ import annotations
from dataclasses import dataclass, field
from enum import Enum


class ActivityType(str, Enum):
    LECTURE = "lecture"
    LAB = "lab"
    PRACTICAL = "practical"
    ELECTIVE = "elective"
    PROJECT = "project"
    LIBRARY = "library"
    FIXED = "fixed"


@dataclass(frozen=True)
class TimeSlot:
    id: str
    day: int                 # 0 = Monday
    period: int              # 0-based ordinal within the day
    start_minute: int        # minutes from midnight
    end_minute: int
    is_break: bool = False


@dataclass(frozen=True)
class Room:
    id: str
    name: str
    capacity: int
    room_type: str           # "classroom" | "lab" | "auditorium"
    facilities: frozenset[str] = frozenset()
    unavailable_slots: frozenset[str] = frozenset()


@dataclass(frozen=True)
class Faculty:
    id: str
    name: str
    unavailable_slots: frozenset[str] = frozenset()
    max_periods_per_day: int | None = None


@dataclass(frozen=True)
class StudentGroup:
    id: str
    name: str
    strength: int
    parent_id: str | None = None


@dataclass(frozen=True)
class Session:
    id: str
    subject_id: str
    subject_name: str
    activity_type: ActivityType
    group_ids: frozenset[str]
    eligible_faculty_ids: frozenset[str]
    eligible_room_ids: frozenset[str]
    duration_periods: int = 1
    requires_consecutive: bool = False
    fixed_slot_id: str | None = None
    fixed_room_id: str | None = None
    fixed_faculty_id: str | None = None


@dataclass(frozen=True)
class Placement:
    session_id: str
    slot_ids: tuple[str, ...]
    room_id: str
    faculty_id: str
    locked: bool = False


@dataclass
class Problem:
    slots: list[TimeSlot]
    rooms: list[Room]
    faculty: list[Faculty]
    groups: list[StudentGroup]
    sessions: list[Session]
    locked_placements: list[Placement] = field(default_factory=list)


@dataclass
class Solution:
    placements: list[Placement]
    status: str              # "optimal" | "feasible" | "infeasible" | "timeout"
    diagnostics: list[str] = field(default_factory=list)


class Severity(str, Enum):
    ERROR = "error"
    WARNING = "warning"


@dataclass(frozen=True)
class Finding:
    rule_id: str
    severity: Severity
    message: str
    session_ids: tuple[str, ...] = ()
    slot_ids: tuple[str, ...] = ()
