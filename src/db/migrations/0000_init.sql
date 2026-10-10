CREATE TYPE "public"."activity_type" AS ENUM('lecture', 'lab', 'practical', 'elective', 'project', 'library', 'fixed');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('draft', 'in_review', 'approved', 'published', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."generation_status" AS ENUM('pending', 'running', 'succeeded', 'failed', 'timed_out');--> statement-breakpoint
CREATE TYPE "public"."room_type" AS ENUM('classroom', 'lab', 'auditorium');--> statement-breakpoint
CREATE TYPE "public"."semester_type" AS ENUM('ODD', 'EVEN');--> statement-breakpoint
CREATE TYPE "public"."severity" AS ENUM('error', 'warning');--> statement-breakpoint
CREATE TABLE "academic_term" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"name" varchar(64) NOT NULL,
	"start_date" date,
	"end_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "academic_term_academic_year_id_name_unique" UNIQUE("academic_year_id","name")
);
--> statement-breakpoint
CREATE TABLE "academic_year" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"label" varchar(32) NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "academic_year_institution_id_label_unique" UNIQUE("institution_id","label"),
	CONSTRAINT "year_dates_ordered" CHECK ("academic_year"."end_date" > "academic_year"."start_date")
);
--> statement-breakpoint
CREATE TABLE "approval_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"timetable_version_id" uuid NOT NULL,
	"status" "approval_status" DEFAULT 'draft' NOT NULL,
	"changed_by" varchar(255) NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_state_timetable_version_id_unique" UNIQUE("timetable_version_id")
);
--> statement-breakpoint
CREATE TABLE "audit_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"actor" varchar(255) NOT NULL,
	"action" varchar(128) NOT NULL,
	"entity_type" varchar(128) NOT NULL,
	"entity_id" uuid,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "branch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"code" varchar(64) NOT NULL,
	"name" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branch_program_id_code_unique" UNIQUE("program_id","code")
);
--> statement-breakpoint
CREATE TABLE "department" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"code" varchar(64) NOT NULL,
	"name" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "department_institution_id_code_unique" UNIQUE("institution_id","code")
);
--> statement-breakpoint
CREATE TABLE "division" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"semester_id" uuid NOT NULL,
	"code" varchar(64) NOT NULL,
	"name" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "division_branch_id_semester_id_code_unique" UNIQUE("branch_id","semester_id","code")
);
--> statement-breakpoint
CREATE TABLE "faculty" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"department_id" uuid,
	"code" varchar(64) NOT NULL,
	"name" varchar(255) NOT NULL,
	"email" varchar(255),
	"max_periods_per_day" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "faculty_institution_id_code_unique" UNIQUE("institution_id","code")
);
--> statement-breakpoint
CREATE TABLE "faculty_availability" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"faculty_id" uuid NOT NULL,
	"time_slot_id" uuid NOT NULL,
	"is_available" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "faculty_availability_faculty_id_time_slot_id_unique" UNIQUE("faculty_id","time_slot_id")
);
--> statement-breakpoint
CREATE TABLE "faculty_subject_assignment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"faculty_id" uuid NOT NULL,
	"subject_offering_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "faculty_subject_assignment_faculty_id_subject_offering_id_unique" UNIQUE("faculty_id","subject_offering_id")
);
--> statement-breakpoint
CREATE TABLE "generation_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"semester_id" uuid NOT NULL,
	"status" "generation_status" DEFAULT 'pending' NOT NULL,
	"solver_status" varchar(32),
	"input_fingerprint" varchar(128),
	"diagnostics" jsonb,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "institution" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(64) NOT NULL,
	"name" varchar(255) NOT NULL,
	"timezone" varchar(64) DEFAULT 'Asia/Kolkata' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "institution_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "program" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"code" varchar(64) NOT NULL,
	"name" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "program_department_id_code_unique" UNIQUE("department_id","code")
);
--> statement-breakpoint
CREATE TABLE "room" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"code" varchar(64) NOT NULL,
	"name" varchar(255) NOT NULL,
	"capacity" integer NOT NULL,
	"room_type" "room_type" NOT NULL,
	"facilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "room_institution_id_code_unique" UNIQUE("institution_id","code"),
	CONSTRAINT "capacity_non_negative" CHECK ("room"."capacity" >= 0)
);
--> statement-breakpoint
CREATE TABLE "scheduled_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"timetable_version_id" uuid NOT NULL,
	"teaching_requirement_id" uuid NOT NULL,
	"faculty_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"time_slot_id" uuid NOT NULL,
	"duration_periods" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scheduled_session_timetable_version_id_room_id_time_slot_id_unique" UNIQUE("timetable_version_id","room_id","time_slot_id"),
	CONSTRAINT "scheduled_session_timetable_version_id_faculty_id_time_slot_id_unique" UNIQUE("timetable_version_id","faculty_id","time_slot_id"),
	CONSTRAINT "duration_positive" CHECK ("scheduled_session"."duration_periods" >= 1)
);
--> statement-breakpoint
CREATE TABLE "semester" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"academic_term_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"semester_type" "semester_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "semester_academic_term_id_number_unique" UNIQUE("academic_term_id","number"),
	CONSTRAINT "number_positive" CHECK ("semester"."number" >= 1)
);
--> statement-breakpoint
CREATE TABLE "session_lock" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"scheduled_session_id" uuid NOT NULL,
	"locked_by" varchar(255) NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_lock_scheduled_session_id_unique" UNIQUE("scheduled_session_id")
);
--> statement-breakpoint
CREATE TABLE "student_group" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"division_id" uuid NOT NULL,
	"parent_id" uuid,
	"code" varchar(64) NOT NULL,
	"name" varchar(255) NOT NULL,
	"strength" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_group_division_id_code_unique" UNIQUE("division_id","code"),
	CONSTRAINT "strength_non_negative" CHECK ("student_group"."strength" >= 0)
);
--> statement-breakpoint
CREATE TABLE "subject" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"code" varchar(64) NOT NULL,
	"name" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subject_institution_id_code_unique" UNIQUE("institution_id","code")
);
--> statement-breakpoint
CREATE TABLE "subject_offering" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"semester_id" uuid NOT NULL,
	"division_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subject_offering_subject_id_semester_id_division_id_unique" UNIQUE("subject_id","semester_id","division_id")
);
--> statement-breakpoint
CREATE TABLE "teaching_requirement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"subject_offering_id" uuid NOT NULL,
	"student_group_id" uuid NOT NULL,
	"activity_type" "activity_type" NOT NULL,
	"sessions_per_week" integer NOT NULL,
	"duration_periods" integer DEFAULT 1 NOT NULL,
	"requires_consecutive" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teaching_requirement_subject_offering_id_student_group_id_activity_type_unique" UNIQUE("subject_offering_id","student_group_id","activity_type"),
	CONSTRAINT "sessions_positive" CHECK ("teaching_requirement"."sessions_per_week" >= 1),
	CONSTRAINT "duration_positive" CHECK ("teaching_requirement"."duration_periods" >= 1)
);
--> statement-breakpoint
CREATE TABLE "time_slot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"day" integer NOT NULL,
	"period" integer NOT NULL,
	"start_minute" integer NOT NULL,
	"end_minute" integer NOT NULL,
	"is_break" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "time_slot_institution_id_day_period_unique" UNIQUE("institution_id","day","period"),
	CONSTRAINT "day_in_week" CHECK ("time_slot"."day" >= 0 AND "time_slot"."day" <= 6),
	CONSTRAINT "period_non_negative" CHECK ("time_slot"."period" >= 0),
	CONSTRAINT "minutes_ordered" CHECK ("time_slot"."end_minute" > "time_slot"."start_minute")
);
--> statement-breakpoint
CREATE TABLE "timetable_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"semester_id" uuid NOT NULL,
	"generation_run_id" uuid,
	"version_number" integer NOT NULL,
	"label" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "timetable_version_semester_id_version_number_unique" UNIQUE("semester_id","version_number")
);
--> statement-breakpoint
CREATE TABLE "validation_finding" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"timetable_version_id" uuid NOT NULL,
	"generation_run_id" uuid,
	"rule_id" varchar(64) NOT NULL,
	"severity" "severity" NOT NULL,
	"message" text NOT NULL,
	"session_ids" jsonb,
	"slot_ids" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "academic_term" ADD CONSTRAINT "academic_term_institution_id_institution_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institution"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic_term" ADD CONSTRAINT "academic_term_academic_year_id_academic_year_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_year"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic_year" ADD CONSTRAINT "academic_year_institution_id_institution_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institution"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_state" ADD CONSTRAINT "approval_state_institution_id_institution_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institution"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_state" ADD CONSTRAINT "approval_state_timetable_version_id_timetable_version_id_fk" FOREIGN KEY ("timetable_version_id") REFERENCES "public"."timetable_version"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_institution_id_institution_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institution"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch" ADD CONSTRAINT "branch_institution_id_institution_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institution"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch" ADD CONSTRAINT "branch_program_id_program_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."program"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department" ADD CONSTRAINT "department_institution_id_institution_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institution"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "division" ADD CONSTRAINT "division_institution_id_institution_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institution"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "division" ADD CONSTRAINT "division_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "division" ADD CONSTRAINT "division_semester_id_semester_id_fk" FOREIGN KEY ("semester_id") REFERENCES "public"."semester"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faculty" ADD CONSTRAINT "faculty_institution_id_institution_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institution"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faculty" ADD CONSTRAINT "faculty_department_id_department_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."department"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faculty_availability" ADD CONSTRAINT "faculty_availability_institution_id_institution_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institution"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faculty_availability" ADD CONSTRAINT "faculty_availability_faculty_id_faculty_id_fk" FOREIGN KEY ("faculty_id") REFERENCES "public"."faculty"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faculty_availability" ADD CONSTRAINT "faculty_availability_time_slot_id_time_slot_id_fk" FOREIGN KEY ("time_slot_id") REFERENCES "public"."time_slot"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faculty_subject_assignment" ADD CONSTRAINT "faculty_subject_assignment_institution_id_institution_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institution"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faculty_subject_assignment" ADD CONSTRAINT "faculty_subject_assignment_faculty_id_faculty_id_fk" FOREIGN KEY ("faculty_id") REFERENCES "public"."faculty"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faculty_subject_assignment" ADD CONSTRAINT "faculty_subject_assignment_subject_offering_id_subject_offering_id_fk" FOREIGN KEY ("subject_offering_id") REFERENCES "public"."subject_offering"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_run" ADD CONSTRAINT "generation_run_institution_id_institution_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institution"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_run" ADD CONSTRAINT "generation_run_semester_id_semester_id_fk" FOREIGN KEY ("semester_id") REFERENCES "public"."semester"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program" ADD CONSTRAINT "program_institution_id_institution_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institution"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program" ADD CONSTRAINT "program_department_id_department_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."department"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room" ADD CONSTRAINT "room_institution_id_institution_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institution"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_session" ADD CONSTRAINT "scheduled_session_institution_id_institution_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institution"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_session" ADD CONSTRAINT "scheduled_session_timetable_version_id_timetable_version_id_fk" FOREIGN KEY ("timetable_version_id") REFERENCES "public"."timetable_version"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_session" ADD CONSTRAINT "scheduled_session_teaching_requirement_id_teaching_requirement_id_fk" FOREIGN KEY ("teaching_requirement_id") REFERENCES "public"."teaching_requirement"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_session" ADD CONSTRAINT "scheduled_session_faculty_id_faculty_id_fk" FOREIGN KEY ("faculty_id") REFERENCES "public"."faculty"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_session" ADD CONSTRAINT "scheduled_session_room_id_room_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."room"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_session" ADD CONSTRAINT "scheduled_session_time_slot_id_time_slot_id_fk" FOREIGN KEY ("time_slot_id") REFERENCES "public"."time_slot"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "semester" ADD CONSTRAINT "semester_institution_id_institution_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institution"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "semester" ADD CONSTRAINT "semester_academic_term_id_academic_term_id_fk" FOREIGN KEY ("academic_term_id") REFERENCES "public"."academic_term"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_lock" ADD CONSTRAINT "session_lock_institution_id_institution_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institution"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_lock" ADD CONSTRAINT "session_lock_scheduled_session_id_scheduled_session_id_fk" FOREIGN KEY ("scheduled_session_id") REFERENCES "public"."scheduled_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_group" ADD CONSTRAINT "student_group_institution_id_institution_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institution"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_group" ADD CONSTRAINT "student_group_division_id_division_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."division"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_group" ADD CONSTRAINT "student_group_parent_id_student_group_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."student_group"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subject" ADD CONSTRAINT "subject_institution_id_institution_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institution"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subject" ADD CONSTRAINT "subject_department_id_department_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."department"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subject_offering" ADD CONSTRAINT "subject_offering_institution_id_institution_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institution"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subject_offering" ADD CONSTRAINT "subject_offering_subject_id_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subject"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subject_offering" ADD CONSTRAINT "subject_offering_semester_id_semester_id_fk" FOREIGN KEY ("semester_id") REFERENCES "public"."semester"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subject_offering" ADD CONSTRAINT "subject_offering_division_id_division_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."division"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teaching_requirement" ADD CONSTRAINT "teaching_requirement_institution_id_institution_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institution"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teaching_requirement" ADD CONSTRAINT "teaching_requirement_subject_offering_id_subject_offering_id_fk" FOREIGN KEY ("subject_offering_id") REFERENCES "public"."subject_offering"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teaching_requirement" ADD CONSTRAINT "teaching_requirement_student_group_id_student_group_id_fk" FOREIGN KEY ("student_group_id") REFERENCES "public"."student_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_slot" ADD CONSTRAINT "time_slot_institution_id_institution_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institution"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_version" ADD CONSTRAINT "timetable_version_institution_id_institution_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institution"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_version" ADD CONSTRAINT "timetable_version_semester_id_semester_id_fk" FOREIGN KEY ("semester_id") REFERENCES "public"."semester"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_version" ADD CONSTRAINT "timetable_version_generation_run_id_generation_run_id_fk" FOREIGN KEY ("generation_run_id") REFERENCES "public"."generation_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_finding" ADD CONSTRAINT "validation_finding_institution_id_institution_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institution"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_finding" ADD CONSTRAINT "validation_finding_timetable_version_id_timetable_version_id_fk" FOREIGN KEY ("timetable_version_id") REFERENCES "public"."timetable_version"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_finding" ADD CONSTRAINT "validation_finding_generation_run_id_generation_run_id_fk" FOREIGN KEY ("generation_run_id") REFERENCES "public"."generation_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_academic_term_institution_id" ON "academic_term" USING btree ("institution_id");--> statement-breakpoint
