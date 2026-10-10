"""Soft-rule scoring (requirements.md section 8, 'Soft constraints').

Soft rules describe a timetable that is valid but not ideal.  Every finding
here carries severity WARNING - never ERROR - so soft preferences can never
block publication on their own.
"""
from __future__ import annotations

from collections import defaultdict

import chronos.validator.rule_ids as rule_ids
from chronos.core.domain import Finding, Severity
from chronos.validator.context import ValidationContext, day_name, sentence_case

#: A faculty member's busiest teaching day exceeding their lightest teaching
#: day by this many periods is reported as imbalance.
WORKLOAD_IMBALANCE_THRESHOLD = 3


def _warning(rule_id, message, session_ids=(), slot_ids=()):
    return Finding(
        rule_id=rule_id,
        severity=Severity.WARNING,
        message=message,
        session_ids=tuple(session_ids),
        slot_ids=tuple(slot_ids),
    )


def check_subject_clustering(ctx: ValidationContext) -> list[Finding]:
    """Multiple separate sessions of one subject for one group on one day.

    A single multi-period session (e.g. a 2-period lab) is not clustering;
    only distinct sessions of the same subject landing on the same day are.
    """
    sessions_by_key: dict[tuple[str, str, int], set[str]] = defaultdict(set)
    slots_by_key: dict[tuple[str, str, int], set[str]] = defaultdict(set)
    for p in ctx.placements:
        session = ctx.sessions_by_id.get(p.session_id)
        if session is None:
            continue
        for slot in ctx.known_slots(p):
            for gid in session.group_ids:
                key = (gid, session.subject_id, slot.day)
                sessions_by_key[key].add(p.session_id)
                slots_by_key[key].add(slot.id)
    findings: list[Finding] = []
    for (gid, subject_id, day), session_ids in sorted(sessions_by_key.items()):
        if len(session_ids) < 2:
            continue
        any_session = ctx.sessions_by_id[next(iter(session_ids))]
        findings.append(
            _warning(
                rule_ids.SUBJECT_CLUSTER,
                f"Subject '{any_session.subject_name}' has {len(session_ids)}"
                f" separate sessions for {ctx.group_label(gid)} on"
                f" {day_name(day)}, which clusters the subject."
                " Suggested: spread these sessions across different days.",
                session_ids=tuple(sorted(session_ids)),
                slot_ids=tuple(sorted(slots_by_key[(gid, subject_id, day)])),
            )
        )
    return findings


def _gap_findings(
    ctx: ValidationContext,
    rule_id: str,
    owner_label: str,
    occupied: dict[int, set[int]],
    sessions_by_day: dict[int, set[str]],
) -> list[Finding]:
    """Shared gap detection: an idle teaching period strictly between the first
    and last occupied period of a day.  Break periods are not gaps."""
    findings: list[Finding] = []
    for day, periods in sorted(occupied.items()):
        if len(periods) < 2:
            continue
        gap_slots = [
            slot
            for q in range(min(periods) + 1, max(periods))
            if q not in periods
            and (slot := ctx.slot_by_day_period.get((day, q))) is not None
            and not slot.is_break
        ]
        if not gap_slots:
            continue
        listed = ", ".join(ctx.slot_label(s.id) for s in gap_slots)
        findings.append(
            _warning(
                rule_id,
                f"{owner_label} has {len(gap_slots)} idle gap period(s) on"
                f" {day_name(day)}: {listed}."
                " Suggested: compact the day's sessions to remove the gap.",
                session_ids=tuple(sorted(sessions_by_day.get(day, ()))),
                slot_ids=tuple(s.id for s in gap_slots),
            )
        )
    return findings


def check_group_gaps(ctx: ValidationContext) -> list[Finding]:
    """Idle gaps in a student group's day.

    Computed for leaf groups (the finest unit students belong to), counting
    every session the group attends directly or through an ancestor division.
    """
    findings: list[Finding] = []
    for gid in ctx.leaf_group_ids:
        occupied: dict[int, set[int]] = defaultdict(set)
        sessions_by_day: dict[int, set[str]] = defaultdict(set)
        for p in ctx.placements:
            session = ctx.sessions_by_id.get(p.session_id)
            if session is None or not ctx.group_attends(gid, session.group_ids):
                continue
            for slot in ctx.known_slots(p):
                occupied[slot.day].add(slot.period)
                sessions_by_day[slot.day].add(p.session_id)
        findings.extend(
            _gap_findings(
                ctx,
                rule_ids.GROUP_GAPS,
                sentence_case(ctx.group_label(gid)),
                occupied,
                sessions_by_day,
            )
        )
    return findings


def check_faculty_gaps(ctx: ValidationContext) -> list[Finding]:
    """Idle gaps in a faculty member's teaching day."""
    occupied: dict[str, dict[int, set[int]]] = defaultdict(lambda: defaultdict(set))
    sessions_by_day: dict[str, dict[int, set[str]]] = defaultdict(lambda: defaultdict(set))
    for p in ctx.placements:
        for slot in ctx.known_slots(p):
            occupied[p.faculty_id][slot.day].add(slot.period)
            sessions_by_day[p.faculty_id][slot.day].add(p.session_id)
    findings: list[Finding] = []
    for faculty_id in sorted(occupied):
        if faculty_id not in ctx.faculty_by_id:
            continue  # unknown faculty already reported as H-ORPHAN-FACULTY
        findings.extend(
            _gap_findings(
                ctx,
                rule_ids.FACULTY_GAPS,
                sentence_case(ctx.faculty_label(faculty_id)),
                occupied[faculty_id],
                sessions_by_day[faculty_id],
            )
        )
    return findings


def check_workload_balance(ctx: ValidationContext) -> list[Finding]:
    """Faculty workload spread across their teaching days (section 8:
    'Balance faculty workload across days')."""
    load: dict[str, dict[int, set[str]]] = defaultdict(lambda: defaultdict(set))
    sessions_by_day: dict[str, dict[int, set[str]]] = defaultdict(lambda: defaultdict(set))
    for p in ctx.placements:
        for slot in ctx.known_slots(p):
            load[p.faculty_id][slot.day].add(slot.id)
            sessions_by_day[p.faculty_id][slot.day].add(p.session_id)
    findings: list[Finding] = []
    for faculty_id in sorted(load):
        if faculty_id not in ctx.faculty_by_id:
            continue
        per_day = {day: len(slots) for day, slots in load[faculty_id].items()}
        if len(per_day) < 2:
            continue
        busiest = max(per_day, key=lambda d: (per_day[d], -d))
        lightest = min(per_day, key=lambda d: (per_day[d], d))
        if per_day[busiest] - per_day[lightest] < WORKLOAD_IMBALANCE_THRESHOLD:
            continue
        involved = sessions_by_day[faculty_id][busiest] | sessions_by_day[faculty_id][lightest]
        findings.append(
            _warning(
                rule_ids.WORKLOAD_IMBALANCE,
                f"{sentence_case(ctx.faculty_label(faculty_id))} has an uneven"
                f" weekly load: {per_day[busiest]} periods on"
                f" {day_name(busiest)} but only {per_day[lightest]} on"
                f" {day_name(lightest)}."
                f" Suggested: move a session from {day_name(busiest)} to"
                f" {day_name(lightest)}.",
                session_ids=tuple(sorted(involved)),
                slot_ids=tuple(sorted(load[faculty_id][busiest])),
            )
        )
    return findings


ALL_CHECKS = (
    check_subject_clustering,
    check_group_gaps,
    check_faculty_gaps,
    check_workload_balance,
)
