/**
 * Normalized academic schema for Chronos (requirements.md section 5).
 *
 * Conventions, ported from the Python prototype:
 * - Surrogate primary keys are UUIDs, never display names or codes.
 * - Every institution-owned table carries an `institution_id` scope column
 *   with a real foreign key, so cross-institution isolation can be enforced
 *   without a schema rewrite.
 * - Codes and display names are attributes with unique constraints inside
 *   their natural scope; they are never used as join keys.
 */

import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

export const semesterTypeEnum = pgEnum("semester_type", ["ODD", "EVEN"]);

export const activityTypeEnum = pgEnum("activity_type", [
  "lecture",
  "lab",
  "practical",
  "elective",
  "project",
  "library",
  "fixed",
]);

export const roomTypeEnum = pgEnum("room_type", ["classroom", "lab", "auditorium"]);

export const generationStatusEnum = pgEnum("generation_status", [
  "pending",
  "running",
  "succeeded",
  "failed",
  "timed_out",
]);

export const approvalStatusEnum = pgEnum("approval_status", [
  "draft",
  "in_review",
  "approved",
  "published",
  "rejected",
]);

export const severityEnum = pgEnum("severity", ["error", "warning"]);

// ---------------------------------------------------------------------------
// Shared column builders
// ---------------------------------------------------------------------------

const id = () => uuid("id").primaryKey().defaultRandom();

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

/** Tenant scope column; present on every institution-owned table. */
const institutionId = () =>
  uuid("institution_id")
    .notNull()
    .references(() => institution.id, { onDelete: "cascade" });

// ---------------------------------------------------------------------------
// Institutional structure
// ---------------------------------------------------------------------------

export const institution = pgTable("institution", {
  id: id(),
  code: varchar("code", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  timezone: varchar("timezone", { length: 64 }).notNull().default("Asia/Kolkata"),
  createdAt: createdAt(),
});

export const department = pgTable(
  "department",
  {
    id: id(),
    institutionId: institutionId(),
    code: varchar("code", { length: 64 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.institutionId, t.code),
    index("ix_department_institution_id").on(t.institutionId),
  ],
);

export const academicYear = pgTable(
  "academic_year",
  {
    id: id(),
    institutionId: institutionId(),
    label: varchar("label", { length: 32 }).notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.institutionId, t.label),
    check("year_dates_ordered", sql`${t.endDate} > ${t.startDate}`),
    index("ix_academic_year_institution_id").on(t.institutionId),
  ],
);

export const academicTerm = pgTable(
  "academic_term",
  {
    id: id(),
    institutionId: institutionId(),
    academicYearId: uuid("academic_year_id")
      .notNull()
      .references(() => academicYear.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 64 }).notNull(),
    startDate: date("start_date"),
    endDate: date("end_date"),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.academicYearId, t.name),
    index("ix_academic_term_institution_id").on(t.institutionId),
    index("ix_academic_term_academic_year_id").on(t.academicYearId),
  ],
);

export const semester = pgTable(
  "semester",
  {
    id: id(),
    institutionId: institutionId(),
    academicTermId: uuid("academic_term_id")
      .notNull()
      .references(() => academicTerm.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    semesterType: semesterTypeEnum("semester_type").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.academicTermId, t.number),
    check("number_positive", sql`${t.number} >= 1`),
    index("ix_semester_institution_id").on(t.institutionId),
    index("ix_semester_academic_term_id").on(t.academicTermId),
  ],
);

