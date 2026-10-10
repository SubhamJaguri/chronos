"""Hard-constraint checks (requirements.md sections 8 and 9).

Every finding produced here carries severity ERROR: a timetable with any of
these findings must never be marked publish-ready.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from itertools import combinations

import chronos.validator.rule_ids as rule_ids
from chronos.core.domain import Finding, Severity
from chronos.validator.context import (
    LAB_ROOM_TYPE,
    ValidationContext,
    activity_value,
    day_name,
)


def _error(rule_id, message, session_ids=(), slot_ids=()):
    return Finding(
        rule_id=rule_id,
        severity=Severity.ERROR,
        message=message,
        session_ids=tuple(session_ids),
        slot_ids=tuple(slot_ids),
    )


# -- referential integrity ---------------------------------------------------


def check_orphans(ctx: ValidationContext) -> list[Finding]:
    """Placements that reference an unknown session, room, faculty or slot."""
    findings: list[Finding] = []
    for p in ctx.placements:
        if p.session_id not in ctx.sessions_by_id:
            findings.append(
                _error(
                    rule_ids.ORPHAN_SESSION,
                    f"Placement references unknown session '{p.session_id}'"
                    f" (room '{p.room_id}', faculty '{p.faculty_id}')."
                    " Suggested: remove this placement or add the session to"
                    " the canonical session list.",
                    session_ids=(p.session_id,),
                    slot_ids=p.slot_ids,
                )
            )
        if p.room_id not in ctx.rooms_by_id:
            findings.append(
                _error(
                    rule_ids.ORPHAN_ROOM,
                    f"Placement of {ctx.session_label(p.session_id)} references"
                    f" unknown room '{p.room_id}'."
                    " Suggested: assign a room that exists in the room list.",
                    session_ids=(p.session_id,),
                    slot_ids=p.slot_ids,
                )
            )
        if p.faculty_id not in ctx.faculty_by_id:
            findings.append(
                _error(
                    rule_ids.ORPHAN_FACULTY,
                    f"Placement of {ctx.session_label(p.session_id)} references"
                    f" unknown faculty '{p.faculty_id}'."
                    " Suggested: assign a faculty member that exists in the"
                    " faculty list.",
                    session_ids=(p.session_id,),
                    slot_ids=p.slot_ids,
                )
            )
        unknown_slots = tuple(s for s in p.slot_ids if s not in ctx.slots_by_id)
        if unknown_slots:
            findings.append(
                _error(
                    rule_ids.ORPHAN_SLOT,
                    f"Placement of {ctx.session_label(p.session_id)} references"
                    f" unknown time slot(s) {', '.join(repr(s) for s in unknown_slots)}."
                    " Suggested: reschedule onto slots defined in the timetable grid.",
                    session_ids=(p.session_id,),
                    slot_ids=unknown_slots,
                )
            )
    return findings


# -- session coverage ---------------------------------------------------------


def check_session_coverage(ctx: ValidationContext) -> list[Finding]:
    """Every required session placed exactly once: none missing, none duplicated."""
    findings: list[Finding] = []
    counts = Counter(p.session_id for p in ctx.placements)
    for session in ctx.problem.sessions:
        n = counts.get(session.id, 0)
        if n == 0:
            findings.append(
                _error(
                    rule_ids.SESSION_MISSING,
                    f"Required {ctx.session_label(session.id)} has no placement."
                    " Suggested: schedule it in a free slot with an eligible"
                    " room and faculty member.",
                    session_ids=(session.id,),
                )
            )
        elif n > 1:
            slot_ids = tuple(
                sid
                for p in ctx.placements
                if p.session_id == session.id
                for sid in p.slot_ids
            )
            findings.append(
                _error(
                    rule_ids.SESSION_DUPLICATE,
                    f"{ctx.session_label(session.id)} is placed {n} times but is"
                    " required exactly once."
                    f" Suggested: keep one placement and remove the other {n - 1}.",
                    session_ids=(session.id,),
                    slot_ids=slot_ids,
                )
            )
    return findings


# -- clashes ------------------------------------------------------------------


def check_faculty_clashes(ctx: ValidationContext) -> list[Finding]:
    """No faculty member teaches two different sessions in the same slot."""
    occupancy: dict[tuple[str, str], list] = defaultdict(list)
    for p in ctx.placements:
        for sid in set(p.slot_ids):
            occupancy[(p.faculty_id, sid)].append(p)
    findings: list[Finding] = []
    for (faculty_id, slot_id), ps in sorted(occupancy.items()):
        session_ids = tuple(sorted({p.session_id for p in ps}))
        if len(session_ids) < 2:
            continue  # duplicates of one session are reported by coverage check
        listed = ", ".join(ctx.session_label(s) for s in session_ids)
        findings.append(
            _error(
                rule_ids.FACULTY_CLASH,
                f"{ctx.faculty_label(faculty_id)} is double-booked at"
                f" {ctx.slot_label(slot_id)}: {listed}."
                " Suggested: move all but one of these sessions to another"
                " slot, or assign a different eligible faculty member.",
                session_ids=session_ids,
                slot_ids=(slot_id,),
            )
        )
    return findings


def check_room_clashes(ctx: ValidationContext) -> list[Finding]:
    """No room hosts two different sessions in the same slot."""
    occupancy: dict[tuple[str, str], list] = defaultdict(list)
    for p in ctx.placements:
        for sid in set(p.slot_ids):
            occupancy[(p.room_id, sid)].append(p)
    findings: list[Finding] = []
    for (room_id, slot_id), ps in sorted(occupancy.items()):
        session_ids = tuple(sorted({p.session_id for p in ps}))
        if len(session_ids) < 2:
            continue
        listed = ", ".join(ctx.session_label(s) for s in session_ids)
        findings.append(
            _error(
                rule_ids.ROOM_CLASH,
                f"{ctx.room_label(room_id)} is double-booked at"
                f" {ctx.slot_label(slot_id)}: {listed}."
                " Suggested: move all but one of these sessions to a different"
                " room or slot.",
                session_ids=session_ids,
                slot_ids=(slot_id,),
            )
        )
    return findings


def check_group_clashes(ctx: ValidationContext) -> list[Finding]:
    """No student can be required in two sessions at once.

    Resolves the parent/child hierarchy: a division session clashes with a
    session of any of that division's own batches (students overlap), while
    two sibling batches may be scheduled in parallel.
    """
    by_slot: dict[str, list] = defaultdict(list)
    for p in ctx.placements:
        if p.session_id in ctx.sessions_by_id:
            for sid in set(p.slot_ids):
                by_slot[sid].append(p)
    findings: list[Finding] = []
    reported: set[tuple[str, frozenset[str]]] = set()
    for slot_id, ps in sorted(by_slot.items()):
        for a, b in combinations(ps, 2):
            if a.session_id == b.session_id:
                continue
            key = (slot_id, frozenset({a.session_id, b.session_id}))
            if key in reported:
                continue
            sa = ctx.sessions_by_id[a.session_id]
            sb = ctx.sessions_by_id[b.session_id]
            pairs = ctx.groups_conflict(sa.group_ids, sb.group_ids)
            if not pairs:
                continue
            reported.add(key)
            names = sorted({ctx.group_label(g) for pair in pairs for g in pair})
            session_ids = tuple(sorted({a.session_id, b.session_id}))
            findings.append(
                _error(
                    rule_ids.GROUP_CLASH,
                    f"Student group clash at {ctx.slot_label(slot_id)}:"
                    f" {' and '.join(names)} cannot attend both"
                    f" {ctx.session_label(a.session_id)} and"
                    f" {ctx.session_label(b.session_id)} at the same time."
                    " Suggested: move one of the two sessions to a different slot.",
                    session_ids=session_ids,
                    slot_ids=(slot_id,),
                )
            )
    return findings


# -- availability -------------------------------------------------------------


def check_availability(ctx: ValidationContext) -> list[Finding]:
    """Faculty and room unavailable_slots are respected."""
    findings: list[Finding] = []
    for p in ctx.placements:
        fac = ctx.faculty_by_id.get(p.faculty_id)
        if fac is not None:
            bad = tuple(s for s in p.slot_ids if s in fac.unavailable_slots)
            if bad:
                when = ", ".join(ctx.slot_label(s) for s in bad)
                findings.append(
                    _error(
                        rule_ids.FACULTY_UNAVAILABLE,
                        f"{ctx.faculty_label(p.faculty_id)} is unavailable at"
                        f" {when} but is assigned {ctx.session_label(p.session_id)}"
                        " there. Suggested: move the session to a slot where"
                        " they are available, or assign another eligible"
                        " faculty member.",
                        session_ids=(p.session_id,),
                        slot_ids=bad,
                    )
                )
        room = ctx.rooms_by_id.get(p.room_id)
        if room is not None:
            bad = tuple(s for s in p.slot_ids if s in room.unavailable_slots)
            if bad:
                when = ", ".join(ctx.slot_label(s) for s in bad)
                findings.append(
                    _error(
                        rule_ids.ROOM_UNAVAILABLE,
                        f"{ctx.room_label(p.room_id)} is unavailable at {when}"
                        f" but hosts {ctx.session_label(p.session_id)} there."
                        " Suggested: move the session to another slot or to a"
                        " room that is available then.",
                        session_ids=(p.session_id,),
                        slot_ids=bad,
                    )
                )
    return findings


# -- room suitability ---------------------------------------------------------


def check_room_type(ctx: ValidationContext) -> list[Finding]:
    """Lab activities must be placed in a room of room_type 'lab'."""
    findings: list[Finding] = []
    for p in ctx.placements:
        session = ctx.sessions_by_id.get(p.session_id)
        room = ctx.rooms_by_id.get(p.room_id)
        if session is None or room is None:
            continue
        if activity_value(session.activity_type) == "lab" and room.room_type != LAB_ROOM_TYPE:
            findings.append(
                _error(
                    rule_ids.ROOM_TYPE_UNSUITABLE,
                    f"{ctx.session_label(p.session_id)} is a lab activity but is"
                    f" placed in {ctx.room_label(p.room_id)} of type"
                    f" '{room.room_type}'."
                    " Suggested: move it to a room with room_type 'lab'.",
                    session_ids=(p.session_id,),
                    slot_ids=p.slot_ids,
                )
            )
    return findings


def check_room_capacity(ctx: ValidationContext) -> list[Finding]:
    """Room capacity covers the combined strength of the assigned groups."""
    findings: list[Finding] = []
    for p in ctx.placements:
        session = ctx.sessions_by_id.get(p.session_id)
        room = ctx.rooms_by_id.get(p.room_id)
        if session is None or room is None:
            continue
        strength = ctx.combined_strength(session.group_ids)
        if strength > room.capacity:
            groups = ", ".join(
                ctx.group_label(g) for g in sorted(session.group_ids)
            )
            findings.append(
                _error(
                    rule_ids.ROOM_CAPACITY,
                    f"{ctx.room_label(p.room_id)} seats {room.capacity} but"
                    f" {ctx.session_label(p.session_id)} brings {strength}"
                    f" students ({groups})."
                    f" Suggested: assign a room with capacity >= {strength}.",
                    session_ids=(p.session_id,),
                    slot_ids=p.slot_ids,
                )
            )
    return findings


# -- duration and contiguity --------------------------------------------------


def check_duration(ctx: ValidationContext) -> list[Finding]:
    """A placement covers exactly duration_periods distinct slots."""
    findings: list[Finding] = []
    for p in ctx.placements:
        session = ctx.sessions_by_id.get(p.session_id)
        if session is None:
            continue
        distinct = len(set(p.slot_ids))
        if len(p.slot_ids) != session.duration_periods or distinct != session.duration_periods:
            findings.append(
                _error(
                    rule_ids.DURATION_MISMATCH,
                    f"{ctx.session_label(p.session_id)} requires"
                    f" {session.duration_periods} period(s) but its placement"
                    f" covers {len(p.slot_ids)} slot(s) ({distinct} distinct)."
                    f" Suggested: assign exactly {session.duration_periods}"
                    " distinct slot(s).",
                    session_ids=(p.session_id,),
                    slot_ids=p.slot_ids,
                )
            )
    return findings


def check_consecutive(ctx: ValidationContext) -> list[Finding]:
    """Sessions with requires_consecutive sit in contiguous periods of one day.

    Catches gaps between periods, runs that span a break period, and
    placements that wrap across days (requirements.md section 20).
    """
    findings: list[Finding] = []
    for p in ctx.placements:
        session = ctx.sessions_by_id.get(p.session_id)
        if session is None or not session.requires_consecutive:
            continue
        slots = ctx.known_slots(p)
        if len(slots) != len(set(p.slot_ids)):
            continue  # unknown slots already reported as H-ORPHAN-SLOT
        if len(slots) < 2:
            continue
        days = sorted({s.day for s in slots})
        if len(days) > 1:
            listed = " and ".join(day_name(d) for d in days)
            findings.append(
                _error(
                    rule_ids.NOT_CONSECUTIVE,
                    f"{ctx.session_label(p.session_id)} requires consecutive"
                    f" periods but its placement wraps across days ({listed})."
                    f" Suggested: place all {session.duration_periods} periods"
                    " contiguously on a single day.",
                    session_ids=(p.session_id,),
                    slot_ids=p.slot_ids,
                )
            )
            continue
        day = days[0]
        periods = sorted(s.period for s in slots)
        contiguous = all(b - a == 1 for a, b in zip(periods, periods[1:], strict=False))
        if contiguous:
            continue
        occupied = set(periods)
        breaks_between = [
            slot
            for q in range(periods[0] + 1, periods[-1])
            if q not in occupied
            and (slot := ctx.slot_by_day_period.get((day, q))) is not None
            and slot.is_break
        ]
        detail = (
            " The assigned periods span a break, which splits the session."
            if breaks_between
            else ""
        )
        findings.append(
            _error(
                rule_ids.NOT_CONSECUTIVE,
                f"{ctx.session_label(p.session_id)} requires consecutive"
                f" periods but occupies non-contiguous periods"
                f" {periods} on {day_name(day)}.{detail}"
                f" Suggested: place all {session.duration_periods} periods in"
                " an unbroken run on one day.",
                session_ids=(p.session_id,),
                slot_ids=p.slot_ids,
            )
        )
    return findings


def check_break_placement(ctx: ValidationContext) -> list[Finding]:
    """No teaching session sits on a break/blocked slot."""
    findings: list[Finding] = []
    for p in ctx.placements:
        bad = tuple(
            sid
            for sid in p.slot_ids
            if (slot := ctx.slots_by_id.get(sid)) is not None and slot.is_break
        )
        if bad:
            when = ", ".join(ctx.slot_label(s) for s in bad)
            findings.append(
                _error(
                    rule_ids.BREAK_PLACEMENT,
                    f"{ctx.session_label(p.session_id)} is placed on break"
                    f" slot(s): {when}. Breaks cannot host teaching sessions."
                    " Suggested: move the session to a teaching period.",
                    session_ids=(p.session_id,),
                    slot_ids=bad,
                )
            )
    return findings


# -- fixed and locked assignments ---------------------------------------------


def check_fixed_assignments(ctx: ValidationContext) -> list[Finding]:
    """fixed_slot_id / fixed_room_id / fixed_faculty_id are honoured."""
    findings: list[Finding] = []
    for p in ctx.placements:
        session = ctx.sessions_by_id.get(p.session_id)
        if session is None:
            continue
        if session.fixed_slot_id is not None and session.fixed_slot_id not in p.slot_ids:
            findings.append(
                _error(
                    rule_ids.FIXED_SLOT_CHANGED,
                    f"{ctx.session_label(p.session_id)} is fixed to"
                    f" {ctx.slot_label(session.fixed_slot_id)} but is placed at"
                    f" {', '.join(ctx.slot_label(s) for s in p.slot_ids)}."
                    " Suggested: move it back to its fixed slot.",
                    session_ids=(p.session_id,),
                    slot_ids=p.slot_ids + (session.fixed_slot_id,),
                )
            )
        if session.fixed_room_id is not None and p.room_id != session.fixed_room_id:
            findings.append(
                _error(
                    rule_ids.FIXED_ROOM_CHANGED,
                    f"{ctx.session_label(p.session_id)} is fixed to"
                    f" {ctx.room_label(session.fixed_room_id)} but is placed in"
                    f" {ctx.room_label(p.room_id)}."
                    " Suggested: move it back to its fixed room.",
                    session_ids=(p.session_id,),
                    slot_ids=p.slot_ids,
                )
            )
        if session.fixed_faculty_id is not None and p.faculty_id != session.fixed_faculty_id:
            findings.append(
                _error(
                    rule_ids.FIXED_FACULTY_CHANGED,
                    f"{ctx.session_label(p.session_id)} is fixed to"
                    f" {ctx.faculty_label(session.fixed_faculty_id)} but is"
                    f" assigned {ctx.faculty_label(p.faculty_id)}."
                    " Suggested: restore the fixed faculty assignment.",
                    session_ids=(p.session_id,),
                    slot_ids=p.slot_ids,
                )
            )
    return findings


def check_locked_placements(ctx: ValidationContext) -> list[Finding]:
    """Locked placements survive regeneration unchanged (slots, room, faculty)."""
    findings: list[Finding] = []
    by_session: dict[str, list] = defaultdict(list)
    for p in ctx.placements:
        by_session[p.session_id].append(p)
    for locked in ctx.problem.locked_placements:
        expected = (tuple(sorted(locked.slot_ids)), locked.room_id, locked.faculty_id)
        candidates = by_session.get(locked.session_id, [])
        if not candidates:
            findings.append(
                _error(
                    rule_ids.LOCKED_CHANGED,
                    f"Locked {ctx.session_label(locked.session_id)} was removed"
                    " from the timetable."
                    f" Suggested: restore it at"
                    f" {', '.join(ctx.slot_label(s) for s in locked.slot_ids)}"
                    f" in {ctx.room_label(locked.room_id)} with"
                    f" {ctx.faculty_label(locked.faculty_id)}, or have an"
                    " authorized user unlock it first.",
                    session_ids=(locked.session_id,),
                    slot_ids=locked.slot_ids,
                )
            )
            continue
        if any(
            (tuple(sorted(c.slot_ids)), c.room_id, c.faculty_id) == expected
            for c in candidates
        ):
            continue
        actual = candidates[0]
        changed: list[str] = []
        if tuple(sorted(actual.slot_ids)) != expected[0]:
            changed.append(
                "time ("
                + ", ".join(ctx.slot_label(s) for s in locked.slot_ids)
                + " -> "
                + ", ".join(ctx.slot_label(s) for s in actual.slot_ids)
                + ")"
            )
        if actual.room_id != locked.room_id:
            changed.append(
                f"room ({ctx.room_label(locked.room_id)} ->"
                f" {ctx.room_label(actual.room_id)})"
            )
        if actual.faculty_id != locked.faculty_id:
            changed.append(
                f"faculty ({ctx.faculty_label(locked.faculty_id)} ->"
                f" {ctx.faculty_label(actual.faculty_id)})"
            )
        findings.append(
            _error(
                rule_ids.LOCKED_CHANGED,
                f"Locked {ctx.session_label(locked.session_id)} was changed:"
                f" {'; '.join(changed)}."
                " Suggested: restore the locked placement, or have an"
                " authorized user unlock it before regenerating.",
                session_ids=(locked.session_id,),
                slot_ids=tuple(locked.slot_ids) + tuple(actual.slot_ids),
            )
        )
    return findings


# -- faculty daily load ---------------------------------------------------------


def check_faculty_daily_load(ctx: ValidationContext) -> list[Finding]:
    """max_periods_per_day is respected for each faculty member."""
    slots_per_day: dict[str, dict[int, set[str]]] = defaultdict(lambda: defaultdict(set))
    sessions_per_day: dict[str, dict[int, set[str]]] = defaultdict(lambda: defaultdict(set))
    for p in ctx.placements:
        for slot in ctx.known_slots(p):
            slots_per_day[p.faculty_id][slot.day].add(slot.id)
            sessions_per_day[p.faculty_id][slot.day].add(p.session_id)
    findings: list[Finding] = []
    for faculty_id, days in sorted(slots_per_day.items()):
        fac = ctx.faculty_by_id.get(faculty_id)
        if fac is None or fac.max_periods_per_day is None:
            continue
        for day, slot_ids in sorted(days.items()):
            n = len(slot_ids)
            if n > fac.max_periods_per_day:
                findings.append(
                    _error(
                        rule_ids.FACULTY_MAX_PERIODS,
                        f"{ctx.faculty_label(faculty_id)} teaches {n} periods on"
                        f" {day_name(day)}, exceeding their daily maximum of"
                        f" {fac.max_periods_per_day}."
                        f" Suggested: move {n - fac.max_periods_per_day}"
                        " period(s) to another day.",
                        session_ids=tuple(sorted(sessions_per_day[faculty_id][day])),
                        slot_ids=tuple(sorted(slot_ids)),
                    )
                )
    return findings


ALL_CHECKS = (
    check_orphans,
    check_session_coverage,
    check_faculty_clashes,
    check_group_clashes,
    check_room_clashes,
    check_availability,
    check_room_type,
    check_room_capacity,
    check_duration,
    check_consecutive,
    check_break_placement,
    check_fixed_assignments,
    check_locked_placements,
    check_faculty_daily_load,
)