CREATE INDEX "ix_academic_term_academic_year_id" ON "academic_term" USING btree ("academic_year_id");--> statement-breakpoint
CREATE INDEX "ix_academic_year_institution_id" ON "academic_year" USING btree ("institution_id");--> statement-breakpoint
CREATE INDEX "ix_approval_state_institution_id" ON "approval_state" USING btree ("institution_id");--> statement-breakpoint
CREATE INDEX "ix_audit_event_institution_id" ON "audit_event" USING btree ("institution_id");--> statement-breakpoint
CREATE INDEX "ix_branch_institution_id" ON "branch" USING btree ("institution_id");--> statement-breakpoint
CREATE INDEX "ix_branch_program_id" ON "branch" USING btree ("program_id");--> statement-breakpoint
CREATE INDEX "ix_department_institution_id" ON "department" USING btree ("institution_id");--> statement-breakpoint
CREATE INDEX "ix_division_institution_id" ON "division" USING btree ("institution_id");--> statement-breakpoint
CREATE INDEX "ix_division_branch_id" ON "division" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "ix_division_semester_id" ON "division" USING btree ("semester_id");--> statement-breakpoint
CREATE INDEX "ix_faculty_department_id" ON "faculty" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "ix_faculty_availability_institution_id" ON "faculty_availability" USING btree ("institution_id");--> statement-breakpoint
CREATE INDEX "ix_faculty_availability_faculty_id" ON "faculty_availability" USING btree ("faculty_id");--> statement-breakpoint
CREATE INDEX "ix_faculty_availability_time_slot_id" ON "faculty_availability" USING btree ("time_slot_id");--> statement-breakpoint
CREATE INDEX "ix_faculty_subject_assignment_institution_id" ON "faculty_subject_assignment" USING btree ("institution_id");--> statement-breakpoint
CREATE INDEX "ix_faculty_subject_assignment_faculty_id" ON "faculty_subject_assignment" USING btree ("faculty_id");--> statement-breakpoint
CREATE INDEX "ix_faculty_subject_assignment_subject_offering_id" ON "faculty_subject_assignment" USING btree ("subject_offering_id");--> statement-breakpoint
CREATE INDEX "ix_generation_run_institution_id" ON "generation_run" USING btree ("institution_id");--> statement-breakpoint
CREATE INDEX "ix_generation_run_semester_id" ON "generation_run" USING btree ("semester_id");--> statement-breakpoint
CREATE INDEX "ix_program_institution_id" ON "program" USING btree ("institution_id");--> statement-breakpoint
CREATE INDEX "ix_program_department_id" ON "program" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "ix_scheduled_session_institution_id" ON "scheduled_session" USING btree ("institution_id");--> statement-breakpoint
CREATE INDEX "ix_scheduled_session_timetable_version_id" ON "scheduled_session" USING btree ("timetable_version_id");--> statement-breakpoint
CREATE INDEX "ix_scheduled_session_teaching_requirement_id" ON "scheduled_session" USING btree ("teaching_requirement_id");--> statement-breakpoint
CREATE INDEX "ix_semester_institution_id" ON "semester" USING btree ("institution_id");--> statement-breakpoint
CREATE INDEX "ix_semester_academic_term_id" ON "semester" USING btree ("academic_term_id");--> statement-breakpoint
CREATE INDEX "ix_session_lock_institution_id" ON "session_lock" USING btree ("institution_id");--> statement-breakpoint
CREATE INDEX "ix_student_group_institution_id" ON "student_group" USING btree ("institution_id");--> statement-breakpoint
CREATE INDEX "ix_student_group_division_id" ON "student_group" USING btree ("division_id");--> statement-breakpoint
CREATE INDEX "ix_subject_department_id" ON "subject" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "ix_subject_offering_institution_id" ON "subject_offering" USING btree ("institution_id");--> statement-breakpoint
CREATE INDEX "ix_subject_offering_subject_id" ON "subject_offering" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "ix_subject_offering_semester_id" ON "subject_offering" USING btree ("semester_id");--> statement-breakpoint
CREATE INDEX "ix_subject_offering_division_id" ON "subject_offering" USING btree ("division_id");--> statement-breakpoint
CREATE INDEX "ix_teaching_requirement_institution_id" ON "teaching_requirement" USING btree ("institution_id");--> statement-breakpoint
CREATE INDEX "ix_teaching_requirement_subject_offering_id" ON "teaching_requirement" USING btree ("subject_offering_id");--> statement-breakpoint
CREATE INDEX "ix_teaching_requirement_student_group_id" ON "teaching_requirement" USING btree ("student_group_id");--> statement-breakpoint
CREATE INDEX "ix_timetable_version_institution_id" ON "timetable_version" USING btree ("institution_id");--> statement-breakpoint
CREATE INDEX "ix_timetable_version_semester_id" ON "timetable_version" USING btree ("semester_id");--> statement-breakpoint
CREATE INDEX "ix_timetable_version_generation_run_id" ON "timetable_version" USING btree ("generation_run_id");--> statement-breakpoint
CREATE INDEX "ix_validation_finding_institution_id" ON "validation_finding" USING btree ("institution_id");--> statement-breakpoint
CREATE INDEX "ix_validation_finding_timetable_version_id" ON "validation_finding" USING btree ("timetable_version_id");--> statement-breakpoint
CREATE INDEX "ix_validation_finding_generation_run_id" ON "validation_finding" USING btree ("generation_run_id");