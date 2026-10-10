/**
 * Shared database test harness: an in-memory PGlite (real Postgres engine)
 * with the generated Drizzle migration applied, plus a seed of one complete
 * entity chain from institution down to a scheduled session.
 */

import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

import * as schema from "@/db/schema";

export type TestDb = PgliteDatabase<typeof schema>;

export async function createTestDb(): Promise<{ db: TestDb; client: PGlite }> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: "src/db/migrations" });
  return { db, client };
}

export interface Seeded {
  institution: { id: string };
  department: { id: string };
  academicYear: { id: string };
  academicTerm: { id: string };
  semester: { id: string };
  program: { id: string };
  branch: { id: string };
  division: { id: string };
  studentGroup: { id: string };
  subject: { id: string };
  subjectOffering: { id: string };
  faculty: { id: string };
  room: { id: string };
  timeSlot: { id: string };
  teachingRequirement: { id: string };
  generationRun: { id: string };
  timetableVersion: { id: string };
  scheduledSession: { id: string };
}

/** One complete, valid chain of rows through the whole schema. */
export async function seed(db: TestDb): Promise<Seeded> {
  const [inst] = await db
    .insert(schema.institution)
    .values({ code: "INDUS", name: "Indus University" })
    .returning({ id: schema.institution.id });
  const institutionId = inst!.id;

  const [dept] = await db
    .insert(schema.department)
    .values({ institutionId, code: "CSE", name: "Computer Science" })
    .returning({ id: schema.department.id });

  const [year] = await db
    .insert(schema.academicYear)
    .values({
      institutionId,
      label: "2026-27",
      startDate: "2026-07-01",
      endDate: "2027-06-30",
    })
    .returning({ id: schema.academicYear.id });

  const [term] = await db
    .insert(schema.academicTerm)
    .values({ institutionId, academicYearId: year!.id, name: "Odd 2026" })
    .returning({ id: schema.academicTerm.id });

  const [sem] = await db
    .insert(schema.semester)
    .values({
      institutionId,
      academicTermId: term!.id,
      number: 3,
      semesterType: "ODD",
    })
    .returning({ id: schema.semester.id });

  const [prog] = await db
    .insert(schema.program)
    .values({ institutionId, departmentId: dept!.id, code: "BTECH", name: "B.Tech" })
    .returning({ id: schema.program.id });

  const [br] = await db
    .insert(schema.branch)
    .values({ institutionId, programId: prog!.id, code: "CS", name: "Computer Science" })
    .returning({ id: schema.branch.id });

  const [div] = await db
    .insert(schema.division)
    .values({
      institutionId,
      branchId: br!.id,
      semesterId: sem!.id,
      code: "A",
      name: "Division A",
    })
    .returning({ id: schema.division.id });

  const [group] = await db
    .insert(schema.studentGroup)
    .values({
      institutionId,
      divisionId: div!.id,
      code: "A-ALL",
      name: "Division A (all)",
      strength: 60,
    })
    .returning({ id: schema.studentGroup.id });

  const [subj] = await db
    .insert(schema.subject)
    .values({
      institutionId,
      departmentId: dept!.id,
      code: "CS301",
      name: "Operating Systems",
    })
    .returning({ id: schema.subject.id });

  const [offering] = await db
    .insert(schema.subjectOffering)
    .values({
      institutionId,
      subjectId: subj!.id,
      semesterId: sem!.id,
      divisionId: div!.id,
    })
    .returning({ id: schema.subjectOffering.id });

  const [fac] = await db
    .insert(schema.faculty)
    .values({
      institutionId,
      departmentId: dept!.id,
      code: "FAC01",
      name: "Prof. Iyer",
    })
    .returning({ id: schema.faculty.id });

  const [rm] = await db
    .insert(schema.room)
    .values({
      institutionId,
      code: "R101",
      name: "Room 101",
      capacity: 70,
      roomType: "classroom",
    })
    .returning({ id: schema.room.id });

  const [slot] = await db
    .insert(schema.timeSlot)
    .values({
      institutionId,
      day: 0,
      period: 0,
      startMinute: 540,
      endMinute: 600,
    })
    .returning({ id: schema.timeSlot.id });

  const [req] = await db
    .insert(schema.teachingRequirement)
    .values({
      institutionId,
      subjectOfferingId: offering!.id,
      studentGroupId: group!.id,
      activityType: "lecture",
      sessionsPerWeek: 3,
    })
    .returning({ id: schema.teachingRequirement.id });

  const [run] = await db
    .insert(schema.generationRun)
    .values({ institutionId, semesterId: sem!.id })
    .returning({ id: schema.generationRun.id });

  const [version] = await db
    .insert(schema.timetableVersion)
    .values({
      institutionId,
      semesterId: sem!.id,
      generationRunId: run!.id,
      versionNumber: 1,
    })
    .returning({ id: schema.timetableVersion.id });

  const [scheduled] = await db
    .insert(schema.scheduledSession)
    .values({
      institutionId,
      timetableVersionId: version!.id,
      teachingRequirementId: req!.id,
      facultyId: fac!.id,
      roomId: rm!.id,
      timeSlotId: slot!.id,
    })
    .returning({ id: schema.scheduledSession.id });

  return {
    institution: { id: institutionId },
    department: dept!,
    academicYear: year!,
    academicTerm: term!,
    semester: sem!,
    program: prog!,
    branch: br!,
    division: div!,
    studentGroup: group!,
    subject: subj!,
    subjectOffering: offering!,
    faculty: fac!,
    room: rm!,
    timeSlot: slot!,
    teachingRequirement: req!,
    generationRun: run!,
    timetableVersion: version!,
    scheduledSession: scheduled!,
  };
}