export const program = pgTable(
  "program",
  {
    id: id(),
    institutionId: institutionId(),
    departmentId: uuid("department_id")
      .notNull()
      .references(() => department.id, { onDelete: "cascade" }),
    code: varchar("code", { length: 64 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.departmentId, t.code),
    index("ix_program_institution_id").on(t.institutionId),
    index("ix_program_department_id").on(t.departmentId),
  ],
);

export const branch = pgTable(
  "branch",
  {
    id: id(),
    institutionId: institutionId(),
    programId: uuid("program_id")
      .notNull()
      .references(() => program.id, { onDelete: "cascade" }),
    code: varchar("code", { length: 64 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.programId, t.code),
    index("ix_branch_institution_id").on(t.institutionId),
    index("ix_branch_program_id").on(t.programId),
  ],
);

export const division = pgTable(
  "division",
  {
    id: id(),
    institutionId: institutionId(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branch.id, { onDelete: "cascade" }),
    semesterId: uuid("semester_id")
      .notNull()
      .references(() => semester.id, { onDelete: "cascade" }),
    code: varchar("code", { length: 64 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.branchId, t.semesterId, t.code),
    index("ix_division_institution_id").on(t.institutionId),
    index("ix_division_branch_id").on(t.branchId),
    index("ix_division_semester_id").on(t.semesterId),
  ],
);

/** A batch or sub-group within a division (or the whole division itself). */
export const studentGroup = pgTable(
  "student_group",
  {
    id: id(),
    institutionId: institutionId(),
    divisionId: uuid("division_id")
      .notNull()
      .references(() => division.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id").references((): AnyPgColumn => studentGroup.id, {
      onDelete: "set null",
    }),
    code: varchar("code", { length: 64 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    strength: integer("strength").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.divisionId, t.code),
    check("strength_non_negative", sql`${t.strength} >= 0`),
    index("ix_student_group_institution_id").on(t.institutionId),
    index("ix_student_group_division_id").on(t.divisionId),
  ],
);

// ---------------------------------------------------------------------------
// Subjects, faculty, rooms, time slots
// ---------------------------------------------------------------------------

export const subject = pgTable(
  "subject",
  {
    id: id(),
    institutionId: institutionId(),
    departmentId: uuid("department_id")
      .notNull()
      .references(() => department.id, { onDelete: "cascade" }),
    code: varchar("code", { length: 64 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.institutionId, t.code),
    index("ix_subject_department_id").on(t.departmentId),
  ],
);

/** A subject taught to a specific division in a specific semester. */
export const subjectOffering = pgTable(
  "subject_offering",
  {
    id: id(),
    institutionId: institutionId(),
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => subject.id, { onDelete: "cascade" }),
    semesterId: uuid("semester_id")
      .notNull()
      .references(() => semester.id, { onDelete: "cascade" }),
    divisionId: uuid("division_id")
      .notNull()
      .references(() => division.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.subjectId, t.semesterId, t.divisionId),
    index("ix_subject_offering_institution_id").on(t.institutionId),
    index("ix_subject_offering_subject_id").on(t.subjectId),
    index("ix_subject_offering_semester_id").on(t.semesterId),
    index("ix_subject_offering_division_id").on(t.divisionId),
  ],
);

export const faculty = pgTable(
  "faculty",
  {
    id: id(),
    institutionId: institutionId(),
    departmentId: uuid("department_id").references(() => department.id, {
      onDelete: "set null",
    }),
    code: varchar("code", { length: 64 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    email: varchar("email", { length: 255 }),
    maxPeriodsPerDay: integer("max_periods_per_day"),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.institutionId, t.code),
    index("ix_faculty_department_id").on(t.departmentId),
  ],
);

export const facultySubjectAssignment = pgTable(
  "faculty_subject_assignment",
  {
    id: id(),
    institutionId: institutionId(),
    facultyId: uuid("faculty_id")
      .notNull()
      .references(() => faculty.id, { onDelete: "cascade" }),
    subjectOfferingId: uuid("subject_offering_id")
      .notNull()
      .references(() => subjectOffering.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.facultyId, t.subjectOfferingId),
    index("ix_faculty_subject_assignment_institution_id").on(t.institutionId),
    index("ix_faculty_subject_assignment_faculty_id").on(t.facultyId),
    index("ix_faculty_subject_assignment_subject_offering_id").on(t.subjectOfferingId),
  ],
);

export const timeSlot = pgTable(
  "time_slot",
  {
    id: id(),
    institutionId: institutionId(),
    day: integer("day").notNull(), // 0 = Monday
    period: integer("period").notNull(), // 0-based ordinal within the day
    startMinute: integer("start_minute").notNull(),
    endMinute: integer("end_minute").notNull(),
    isBreak: boolean("is_break").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.institutionId, t.day, t.period),
    check("day_in_week", sql`${t.day} >= 0 AND ${t.day} <= 6`),
    check("period_non_negative", sql`${t.period} >= 0`),
    check("minutes_ordered", sql`${t.endMinute} > ${t.startMinute}`),
  ],
);

/** Explicit per-slot availability override; absent rows mean "available". */
export const facultyAvailability = pgTable(
  "faculty_availability",
  {
    id: id(),
    institutionId: institutionId(),
    facultyId: uuid("faculty_id")
      .notNull()
      .references(() => faculty.id, { onDelete: "cascade" }),
    timeSlotId: uuid("time_slot_id")
      .notNull()
      .references(() => timeSlot.id, { onDelete: "cascade" }),
    isAvailable: boolean("is_available").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.facultyId, t.timeSlotId),
    index("ix_faculty_availability_institution_id").on(t.institutionId),
    index("ix_faculty_availability_faculty_id").on(t.facultyId),
    index("ix_faculty_availability_time_slot_id").on(t.timeSlotId),
  ],
);

export const room = pgTable(
  "room",
  {
    id: id(),
    institutionId: institutionId(),
    code: varchar("code", { length: 64 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    capacity: integer("capacity").notNull(),
    roomType: roomTypeEnum("room_type").notNull(),
    facilities: jsonb("facilities").$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.institutionId, t.code),
    check("capacity_non_negative", sql`${t.capacity} >= 0`),
  ],
);

// ---------------------------------------------------------------------------
// Teaching requirements and generated timetables
// ---------------------------------------------------------------------------

/** How many sessions per week a subject offering needs for a student group. */
export const teachingRequirement = pgTable(
  "teaching_requirement",
  {
    id: id(),
    institutionId: institutionId(),
    subjectOfferingId: uuid("subject_offering_id")
      .notNull()
      .references(() => subjectOffering.id, { onDelete: "cascade" }),
    studentGroupId: uuid("student_group_id")
      .notNull()
      .references(() => studentGroup.id, { onDelete: "cascade" }),
    activityType: activityTypeEnum("activity_type").notNull(),
    sessionsPerWeek: integer("sessions_per_week").notNull(),
    durationPeriods: integer("duration_periods").notNull().default(1),
    requiresConsecutive: boolean("requires_consecutive").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.subjectOfferingId, t.studentGroupId, t.activityType),
    check("sessions_positive", sql`${t.sessionsPerWeek} >= 1`),
    check("duration_positive", sql`${t.durationPeriods} >= 1`),
    index("ix_teaching_requirement_institution_id").on(t.institutionId),
    index("ix_teaching_requirement_subject_offering_id").on(t.subjectOfferingId),
    index("ix_teaching_requirement_student_group_id").on(t.studentGroupId),
  ],
);

export const generationRun = pgTable(
  "generation_run",
  {
    id: id(),
    institutionId: institutionId(),
    semesterId: uuid("semester_id")
      .notNull()
      .references(() => semester.id, { onDelete: "cascade" }),
    status: generationStatusEnum("status").notNull().default("pending"),
    solverStatus: varchar("solver_status", { length: 32 }),
    inputFingerprint: varchar("input_fingerprint", { length: 128 }),
    diagnostics: jsonb("diagnostics").$type<string[]>(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("ix_generation_run_institution_id").on(t.institutionId),
    index("ix_generation_run_semester_id").on(t.semesterId),
  ],
);

export const timetableVersion = pgTable(
  "timetable_version",
  {
    id: id(),
    institutionId: institutionId(),
    semesterId: uuid("semester_id")
      .notNull()
      .references(() => semester.id, { onDelete: "cascade" }),
    generationRunId: uuid("generation_run_id").references(() => generationRun.id, {
      onDelete: "set null",
    }),
    versionNumber: integer("version_number").notNull(),
    label: varchar("label", { length: 255 }),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.semesterId, t.versionNumber),
    index("ix_timetable_version_institution_id").on(t.institutionId),
    index("ix_timetable_version_semester_id").on(t.semesterId),
    index("ix_timetable_version_generation_run_id").on(t.generationRunId),
  ],
);

/**
 * One placed session inside a timetable version.
 *
 * `time_slot_id` is the starting slot; multi-period sessions span
 * `duration_periods` consecutive periods from there. The unique constraints
 * stop double-booking of a room or a faculty member at the same start slot
 * within one version; full overlap checking is the validator's job.
 */
export const scheduledSession = pgTable(
  "scheduled_session",
  {
    id: id(),
    institutionId: institutionId(),
    timetableVersionId: uuid("timetable_version_id")
      .notNull()
      .references(() => timetableVersion.id, { onDelete: "cascade" }),
    teachingRequirementId: uuid("teaching_requirement_id")
      .notNull()
      .references(() => teachingRequirement.id, { onDelete: "cascade" }),
    facultyId: uuid("faculty_id")
      .notNull()
      .references(() => faculty.id, { onDelete: "restrict" }),
    roomId: uuid("room_id")
      .notNull()
      .references(() => room.id, { onDelete: "restrict" }),
    timeSlotId: uuid("time_slot_id")
      .notNull()
      .references(() => timeSlot.id, { onDelete: "restrict" }),
    durationPeriods: integer("duration_periods").notNull().default(1),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.timetableVersionId, t.roomId, t.timeSlotId),
    unique().on(t.timetableVersionId, t.facultyId, t.timeSlotId),
    check("duration_positive", sql`${t.durationPeriods} >= 1`),
    index("ix_scheduled_session_institution_id").on(t.institutionId),
    index("ix_scheduled_session_timetable_version_id").on(t.timetableVersionId),
    index("ix_scheduled_session_teaching_requirement_id").on(t.teachingRequirementId),
  ],
);

export const sessionLock = pgTable(
  "session_lock",
  {
    id: id(),
    institutionId: institutionId(),
    scheduledSessionId: uuid("scheduled_session_id")
      .notNull()
      .references(() => scheduledSession.id, { onDelete: "cascade" }),
    lockedBy: varchar("locked_by", { length: 255 }).notNull(),
    reason: text("reason"),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.scheduledSessionId),
    index("ix_session_lock_institution_id").on(t.institutionId),
  ],
);

