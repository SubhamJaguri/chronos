/**
 * Schema constraint tests: the 24 tables exist, every owned table is
 * institution-scoped, foreign keys hold, unique constraints bite, checks
 * reject bad values, and cascade deletes flow from the institution.
 *
 * These run against PGlite (a real Postgres engine, in memory) with the
 * generated Drizzle migration applied, so they verify the actual DDL that
 * production Postgres will run, not just the schema objects in TypeScript.
 */

import { randomUUID } from "node:crypto";

import { eq, getTableName, is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as schema from "@/db/schema";
import { createTestDb, seed, type Seeded, type TestDb } from "./helpers";

const EXPECTED_TABLES = [
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
].sort();

/**
 * Awaits a write that must be refused by the database and asserts the
 * violation. Drizzle wraps driver errors (DrizzleQueryError), so the real
 * Postgres message lives on the `cause` chain.
 */
async function expectViolation(action: Promise<unknown>, pattern: RegExp) {
  let caught: unknown = null;
  try {
    await action;
  } catch (err) {
    caught = err;
  }
  expect(caught, "expected the statement to be rejected").not.toBeNull();
  const messages: string[] = [];
  let cursor: unknown = caught;
  while (cursor instanceof Error) {
    messages.push(cursor.message);
    cursor = cursor.cause;
  }
  expect(messages.join("\n")).toMatch(pattern);
}

function schemaTables(): PgTable[] {
  const values: unknown[] = Object.values(schema);
  return values.filter((v): v is PgTable => is(v, PgTable));
}

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>["client"];
let seeded: Seeded;

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  seeded = await seed(db);
});

afterAll(async () => {
  await client.close();
});

