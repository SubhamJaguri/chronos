"""Schema constraint tests: foreign keys hold and unique constraints bite."""

from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as OrmSession

from chronos.core.domain import Severity
from chronos.db import (
    Base,
    Department,
    Division,
    Faculty,
    Institution,
    ScheduledSession,
    SessionLock,
    Subject,
    TimeSlot,
    ValidationFinding,
)


def test_all_tables_created(engine) -> None:
    expected = {
        "institution",
        "department",
        "academic_year",
        "academic_term",
        "semester",
        "program",
        "branch",
        "division",
        "student_group",
        "subject",
        "subject_offering",
        "faculty",
        "faculty_subject_assignment",
        "faculty_availability",
        "room",
        "time_slot",
        "teaching_requirement",
        "scheduled_session",
        "session_lock",
        "generation_run",
        "validation_finding",
        "timetable_version",
        "approval_state",
        "audit_event",
    }
    assert set(Base.metadata.tables) == expected


def test_every_owned_table_is_institution_scoped() -> None:
    for name, table in Base.metadata.tables.items():
        if name == "institution":
            continue
        assert "institution_id" in table.c, f"{name} is missing the institution scope column"
        fks = {fk.column.table.name for fk in table.c.institution_id.foreign_keys}
        assert fks == {"institution"}, f"{name}.institution_id must reference institution.id"


def test_foreign_key_holds_on_insert(db: OrmSession) -> None:
    db.add(Department(institution_id="no-such-institution", code="CSE", name="CSE"))
    with pytest.raises(IntegrityError):
        db.flush()


def test_foreign_key_holds_deep_in_chain(db: OrmSession, seeded: dict) -> None:
    db.add(
        SessionLock(
            institution_id=seeded["institution"].id,
            scheduled_session_id="no-such-session",
            locked_by="hod@example.edu",
        )
    )
    with pytest.raises(IntegrityError):
        db.flush()


def test_institution_code_unique(db: OrmSession) -> None:
    db.add(Institution(code="INDUS", name="Indus University"))
    db.flush()
    db.add(Institution(code="INDUS", name="Duplicate"))
    with pytest.raises(IntegrityError):
        db.flush()


def test_department_code_unique_per_institution(db: OrmSession, seeded: dict) -> None:
    db.add(
        Department(institution_id=seeded["institution"].id, code="CSE", name="Copycat")
    )
    with pytest.raises(IntegrityError):
        db.flush()


def test_subject_code_unique_per_institution(db: OrmSession, seeded: dict) -> None:
    db.add(
        Subject(
            institution_id=seeded["institution"].id,
            department_id=seeded["department"].id,
            code="CS301",
            name="Copycat Subject",
        )
    )
    with pytest.raises(IntegrityError):
        db.flush()


def test_time_slot_unique_per_day_period(db: OrmSession, seeded: dict) -> None:
    db.add(
        TimeSlot(
            institution_id=seeded["institution"].id,
            day=0,
            period=0,
            start_minute=540,
            end_minute=600,
        )
    )
    with pytest.raises(IntegrityError):
        db.flush()


def test_room_double_booking_rejected(db: OrmSession, seeded: dict) -> None:
    """Same version, same room, same start slot: the unique constraint bites."""
    other_faculty = Faculty(
        institution_id=seeded["institution"].id, code="FAC02", name="Prof. Rao"
    )
    db.add(other_faculty)
    db.flush()
    db.add(
        ScheduledSession(
            institution_id=seeded["institution"].id,
            timetable_version_id=seeded["version"].id,
            teaching_requirement_id=seeded["requirement"].id,
            faculty_id=other_faculty.id,
            room_id=seeded["room"].id,
            time_slot_id=seeded["slot"].id,
        )
    )
    with pytest.raises(IntegrityError):
        db.flush()


def test_session_lock_unique_per_session(db: OrmSession, seeded: dict) -> None:
    iid = seeded["institution"].id
    db.add(
        SessionLock(
            institution_id=iid,
            scheduled_session_id=seeded["scheduled"].id,
            locked_by="hod@example.edu",
        )
    )
    db.flush()
    db.add(
        SessionLock(
            institution_id=iid,
            scheduled_session_id=seeded["scheduled"].id,
            locked_by="admin@example.edu",
        )
    )
    with pytest.raises(IntegrityError):
        db.flush()


def test_timetable_version_number_unique_per_semester(db: OrmSession, seeded: dict) -> None:
    from chronos.db import TimetableVersion

    db.add(
        TimetableVersion(
            institution_id=seeded["institution"].id,
            semester_id=seeded["semester"].id,
            version_number=1,
        )
    )
    with pytest.raises(IntegrityError):
        db.flush()


def test_cascade_delete_from_institution(db: OrmSession, seeded: dict) -> None:
    db.delete(seeded["institution"])
    db.flush()
    assert db.scalars(select(Department)).all() == []
    assert db.scalars(select(Division)).all() == []
    assert db.scalars(select(ScheduledSession)).all() == []


def test_validation_finding_roundtrip(db: OrmSession, seeded: dict) -> None:
    finding = ValidationFinding(
        institution_id=seeded["institution"].id,
        timetable_version_id=seeded["version"].id,
        rule_id="faculty-clash",
        severity=Severity.ERROR,
        message="Prof. Iyer is double-booked on Monday period 1",
        session_ids=["ses-1", "ses-2"],
    )
    db.add(finding)
    db.flush()
    db.expire(finding)
    assert finding.severity is Severity.ERROR
    assert finding.session_ids == ["ses-1", "ses-2"]
