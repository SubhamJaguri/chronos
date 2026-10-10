/** Soft-rule scoring: always "warning", never "error"; trigger + clean per rule. */
import { describe, expect, test } from "vitest";
import { validate } from "@/validator";
import * as ruleIds from "@/validator/ruleIds";
import { byRule, place, problem, rules, session } from "./brokenTimetables";

describe("W-SUBJECT-CLUSTER", () => {
  test("two sessions of one subject on the same day warn", () => {
    const prob = problem([
      session("S1", { subject: "MATH101" }),
      session("S2", { subject: "MATH101" }),
    ]);
    const placements = [
      place("S1", "D0P0", { room: "R1", fac: "F1" }),
      place("S2", "D0P2", { room: "R1", fac: "F1" }),
    ];
    const findings = validate(prob, placements);
    const hits = byRule(findings, ruleIds.SUBJECT_CLUSTER);
    expect(hits.length).toBeGreaterThan(0); // two MATH101 sessions on Monday for Division 1 must warn
    expect(hits.every((f) => f.severity === "warning")).toBe(true);
    expect(hits[0].message).toContain("Math");
    expect(hits[0].message).toContain("Monday");
    expect(new Set(hits[0].sessionIds)).toEqual(new Set(["S1", "S2"]));
  });

  test("subject spread across days is clean", () => {
    const prob = problem([
      session("S1", { subject: "MATH101" }),
      session("S2", { subject: "MATH101" }),
    ]);
    const placements = [
      place("S1", "D0P0", { room: "R1", fac: "F1" }),
      place("S2", "D1P0", { room: "R1", fac: "F1" }),
    ];
    expect(rules(validate(prob, placements))).not.toContain(
      ruleIds.SUBJECT_CLUSTER,
    );
  });

  test("a single multi-period lab is not clustering", () => {
    const prob = problem([
      session("LAB1", {
        activity: "lab",
        groups: ["B1"],
        duration: 2,
        consecutive: true,
      }),
    ]);
    const findings = validate(prob, [
      place("LAB1", ["D0P0", "D0P1"], { room: "R2" }),
    ]);
    expect(rules(findings)).not.toContain(ruleIds.SUBJECT_CLUSTER);
  });
});

describe("W-GROUP-GAPS", () => {
  test("group gap detected", () => {
    const prob = problem([
      session("S1", { subject: "MATH101", groups: ["B1"] }),
      session("S2", { subject: "PHY101", groups: ["B1"] }),
    ]);
    const placements = [
      place("S1", "D0P0", { room: "R1", fac: "F1" }),
      place("S2", "D0P2", { room: "R1", fac: "F2" }), // period 1 idle for Batch 1
    ];
    const findings = validate(prob, placements);
    const hits = byRule(findings, ruleIds.GROUP_GAPS);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((f) => f.severity === "warning")).toBe(true);
    const batch1 = hits.filter((f) => f.message.includes("Batch 1"));
    expect(batch1).toHaveLength(1);
    expect(batch1[0].slotIds).toContain("D0P1");
  });

  test("contiguous group day is clean", () => {
    const prob = problem([
      session("S1", { subject: "MATH101", groups: ["B1"] }),
      session("S2", { subject: "PHY101", groups: ["B1"] }),
    ]);
    const placements = [
      place("S1", "D0P0", { room: "R1", fac: "F1" }),
      place("S2", "D0P1", { room: "R1", fac: "F2" }),
    ];
    expect(rules(validate(prob, placements))).not.toContain(
      ruleIds.GROUP_GAPS,
    );
  });

  test("a break period is not a gap", () => {
    const prob = problem([
      session("S1", { subject: "MATH101", groups: ["B1"] }),
      session("S2", { subject: "PHY101", groups: ["B1"] }),
    ]);
    const placements = [
      place("S1", "D0P2", { room: "R1", fac: "F1" }),
      place("S2", "D0P4", { room: "R1", fac: "F2" }), // only the break sits between
    ];
    expect(rules(validate(prob, placements))).not.toContain(
      ruleIds.GROUP_GAPS,
    );
  });

  test("gap counts sessions inherited from the parent division", () => {
    // A batch attends its division's lectures: DIV1 at P0 plus B1 at P2
    // leaves Batch 1 idle at P1.
    const prob = problem([
      session("S1", { subject: "MATH101", groups: ["DIV1"] }),
      session("S2", { subject: "PHY101", groups: ["B1"] }),
    ]);
    const placements = [
      place("S1", "D0P0", { room: "R1", fac: "F1" }),
      place("S2", "D0P2", { room: "R1", fac: "F2" }),
    ];
    const hits = byRule(validate(prob, placements), ruleIds.GROUP_GAPS);
    expect(hits.some((f) => f.message.includes("Batch 1"))).toBe(true);
  });
});

