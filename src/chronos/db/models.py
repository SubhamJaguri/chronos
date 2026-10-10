"""Normalized academic schema for Chronos (requirements.md section 5).

Every institution-owned table carries an ``institution_id`` scope column with a
real foreign key, so cross-institution isolation can be enforced later. All
primary keys are stable UUID4 surrogate strings; codes and display names are
attributes, never keys.
"""

from __future__ import annotations

import enum
from datetime import date, datetime

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from chronos.core.domain import ActivityType, Severity
from chronos.db.base import Base, created_at_col, institution_fk, uuid_pk


class SemesterType(enum.StrEnum):
    ODD = "ODD"
    EVEN = "EVEN"


class ApprovalStatus(enum.StrEnum):
    DRAFT = "draft"
    IN_REVIEW = "in_review"
    APPROVED = "approved"
    PUBLISHED = "published"
    REJECTED = "rejected"


class GenerationStatus(enum.StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    TIMED_OUT = "timed_out"


def _str_enum(enum_cls: type[enum.Enum]) -> Enum:
    """Store enums as constrained VARCHAR values, portable across PG and SQLite."""
    return Enum(
        enum_cls,
        native_enum=False,
        length=32,
        values_callable=lambda e: [member.value for member in e],
    )


class Institution(Base):
    __tablename__ = "institution"

    id: Mapped[str] = uuid_pk()
    code: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    timezone: Mapped[str] = mapped_column(String(64), nullable=False, default="Asia/Kolkata")
    created_at: Mapped[datetime] = created_at_col()


class Department(Base):
    __tablename__ = "department"
    __table_args__ = (UniqueConstraint("institution_id", "code"),)

    id: Mapped[str] = uuid_pk()
    institution_id: Mapped[str] = institution_fk()
    code: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = created_at_col()


class AcademicYear(Base):
    __tablename__ = "academic_year"
    __table_args__ = (
        UniqueConstraint("institution_id", "label"),
        CheckConstraint("end_date > start_date", name="year_dates_ordered"),
    )

    id: Mapped[str] = uuid_pk()
    institution_id: Mapped[str] = institution_fk()
    label: Mapped[str] = mapped_column(String(32), nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    created_at: Mapped[datetime] = created_at_col()


class AcademicTerm(Base):
    __tablename__ = "academic_term"
    __table_args__ = (UniqueConstraint("academic_year_id", "name"),)

    id: Mapped[str] = uuid_pk()
    institution_id: Mapped[str] = institution_fk()
    academic_year_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("academic_year.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    start_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)
    created_at: Mapped[datetime] = created_at_col()


class Semester(Base):
    __tablename__ = "semester"
    __table_args__ = (
        UniqueConstraint("academic_term_id", "number"),
        CheckConstraint("number >= 1", name="number_positive"),
    )

    id: Mapped[str] = uuid_pk()
    institution_id: Mapped[str] = institution_fk()
    academic_term_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("academic_term.id", ondelete="CASCADE"), nullable=False, index=True
    )
    number: Mapped[int] = mapped_column(Integer, nullable=False)
    semester_type: Mapped[SemesterType] = mapped_column(_str_enum(SemesterType), nullable=False)
    created_at: Mapped[datetime] = created_at_col()


class Program(Base):
    __tablename__ = "program"
    __table_args__ = (UniqueConstraint("department_id", "code"),)

    id: Mapped[str] = uuid_pk()
    institution_id: Mapped[str] = institution_fk()
    department_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("department.id", ondelete="CASCADE"), nullable=False, index=True
    )
    code: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = created_at_col()


class Branch(Base):
    __tablename__ = "branch"
    __table_args__ = (UniqueConstraint("program_id", "code"),)

    id: Mapped[str] = uuid_pk()
    institution_id: Mapped[str] = institution_fk()
    program_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("program.id", ondelete="CASCADE"), nullable=False, index=True
    )
    code: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = created_at_col()


class Division(Base):
    __tablename__ = "division"
    __table_args__ = (UniqueConstraint("branch_id", "semester_id", "code"),)

    id: Mapped[str] = uuid_pk()
    institution_id: Mapped[str] = institution_fk()
    branch_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("branch.id", ondelete="CASCADE"), nullable=False, index=True
    )
    semester_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("semester.id", ondelete="CASCADE"), nullable=False, index=True
    )
    code: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = created_at_col()