describe("schema shape", () => {
  it("declares exactly the 24 expected tables", () => {
    const names = schemaTables()
      .map((t) => getTableName(t))
      .sort();
    expect(names).toEqual(EXPECTED_TABLES);
  });

  it("creates all 24 tables in the database via the migration", async () => {
    const result = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
         AND table_name NOT LIKE '\\_\\_%' ESCAPE '\\'`,
    );
    const names = result.rows
      .map((r) => r.table_name)
      .filter((n) => !n.startsWith("__drizzle"))
      .sort();
    expect(names).toEqual(EXPECTED_TABLES);
  });

  it("scopes every owned table to an institution with a real FK", () => {
    for (const table of schemaTables()) {
      const config = getTableConfig(table);
      if (config.name === "institution") continue;
      const col = config.columns.find((c) => c.name === "institution_id");
      expect(col, `${config.name} is missing institution_id`).toBeDefined();
      expect(col!.notNull, `${config.name}.institution_id must be NOT NULL`).toBe(true);
      const fk = config.foreignKeys.find((f) =>
        f.reference().columns.some((c) => c.name === "institution_id"),
      );
      expect(fk, `${config.name}.institution_id must be a foreign key`).toBeDefined();
      expect(getTableName(fk!.reference().foreignTable)).toBe("institution");
    }
  });
});

describe("foreign keys", () => {
  it("rejects a department pointing at a missing institution", async () => {
    await expectViolation(
      db.insert(schema.department).values({
        institutionId: randomUUID(),
        code: "EEE",
        name: "Electrical",
      }),
      /foreign key/i,
    );
  });

  it("rejects a session lock pointing at a missing scheduled session", async () => {
    await expectViolation(
      db.insert(schema.sessionLock).values({
        institutionId: seeded.institution.id,
        scheduledSessionId: randomUUID(),
        lockedBy: "hod@example.edu",
      }),
      /foreign key/i,
    );
  });
});

describe("unique constraints", () => {
  it("institution code is globally unique", async () => {
    await expectViolation(
      db.insert(schema.institution).values({ code: "INDUS", name: "Duplicate" }),
      /duplicate key|unique/i,
    );
  });

  it("department code is unique per institution", async () => {
    await expectViolation(
      db.insert(schema.department).values({
        institutionId: seeded.institution.id,
        code: "CSE",
        name: "Copycat",
      }),
      /duplicate key|unique/i,
    );
  });

  it("subject code is unique per institution", async () => {
    await expectViolation(
      db.insert(schema.subject).values({
        institutionId: seeded.institution.id,
        departmentId: seeded.department.id,
        code: "CS301",
        name: "Copycat Subject",
      }),
      /duplicate key|unique/i,
    );
  });

  it("time slot is unique per institution, day and period", async () => {
    await expectViolation(
      db.insert(schema.timeSlot).values({
        institutionId: seeded.institution.id,
        day: 0,
        period: 0,
        startMinute: 540,
        endMinute: 600,
      }),
      /duplicate key|unique/i,
    );
  });

  it("rejects double-booking a room at the same start slot in one version", async () => {
    const [otherFaculty] = await db
      .insert(schema.faculty)
      .values({
        institutionId: seeded.institution.id,
        code: "FAC02",
        name: "Prof. Rao",
      })
      .returning({ id: schema.faculty.id });

    await expectViolation(
      db.insert(schema.scheduledSession).values({
        institutionId: seeded.institution.id,
        timetableVersionId: seeded.timetableVersion.id,
        teachingRequirementId: seeded.teachingRequirement.id,
        facultyId: otherFaculty!.id,
        roomId: seeded.room.id,
        timeSlotId: seeded.timeSlot.id,
      }),
      /duplicate key|unique/i,
    );
  });

  it("rejects double-booking a faculty member at the same start slot", async () => {
    const [otherRoom] = await db
      .insert(schema.room)
      .values({
        institutionId: seeded.institution.id,
        code: "R102",
        name: "Room 102",
        capacity: 40,
        roomType: "classroom",
      })
      .returning({ id: schema.room.id });

    await expectViolation(
      db.insert(schema.scheduledSession).values({
        institutionId: seeded.institution.id,
        timetableVersionId: seeded.timetableVersion.id,
        teachingRequirementId: seeded.teachingRequirement.id,
        facultyId: seeded.faculty.id,
        roomId: otherRoom!.id,
        timeSlotId: seeded.timeSlot.id,
      }),
      /duplicate key|unique/i,
    );
  });

  it("allows at most one lock per scheduled session", async () => {
    await db.insert(schema.sessionLock).values({
      institutionId: seeded.institution.id,
      scheduledSessionId: seeded.scheduledSession.id,
      lockedBy: "hod@example.edu",
    });
    await expectViolation(
      db.insert(schema.sessionLock).values({
        institutionId: seeded.institution.id,
        scheduledSessionId: seeded.scheduledSession.id,
        lockedBy: "admin@example.edu",
      }),
      /duplicate key|unique/i,
    );
  });

  it("timetable version number is unique per semester", async () => {
    await expectViolation(
      db.insert(schema.timetableVersion).values({
        institutionId: seeded.institution.id,
        semesterId: seeded.semester.id,
        versionNumber: 1,
      }),
      /duplicate key|unique/i,
    );
  });
});

describe("check constraints", () => {
  it("rejects negative room capacity", async () => {
    await expectViolation(
      db.insert(schema.room).values({
        institutionId: seeded.institution.id,
        code: "RNEG",
        name: "Bad Room",
        capacity: -1,
        roomType: "classroom",
      }),
      /check constraint/i,
    );
  });

  it("rejects a time slot whose end does not come after its start", async () => {
    await expectViolation(
      db.insert(schema.timeSlot).values({
        institutionId: seeded.institution.id,
        day: 1,
        period: 0,
        startMinute: 600,
        endMinute: 600,
      }),
      /check constraint/i,
    );
  });

  it("rejects an out-of-week day", async () => {
    await expectViolation(
      db.insert(schema.timeSlot).values({
        institutionId: seeded.institution.id,
        day: 7,
        period: 0,
        startMinute: 540,
        endMinute: 600,
      }),
      /check constraint/i,
    );
  });
});

describe("enums and json round-trips", () => {
  it("rejects an invalid semester type", async () => {
    await expectViolation(
      client.query(
        `INSERT INTO semester (institution_id, academic_term_id, number, semester_type)
         VALUES ($1, $2, 4, 'SPRING')`,
        [seeded.institution.id, seeded.academicTerm.id],
      ),
      /invalid input value for enum/i,
    );
  });

  it("stores and returns a validation finding with JSON id lists", async () => {
    await db.insert(schema.validationFinding).values({
      institutionId: seeded.institution.id,
      timetableVersionId: seeded.timetableVersion.id,
      ruleId: "faculty-clash",
      severity: "error",
      message: "Prof. Iyer is double-booked on Monday period 1",
      sessionIds: ["ses-1", "ses-2"],
    });
    const found = await db
      .select()
      .from(schema.validationFinding)
      .where(eq(schema.validationFinding.ruleId, "faculty-clash"));
    expect(found).toHaveLength(1);
    expect(found[0]!.severity).toBe("error");
    expect(found[0]!.sessionIds).toEqual(["ses-1", "ses-2"]);
  });
});

describe("cascade behaviour", () => {
  it("deleting the institution removes the whole owned subtree", async () => {
    // Fresh database so earlier test rows do not interfere.
    const { db: freshDb, client: freshClient } = await createTestDb();
    try {
      const s = await seed(freshDb);
      await freshDb
        .delete(schema.institution)
        .where(eq(schema.institution.id, s.institution.id));

      for (const table of ["department", "division", "scheduled_session"]) {
        const rows = await freshClient.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM ${table}`,
        );
        expect(rows.rows[0]!.n, `${table} should be empty`).toBe(0);
      }
    } finally {
      await freshClient.close();
    }
  });

  it("deleting a faculty member with scheduled sessions is restricted", async () => {
    await expectViolation(
      db.delete(schema.faculty).where(eq(schema.faculty.id, seeded.faculty.id)),
      /foreign key|violates/i,
    );
  });
});

describe("surrogate ids", () => {
  it("generates UUID primary keys by default", async () => {
    const rows = await client.query<{ id: string }>(`SELECT id FROM institution`);
    for (const row of rows.rows) {
      expect(row.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    }
  });
});