describe("W-FACULTY-GAPS", () => {
  test("faculty gap detected", () => {
    const prob = problem([
      session("S1", { subject: "MATH101", groups: ["DIV1"] }),
      session("S2", { subject: "PHY101", groups: ["DIV2"] }),
    ]);
    const placements = [
      place("S1", "D0P0", { room: "R1", fac: "F2" }),
      place("S2", "D0P2", { room: "R1", fac: "F2" }), // Dr. Iyer idle at period 1
    ];
    const findings = validate(prob, placements);
    const hits = byRule(findings, ruleIds.FACULTY_GAPS);
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe("warning");
    expect(hits[0].message).toContain("Dr. Iyer");
    expect(hits[0].slotIds).toContain("D0P1");
  });

  test("contiguous faculty day is clean", () => {
    const prob = problem([
      session("S1", { subject: "MATH101", groups: ["DIV1"] }),
      session("S2", { subject: "PHY101", groups: ["DIV2"] }),
    ]);
    const placements = [
      place("S1", "D0P0", { room: "R1", fac: "F2" }),
      place("S2", "D0P1", { room: "R1", fac: "F2" }),
    ];
    expect(rules(validate(prob, placements))).not.toContain(
      ruleIds.FACULTY_GAPS,
    );
  });
});

describe("W-WORKLOAD-IMBALANCE", () => {
  test("faculty workload imbalance across days", () => {
    const sessions = [0, 1, 2, 3, 4].map((i) =>
      session(`S${i}`, { subject: `SUB${i}` }),
    );
    const prob = problem(sessions);
    const placements = [
      place("S0", "D0P0", { fac: "F2" }),
      place("S1", "D0P1", { fac: "F2" }),
      place("S2", "D0P2", { fac: "F2" }),
      place("S3", "D0P4", { fac: "F2" }), // 4 periods on Monday
      place("S4", "D1P0", { fac: "F2" }), // 1 period on Tuesday
    ];
    const findings = validate(prob, placements);
    const hits = byRule(findings, ruleIds.WORKLOAD_IMBALANCE);
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe("warning");
    expect(hits[0].message).toContain("Dr. Iyer");
    expect(hits[0].message).toContain("Monday");
    expect(hits[0].message).toContain("Tuesday");
  });

  test("balanced workload is clean", () => {
    const sessions = [0, 1, 2, 3].map((i) =>
      session(`S${i}`, { subject: `SUB${i}` }),
    );
    const prob = problem(sessions);
    const placements = [
      place("S0", "D0P0", { fac: "F2" }),
      place("S1", "D0P1", { fac: "F2" }),
      place("S2", "D1P0", { fac: "F2" }),
      place("S3", "D1P1", { fac: "F2" }),
    ];
    expect(rules(validate(prob, placements))).not.toContain(
      ruleIds.WORKLOAD_IMBALANCE,
    );
  });
});

describe("global severity invariant", () => {
  test("soft rules are never errors and hard rules never warnings", () => {
    // On a timetable violating both kinds of rule at once, every W-* finding
    // is a warning and every H-* finding is an error.
    const prob = problem([
      session("S1", { subject: "MATH101" }),
      session("S2", { subject: "MATH101" }),
      session("S3", { subject: "PHY101", groups: ["DIV2"] }),
    ]);
    const placements = [
      place("S1", "D0P0", { room: "R1", fac: "F1" }),
      place("S2", "D0P2", { room: "R1", fac: "F1" }), // clustering + gaps
      place("S3", "D0P3", { room: "R4", fac: "F2" }), // break placement (hard)
    ];
    const findings = validate(prob, placements);
    expect(findings.some((f) => f.ruleId.startsWith("W-"))).toBe(true);
    expect(findings.some((f) => f.ruleId.startsWith("H-"))).toBe(true);
    for (const f of findings) {
      if (f.ruleId.startsWith("W-")) {
        expect(f.severity, f.ruleId).toBe("warning");
      } else {
        expect(f.severity, f.ruleId).toBe("error");
      }
    }
  });
});