class StudentGroup(Base):
    """A batch or sub-group within a division (or the whole division itself)."""

    __tablename__ = "student_group"
    __table_args__ = (
        UniqueConstraint("division_id", "code"),
        CheckConstraint("strength >= 0", name="strength_non_negative"),
    )

    id: Mapped[str] = uuid_pk()
    institution_id: Mapped[str] = institution_fk()
    division_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("division.id", ondelete="CASCADE"), nullable=False, index=True
    )
    parent_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("student_group.id", ondelete="SET NULL")
    )
    code: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    strength: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = created_at_col()


class Subject(Base):
    __tablename__ = "subject"
    __table_args__ = (UniqueConstraint("institution_id", "code"),)

    id: Mapped[str] = uuid_pk()
    institution_id: Mapped[str] = institution_fk()
    department_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("department.id", ondelete="CASCADE"), nullable=False, index=True
    )
    code: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = created_at_col()


class SubjectOffering(Base):
    """A subject taught to a specific division in a specific semester."""

    __tablename__ = "subject_offering"
    __table_args__ = (UniqueConstraint("subject_id", "semester_id", "division_id"),)

    id: Mapped[str] = uuid_pk()
    institution_id: Mapped[str] = institution_fk()
    subject_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("subject.id", ondelete="CASCADE"), nullable=False, index=True
    )
    semester_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("semester.id", ondelete="CASCADE"), nullable=False, index=True
    )
    division_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("division.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_at: Mapped[datetime] = created_at_col()


class Faculty(Base):
    __tablename__ = "faculty"
    __table_args__ = (UniqueConstraint("institution_id", "code"),)

    id: Mapped[str] = uuid_pk()
    institution_id: Mapped[str] = institution_fk()
    department_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("department.id", ondelete="SET NULL"), index=True
    )
    code: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str | None] = mapped_column(String(255))
    max_periods_per_day: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = created_at_col()


class FacultySubjectAssignment(Base):
    __tablename__ = "faculty_subject_assignment"
    __table_args__ = (UniqueConstraint("faculty_id", "subject_offering_id"),)

    id: Mapped[str] = uuid_pk()
    institution_id: Mapped[str] = institution_fk()
    faculty_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("faculty.id", ondelete="CASCADE"), nullable=False, index=True
    )
    subject_offering_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("subject_offering.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    created_at: Mapped[datetime] = created_at_col()


class TimeSlot(Base):
    __tablename__ = "time_slot"
    __table_args__ = (
        UniqueConstraint("institution_id", "day", "period"),
        CheckConstraint("day >= 0 AND day <= 6", name="day_in_week"),
        CheckConstraint("period >= 0", name="period_non_negative"),
        CheckConstraint("end_minute > start_minute", name="minutes_ordered"),
    )

    id: Mapped[str] = uuid_pk()
    institution_id: Mapped[str] = institution_fk()
    day: Mapped[int] = mapped_column(Integer, nullable=False)  # 0 = Monday
    period: Mapped[int] = mapped_column(Integer, nullable=False)  # 0-based within the day
    start_minute: Mapped[int] = mapped_column(Integer, nullable=False)
    end_minute: Mapped[int] = mapped_column(Integer, nullable=False)
    is_break: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = created_at_col()


class FacultyAvailability(Base):
    """Explicit per-slot availability override; absent rows mean 'available'."""

    __tablename__ = "faculty_availability"
    __table_args__ = (UniqueConstraint("faculty_id", "time_slot_id"),)

    id: Mapped[str] = uuid_pk()
    institution_id: Mapped[str] = institution_fk()
    faculty_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("faculty.id", ondelete="CASCADE"), nullable=False, index=True
    )
    time_slot_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("time_slot.id", ondelete="CASCADE"), nullable=False, index=True
    )
    is_available: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = created_at_col()


class Room(Base):
    __tablename__ = "room"
    __table_args__ = (
        UniqueConstraint("institution_id", "code"),
        CheckConstraint("capacity >= 0", name="capacity_non_negative"),
    )

    id: Mapped[str] = uuid_pk()
    institution_id: Mapped[str] = institution_fk()
    code: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    capacity: Mapped[int] = mapped_column(Integer, nullable=False)
    room_type: Mapped[str] = mapped_column(String(32), nullable=False)
    facilities: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    created_at: Mapped[datetime] = created_at_col()


class TeachingRequirement(Base):
    """How many sessions per week a subject offering needs for a student group."""

    __tablename__ = "teaching_requirement"
    __table_args__ = (
        UniqueConstraint("subject_offering_id", "student_group_id", "activity_type"),
        CheckConstraint("sessions_per_week >= 1", name="sessions_positive"),
        CheckConstraint("duration_periods >= 1", name="duration_positive"),
    )

    id: Mapped[str] = uuid_pk()
    institution_id: Mapped[str] = institution_fk()
    subject_offering_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("subject_offering.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    student_group_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("student_group.id", ondelete="CASCADE"), nullable=False, index=True
    )
    activity_type: Mapped[ActivityType] = mapped_column(_str_enum(ActivityType), nullable=False)
    sessions_per_week: Mapped[int] = mapped_column(Integer, nullable=False)
    duration_periods: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    requires_consecutive: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = created_at_col()


