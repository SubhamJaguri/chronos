"""Shared database test fixtures: in-memory SQLite with enforced foreign keys."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import date

import pytest
from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import Session as OrmSession

from chronos.core.domain import ActivityType
from chronos.db import (
    AcademicTerm,
    AcademicYear,
    Base,
    Branch,
    Department,
    Division,
    Faculty,
    GenerationRun,
    Institution,
    Program,
    Room,
    ScheduledSession,
    Semester,
    SemesterType,
    StudentGroup,
    Subject,
    SubjectOffering,
    TeachingRequirement,
    TimeSlot,
    TimetableVersion,
)


@pytest.fixture()
def engine() -> Iterator[Engine]:
    eng = create_engine("sqlite+pysqlite:///:memory:")

    @event.listens_for(eng, "connect")
    def _enable_fks(dbapi_connection, _record) -> None:  # pragma: no cover - setup
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    Base.metadata.create_all(eng)
    yield eng
    eng.dispose()


@pytest.fixture()
def db(engine: Engine) -> Iterator[OrmSession]:
    with OrmSession(engine) as session:
        yield session


@pytest.fixture()
def seeded(db: OrmSession) -> dict[str, object]:
    """Seed one full chain from institution down to a scheduled session."""
    institution = Institution(code="INDUS", name="Indus University")
    db.add(institution)
    db.flush()
    iid = institution.id

    department = Department(institution_id=iid, code="CSE", name="Computer Engineering")
    year = AcademicYear(
        institution_id=iid,
        label="2026-27",
        start_date=date(2026, 7, 1),
        end_date=date(2027, 6, 30),
    )
    db.add_all([department, year])
    db.flush()

    term = AcademicTerm(institution_id=iid, academic_year_id=year.id, name="ODD 2026")
    db.add(term)
    db.flush()

    semester = Semester(
        institution_id=iid,
        academic_term_id=term.id,
        number=3,
        semester_type=SemesterType.ODD,
    )
    program = Program(institution_id=iid, department_id=department.id, code="BTECH", name="B.Tech")
    db.add_all([semester, program])
    db.flush()

    branch = Branch(institution_id=iid, program_id=program.id, code="CE", name="Computer")
    db.add(branch)
    db.flush()

    division = Division(
        institution_id=iid,
        branch_id=branch.id,
        semester_id=semester.id,
        code="A",
        name="Division A",
    )
    db.add(division)
    db.flush()

    group = StudentGroup(
        institution_id=iid, division_id=division.id, code="A1", name="Batch A1", strength=30
    )
    subject = Subject(
        institution_id=iid, department_id=department.id, code="CS301", name="Data Structures"
    )
    faculty = Faculty(institution_id=iid, code="FAC01", name="Prof. Iyer")
    room = Room(
        institution_id=iid, code="R101", name="Room 101", capacity=60, room_type="classroom"
    )
    slot = TimeSlot(
        institution_id=iid, day=0, period=0, start_minute=540, end_minute=600
    )
    db.add_all([group, subject, faculty, room, slot])
    db.flush()

    offering = SubjectOffering(
        institution_id=iid,
        subject_id=subject.id,
        semester_id=semester.id,
        division_id=division.id,
    )
    db.add(offering)
    db.flush()

    requirement = TeachingRequirement(
        institution_id=iid,
        subject_offering_id=offering.id,
        student_group_id=group.id,
        activity_type=ActivityType.LECTURE,
        sessions_per_week=3,
    )
    run = GenerationRun(institution_id=iid, semester_id=semester.id)
    db.add_all([requirement, run])
    db.flush()

    version = TimetableVersion(
        institution_id=iid,
        semester_id=semester.id,
        generation_run_id=run.id,
        version_number=1,
    )
    db.add(version)
    db.flush()

    scheduled = ScheduledSession(
        institution_id=iid,
        timetable_version_id=version.id,
        teaching_requirement_id=requirement.id,
        faculty_id=faculty.id,
        room_id=room.id,
        time_slot_id=slot.id,
    )
    db.add(scheduled)
    db.flush()

    return {
        "institution": institution,
        "department": department,
        "year": year,
        "term": term,
        "semester": semester,
        "program": program,
        "branch": branch,
        "division": division,
        "group": group,
        "subject": subject,
        "faculty": faculty,
        "room": room,
        "slot": slot,
        "offering": offering,
        "requirement": requirement,
        "run": run,
        "version": version,
        "scheduled": scheduled,
    }
