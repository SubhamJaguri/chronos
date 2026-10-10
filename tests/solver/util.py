"""Test helpers for the solver suite: grid builders and an independent checker.

The checker re-verifies solver output directly against the Problem using plain
Python (no CP-SAT), so a modelling bug in the solver cannot hide itself.
"""

from __future__ import annotations

from collections import defaultdict

from chronos.core.domain import (
    ActivityType,
    Faculty,
    Problem,
    Room,
    Session,
    Solution,
    StudentGroup,
    TimeSlot,
)


def make_grid(days: int = 1, periods: int = 4, breaks: tuple[int, ...] = ()) -> list[TimeSlot]:
    """A days x periods grid; period ordinals in ``breaks`` become break slots.

    Slot ids follow the pattern ``d{day}p{period}``.
    """
    slots = []
    for day in range(days):
        for period in range(periods):
            start = 9 * 60 + period * 60
            slots.append(
                TimeSlot(
                    id=f"d{day}p{period}",
                    day=day,
                    period=period,
                    start_minute=start,
                    end_minute=start + 60,
                    is_break=period in breaks,
                )
            )
    return slots


def room(rid: str, capacity: int = 60, room_type: str = "classroom", **kw) -> Room:
    return Room(id=rid, name=rid, capacity=capacity, room_type=room_type, **kw)


def fac(fid: str, **kw) -> Faculty:
    return Faculty(id=fid, name=fid, **kw)


def grp(gid: str, strength: int = 30, parent_id: str | None = None) -> StudentGroup:
    return StudentGroup(id=gid, name=gid, strength=strength, parent_id=parent_id)


def ses(
    sid: str,
    groups: set[str],
    faculty: set[str],
    rooms: set[str],
    subject: str | None = None,
    activity: ActivityType = ActivityType.LECTURE,
    **kw,
) -> Session:
    subject = subject or f"sub-{sid}"
    return Session(
        id=sid,
        subject_id=subject,
        subject_name=subject,
        activity_type=activity,
        group_ids=frozenset(groups),
        eligible_faculty_ids=frozenset(faculty),
        eligible_room_ids=frozenset(rooms),
        **kw,
    )


def _ancestors(gid: str, groups: dict[str, StudentGroup]) -> set[str]:
    chain = {gid}
    cur = groups.get(gid)
    while cur is not None and cur.parent_id is not None and cur.parent_id not in chain:
        chain.add(cur.parent_id)
        cur = groups.get(cur.parent_id)
    return chain


def _groups_conflict(a: frozenset[str], b: frozenset[str], groups: dict[str, StudentGroup]) -> bool:
    """True when some group in ``a`` is an ancestor-or-self/descendant of one in ``b``."""
    for ga in a:
        anc_a = _ancestors(ga, groups)
        for gb in b:
            if gb in anc_a or ga in _ancestors(gb, groups):
                return True
    return False


def _strength(session: Session, groups: dict[str, StudentGroup]) -> int:
    total = 0
    for gid in session.group_ids:
        g = groups.get(gid)
        if g is None:
            continue
        if (_ancestors(gid, groups) - {gid}) & session.group_ids:
            continue  # covered by a listed ancestor
        total += g.strength
    return total


def assert_valid(problem: Problem, solution: Solution) -> None:
    """Independently verify every hard constraint on a solved timetable."""
    assert solution.status in ("optimal", "feasible"), (
        f"expected a solved timetable, got {solution.status}: {solution.diagnostics}"
    )
    slots = {s.id: s for s in problem.slots}
    rooms = {r.id: r for r in problem.rooms}
    faculty = {f.id: f for f in problem.faculty}
    groups = {g.id: g for g in problem.groups}
    sessions = {s.id: s for s in problem.sessions}

    placed = {p.session_id for p in solution.placements}
    assert placed == set(sessions), f"placed {placed} != sessions {set(sessions)}"
    assert len(solution.placements) == len(set(placed)), "a session was placed twice"

    locked = {p.session_id: p for p in problem.locked_placements if p.locked}

    room_use: dict[str, list[str]] = defaultdict(list)
    fac_use: dict[str, list[str]] = defaultdict(list)
    fac_day_periods: dict[tuple[str, int], int] = defaultdict(int)
    by_sid = {}

    for p in solution.placements:
        sess = sessions[p.session_id]
        by_sid[p.session_id] = p

        # locked placements preserved exactly
        if p.session_id in locked:
            assert p == locked[p.session_id], f"locked placement for {p.session_id} was altered"

        # slots exist, are not breaks, single day, correct duration
        pslots = [slots[s] for s in p.slot_ids]
        assert len(p.slot_ids) == sess.duration_periods
        assert len(set(p.slot_ids)) == len(p.slot_ids)
        assert all(not s.is_break for s in pslots), f"{p.session_id} placed on a break"
        assert len({s.day for s in pslots}) == 1, f"{p.session_id} spans days"
        if sess.requires_consecutive and len(pslots) > 1:
            periods = sorted(s.period for s in pslots)
            assert periods == list(range(periods[0], periods[0] + len(periods))), (
                f"{p.session_id} not consecutive: {periods}"
            )

        # fixed fields honoured
        if sess.fixed_slot_id is not None:
            assert sess.fixed_slot_id in p.slot_ids
        if sess.fixed_room_id is not None:
            assert p.room_id == sess.fixed_room_id
        if sess.fixed_faculty_id is not None:
            assert p.faculty_id == sess.fixed_faculty_id

        # room suitability
        r = rooms[p.room_id]
        assert r.capacity >= _strength(sess, groups), f"{p.session_id} over capacity"
        if sess.activity_type == ActivityType.LAB:
            assert r.room_type == "lab", f"lab {p.session_id} in {r.room_type}"
        assert not (set(p.slot_ids) & r.unavailable_slots), f"{p.session_id} room unavailable"

        # faculty suitability
        f = faculty[p.faculty_id]
        assert not (set(p.slot_ids) & f.unavailable_slots), f"{p.session_id} faculty unavailable"

        for sl in p.slot_ids:
            room_use[sl].append(p.room_id)
            fac_use[sl].append(p.faculty_id)
        fac_day_periods[(p.faculty_id, pslots[0].day)] += len(p.slot_ids)

    # no double-booking
    for sl, used_rooms in room_use.items():
        assert len(used_rooms) == len(set(used_rooms)), f"room double-booked at {sl}"
    for sl, used_fac in fac_use.items():
        assert len(used_fac) == len(set(used_fac)), f"faculty double-booked at {sl}"

    # faculty per-day caps
    for (fid, _day), count in fac_day_periods.items():
        cap = faculty[fid].max_periods_per_day
        if cap is not None:
            assert count <= cap, f"faculty {fid} exceeds daily cap"

    # group overlaps including the parent/child hierarchy
    sids = sorted(by_sid)
    for i, sa in enumerate(sids):
        for sb in sids[i + 1 :]:
            shared = set(by_sid[sa].slot_ids) & set(by_sid[sb].slot_ids)
            if not shared:
                continue
            assert not _groups_conflict(
                sessions[sa].group_ids, sessions[sb].group_ids, groups
            ), f"group clash between {sa} and {sb} at {shared}"