class GenerationRun(Base):
    __tablename__ = "generation_run"

    id: Mapped[str] = uuid_pk()
    institution_id: Mapped[str] = institution_fk()
    semester_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("semester.id", ondelete="CASCADE"), nullable=False, index=True
    )
    status: Mapped[GenerationStatus] = mapped_column(
        _str_enum(GenerationStatus), nullable=False, default=GenerationStatus.PENDING
    )
    solver_status: Mapped[str | None] = mapped_column(String(32))
    input_fingerprint: Mapped[str | None] = mapped_column(String(128))
    diagnostics: Mapped[list[str] | None] = mapped_column(JSON)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = created_at_col()


class TimetableVersion(Base):
    __tablename__ = "timetable_version"
    __table_args__ = (UniqueConstraint("semester_id", "version_number"),)

    id: Mapped[str] = uuid_pk()
    institution_id: Mapped[str] = institution_fk()
    semester_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("semester.id", ondelete="CASCADE"), nullable=False, index=True
    )
    generation_run_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("generation_run.id", ondelete="SET NULL"), index=True
    )
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    label: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = created_at_col()


class ScheduledSession(Base):
    """One placed session inside a timetable version.

    ``time_slot_id`` is the starting slot; multi-period sessions span
    ``duration_periods`` consecutive periods from there. The unique constraints
    stop double-booking of a room or a faculty member at the same start slot
    within one version; full overlap checking is the validator's job.
    """

    __tablename__ = "scheduled_session"
    __table_args__ = (
        UniqueConstraint("timetable_version_id", "room_id", "time_slot_id"),
        UniqueConstraint("timetable_version_id", "faculty_id", "time_slot_id"),
        CheckConstraint("duration_periods >= 1", name="duration_positive"),
    )

    id: Mapped[str] = uuid_pk()
    institution_id: Mapped[str] = institution_fk()
    timetable_version_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("timetable_version.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    teaching_requirement_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("teaching_requirement.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    faculty_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("faculty.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    room_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("room.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    time_slot_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("time_slot.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    duration_periods: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime] = created_at_col()


class SessionLock(Base):
    __tablename__ = "session_lock"
    __table_args__ = (UniqueConstraint("scheduled_session_id"),)

    id: Mapped[str] = uuid_pk()
    institution_id: Mapped[str] = institution_fk()
    scheduled_session_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("scheduled_session.id", ondelete="CASCADE"), nullable=False
    )
    locked_by: Mapped[str] = mapped_column(String(255), nullable=False)
    reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = created_at_col()


class ValidationFinding(Base):
    __tablename__ = "validation_finding"

    id: Mapped[str] = uuid_pk()
    institution_id: Mapped[str] = institution_fk()
    timetable_version_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("timetable_version.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    generation_run_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("generation_run.id", ondelete="SET NULL"), index=True
    )
    rule_id: Mapped[str] = mapped_column(String(64), nullable=False)
    severity: Mapped[Severity] = mapped_column(_str_enum(Severity), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    session_ids: Mapped[list[str] | None] = mapped_column(JSON)
    slot_ids: Mapped[list[str] | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = created_at_col()


class ApprovalState(Base):
    __tablename__ = "approval_state"
    __table_args__ = (UniqueConstraint("timetable_version_id"),)

    id: Mapped[str] = uuid_pk()
    institution_id: Mapped[str] = institution_fk()
    timetable_version_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("timetable_version.id", ondelete="CASCADE"), nullable=False
    )
    status: Mapped[ApprovalStatus] = mapped_column(
        _str_enum(ApprovalStatus), nullable=False, default=ApprovalStatus.DRAFT
    )
    changed_by: Mapped[str] = mapped_column(String(255), nullable=False)
    changed_at: Mapped[datetime] = created_at_col()


class AuditEvent(Base):
    __tablename__ = "audit_event"

    id: Mapped[str] = uuid_pk()
    institution_id: Mapped[str] = institution_fk()
    actor: Mapped[str] = mapped_column(String(255), nullable=False)
    action: Mapped[str] = mapped_column(String(128), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(128), nullable=False)
    entity_id: Mapped[str | None] = mapped_column(String(36))
    payload: Mapped[dict | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = created_at_col()
