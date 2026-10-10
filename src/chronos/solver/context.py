"""Indexed, hierarchy-resolved view of a Problem for the solver.

Builds lookup tables, resolves the student-group parent/child hierarchy down
to conflict "leaves", computes combined group strengths, and separates locked
placements (hard) from previous placements (soft disruption preferences).
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field

from chronos.core.domain import (
    Faculty,
    Placement,
    Problem,
    Room,
    Session,
    StudentGroup,
    TimeSlot,
)


@dataclass
class ProblemContext:
    problem: Problem
    slots_by_id: dict[str, TimeSlot]
    rooms_by_id: dict[str, Room]
    faculty_by_id: dict[str, Faculty]
    groups_by_id: dict[str, StudentGroup]
    sessions_by_id: dict[str, Session]
    days: list[int]
    # Non-break slots per day, sorted by period. These are the only slots a
    # session may ever occupy.
    day_teaching_slots: dict[int, list[TimeSlot]]
    total_teaching_slots: int
    # gid -> {gid} | strict ancestors (parent chain, cycle-safe)
    ancestors: dict[str, frozenset[str]]
    # session id -> the set of conflict leaves the session occupies. Two
    # sessions clash on groups iff their leaf sets intersect; sibling batches
    # map to different leaves and therefore never clash with each other.
    session_leaves: dict[str, frozenset[str]]
    # session id -> combined strength of its groups (nested groups deduplicated)
    session_strength: dict[str, int]
    locked_by_session: dict[str, Placement]
    previous_by_session: dict[str, Placement]
    # locked placements whose session_id is unknown: preserved verbatim and
    # treated as opaque reservations of their room/faculty at their slots.
    external_reservations: list[Placement]
    warnings: list[str] = field(default_factory=list)
    fatal: list[str] = field(default_factory=list)


def _ancestor_chain(
    gid: str, groups: dict[str, StudentGroup], warnings: list[str]
) -> frozenset[str]:
    chain = {gid}
    cur = groups.get(gid)
    while cur is not None and cur.parent_id is not None:
        if cur.parent_id in chain:
            warnings.append(
                f"WARNING: student group hierarchy contains a cycle at '{cur.parent_id}'; "
                "the chain was truncated there."
            )
            break
        chain.add(cur.parent_id)
        cur = groups.get(cur.parent_id)
    return frozenset(chain)


def build_context(problem: Problem) -> ProblemContext:
    warnings: list[str] = []
    fatal: list[str] = []

    slots_by_id: dict[str, TimeSlot] = {}
    for s in problem.slots:
        if s.id in slots_by_id:
            warnings.append(
                f"WARNING: duplicate time slot id '{s.id}'; the first definition is used."
            )
            continue
        slots_by_id[s.id] = s

    rooms_by_id = {r.id: r for r in problem.rooms}
    faculty_by_id = {f.id: f for f in problem.faculty}
    groups_by_id = {g.id: g for g in problem.groups}

    sessions_by_id: dict[str, Session] = {}
    for sess in problem.sessions:
        if sess.id in sessions_by_id:
            fatal.append(f"PROVEN: duplicate session id '{sess.id}' in the problem input.")
            continue
        sessions_by_id[sess.id] = sess

    days = sorted({s.day for s in slots_by_id.values()})
    day_teaching_slots: dict[int, list[TimeSlot]] = {
        d: sorted(
            (s for s in slots_by_id.values() if s.day == d and not s.is_break),
            key=lambda s: s.period,
        )
        for d in days
    }
    total_teaching = sum(len(v) for v in day_teaching_slots.values())

    # --- group hierarchy -------------------------------------------------
    ancestors: dict[str, frozenset[str]] = {
        gid: _ancestor_chain(gid, groups_by_id, warnings) for gid in sorted(groups_by_id)
    }
    children: dict[str, list[str]] = defaultdict(list)
    for g in problem.groups:
        if g.parent_id is not None:
            children[g.parent_id].append(g.id)

    def leaves_under(gid: str) -> frozenset[str]:
        if gid not in groups_by_id:
            return frozenset({gid})  # synthetic leaf for an unknown group id
        out: set[str] = set()
        stack, seen = [gid], set()
        while stack:
            cur = stack.pop()
            if cur in seen:
                continue
            seen.add(cur)
            kids = children.get(cur, [])
            if kids:
                stack.extend(kids)
            else:
                out.add(cur)
        return frozenset(out)

    session_leaves: dict[str, frozenset[str]] = {}
    session_strength: dict[str, int] = {}
    for sid in sorted(sessions_by_id):
        sess = sessions_by_id[sid]
        leaves: set[str] = set()
        for gid in sorted(sess.group_ids):
            if gid not in groups_by_id:
                warnings.append(
                    f"WARNING: session '{sid}' references unknown student group '{gid}'; "
                    "it is treated as an independent group of strength 0."
                )
            leaves |= leaves_under(gid)
        session_leaves[sid] = frozenset(leaves)

        # Combined strength: sum only the topmost groups so a session listing
        # both a parent division and one of its child batches is not counted twice.
        strength = 0
        for gid in sorted(sess.group_ids):
            grp = groups_by_id.get(gid)
            if grp is None:
                continue
            anc = ancestors.get(gid, frozenset({gid})) - {gid}
            if anc & sess.group_ids:
                continue  # an ancestor is also listed; it already covers this group
            strength += grp.strength
        session_strength[sid] = strength

    # --- locked / previous placements ------------------------------------
    locked_by_session: dict[str, Placement] = {}
    previous_by_session: dict[str, Placement] = {}
    external_reservations: list[Placement] = []
    for p in problem.locked_placements:
        if p.locked:
            if p.session_id not in sessions_by_id:
                warnings.append(
                    f"WARNING: locked placement references unknown session '{p.session_id}'; "
                    "it is preserved verbatim and treated as an opaque room/faculty reservation."
                )
                external_reservations.append(p)
                continue
            existing = locked_by_session.get(p.session_id)
            if existing is not None and existing != p:
                fatal.append(
                    f"PROVEN: session '{p.session_id}' has two contradictory locked placements."
                )
                continue
            locked_by_session[p.session_id] = p
        else:
            if p.session_id not in sessions_by_id:
                warnings.append(
                    f"WARNING: previous (unlocked) placement references unknown session "
                    f"'{p.session_id}'; it is ignored."
                )
                continue
            previous_by_session[p.session_id] = p

    return ProblemContext(
        problem=problem,
        slots_by_id=slots_by_id,
        rooms_by_id=rooms_by_id,
        faculty_by_id=faculty_by_id,
        groups_by_id=groups_by_id,
        sessions_by_id=sessions_by_id,
        days=days,
        day_teaching_slots=day_teaching_slots,
        total_teaching_slots=total_teaching,
        ancestors=ancestors,
        session_leaves=session_leaves,
        session_strength=session_strength,
        locked_by_session=locked_by_session,
        previous_by_session=previous_by_session,
        external_reservations=external_reservations,
        warnings=warnings,
        fatal=fatal,
    )