export const validationFinding = pgTable(
  "validation_finding",
  {
    id: id(),
    institutionId: institutionId(),
    timetableVersionId: uuid("timetable_version_id")
      .notNull()
      .references(() => timetableVersion.id, { onDelete: "cascade" }),
    generationRunId: uuid("generation_run_id").references(() => generationRun.id, {
      onDelete: "set null",
    }),
    ruleId: varchar("rule_id", { length: 64 }).notNull(),
    severity: severityEnum("severity").notNull(),
    message: text("message").notNull(),
    sessionIds: jsonb("session_ids").$type<string[]>(),
    slotIds: jsonb("slot_ids").$type<string[]>(),
    createdAt: createdAt(),
  },
  (t) => [
    index("ix_validation_finding_institution_id").on(t.institutionId),
    index("ix_validation_finding_timetable_version_id").on(t.timetableVersionId),
    index("ix_validation_finding_generation_run_id").on(t.generationRunId),
  ],
);

export const approvalState = pgTable(
  "approval_state",
  {
    id: id(),
    institutionId: institutionId(),
    timetableVersionId: uuid("timetable_version_id")
      .notNull()
      .references(() => timetableVersion.id, { onDelete: "cascade" }),
    status: approvalStatusEnum("status").notNull().default("draft"),
    changedBy: varchar("changed_by", { length: 255 }).notNull(),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.timetableVersionId),
    index("ix_approval_state_institution_id").on(t.institutionId),
  ],
);

export const auditEvent = pgTable(
  "audit_event",
  {
    id: id(),
    institutionId: institutionId(),
    actor: varchar("actor", { length: 255 }).notNull(),
    action: varchar("action", { length: 128 }).notNull(),
    entityType: varchar("entity_type", { length: 128 }).notNull(),
    entityId: uuid("entity_id"),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index("ix_audit_event_institution_id").on(t.institutionId)],
);
