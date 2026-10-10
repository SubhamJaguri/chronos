"""Lookup context shared by the validator's rule checks.

Everything in this package is derived directly from requirements.md
(sections 8, 9 and 20).  It deliberately does not import from, or mirror,
``chronos.solver``: the validator re-derives every rule on its own so that a
disagreement between solver and validator surfaces as a finding instead of
being silently shared.
"""
from __future__ import annotations

from chronos.core.domain import Placement, Problem, TimeSlot

DAY_NAMES = (
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
)

#: The room_type a lab activity must be placed in (requirements.md section 9).
LAB_ROOM_TYPE = "lab"


def activity_value(activity: object) -> str:
    """Normalised string value of an ActivityType (tolerates plain strings)."""
    return str(getattr(activity, "value", activity)).lower()


def hhmm(minute: int) -> str:
    return f"{minute // 60:02d}:{minute % 60:02d}"


def day_name(day: int) -> str:
    return DAY_NAMES[day % len(DAY_NAMES)]


def sentence_case(text: str) -> str:
    """Upper-case only the first character, preserving names inside."""
    return text[:1].upper() + text[1:]


class ValidationContext:
    """Indexes a Problem plus the proposed placements for the rule checks."""

    def __init__(self, problem: Problem, placements: list[Placement]) -> None:
        self.problem = problem
        self.placements: list[Placement] = list(placements)
        self.slots_by_id: dict[str, TimeSlot] = {s.id: s for s in problem.slots}
        self.rooms_by_id = {r.id: r for r in problem.rooms}
        self.faculty_by_id = {f.id: f for f in problem.faculty}
        self.groups_by_id = {g.id: g for g in problem.groups}
        self.sessions_by_id = {s.id: s for s in problem.sessions}
        self.slot_by_day_period = {(s.day, s.period): s for s in problem.slots}
        parents = {g.parent_id for g in problem.groups if g.parent_id is not None}
        #: Groups with no child group: the finest unit students belong to.
        self.leaf_group_ids = tuple(g.id for g in problem.groups if g.id not in parents)
        self._lineage_cache: dict[str, frozenset[str]] = {}

    # -- group hierarchy ---------------------------------------------------

    def lineage(self, group_id: str) -> frozenset[str]:
        """The group itself plus every ancestor, cycle-safe.

        A batch's students are a subset of its division's students, so a
        session for a division occupies all of its batches and vice versa.
        """
        cached = self._lineage_cache.get(group_id)
        if cached is not None:
            return cached
        chain: list[str] = []
        seen: set[str] = set()
        current: str | None = group_id
        while current is not None and current not in seen:
            seen.add(current)
            chain.append(current)
            group = self.groups_by_id.get(current)
            current = group.parent_id if group is not None else None
        result = frozenset(chain)
        self._lineage_cache[group_id] = result
        return result

    def groups_conflict(
        self, a: frozenset[str], b: frozenset[str]
    ) -> list[tuple[str, str]]:
        """Pairs (ga, gb) where one group is the other or contains the other.

        Sibling batches of the same division do NOT conflict with each other;
        a division conflicts with each of its own batches.
        """
        pairs: list[tuple[str, str]] = []
        for ga in sorted(a):
            la = self.lineage(ga)
            for gb in sorted(b):
                if gb in la or ga in self.lineage(gb):
                    pairs.append((ga, gb))
        return pairs

    def combined_strength(self, group_ids: frozenset[str]) -> int:
        """Total students across the groups, never double-counting a batch
        whose parent division is also in the set."""
        total = 0
        for gid in group_ids:
            group = self.groups_by_id.get(gid)
            if group is None:
                continue
            if (self.lineage(gid) - {gid}) & set(group_ids):
                continue  # an ancestor in the set already counts these students
            total += group.strength
        return total

    def group_attends(self, group_id: str, session_group_ids: frozenset[str]) -> bool:
        """Whether students of ``group_id`` sit in a session assigned to any of
        ``session_group_ids`` (the session may target the group or an ancestor)."""
        return bool(self.lineage(group_id) & set(session_group_ids))

    # -- placement helpers -------------------------------------------------

    def known_slots(self, placement: Placement) -> list[TimeSlot]:
        return [
            self.slots_by_id[sid]
            for sid in placement.slot_ids
            if sid in self.slots_by_id
        ]

    # -- human-readable labels ----------------------------------------------

    def slot_label(self, slot_id: str) -> str:
        slot = self.slots_by_id.get(slot_id)
        if slot is None:
            return f"unknown slot '{slot_id}'"
        return (
            f"{day_name(slot.day)} period {slot.period}"
            f" ({hhmm(slot.start_minute)}-{hhmm(slot.end_minute)})"
        )

    def room_label(self, room_id: str) -> str:
        room = self.rooms_by_id.get(room_id)
        if room is None:
            return f"unknown room '{room_id}'"
        return f"room '{room.name}'"

    def faculty_label(self, faculty_id: str) -> str:
        fac = self.faculty_by_id.get(faculty_id)
        if fac is None:
            return f"unknown faculty '{faculty_id}'"
        return f"faculty '{fac.name}'"

    def group_label(self, group_id: str) -> str:
        group = self.groups_by_id.get(group_id)
        if group is None:
            return f"unknown group '{group_id}'"
        return f"group '{group.name}'"

    def session_label(self, session_id: str) -> str:
        session = self.sessions_by_id.get(session_id)
        if session is None:
            return f"unknown session '{session_id}'"
        return (
            f"'{session.subject_name}' {activity_value(session.activity_type)}"
            f" session '{session.id}'"
        )
