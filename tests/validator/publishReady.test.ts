/** isPublishReady: warnings never block publication, a single error does. */
import { describe, expect, test } from "vitest";
import { isPublishReady, validate } from "@/validator";
import { place, problem, session } from "./brokenTimetables";

describe("isPublishReady", () => {
  test("warnings-only timetable is publish-ready", () => {
    // A timetable whose only findings are soft-rule warnings may be published.
    const prob = problem([
      session("S1", { subject: "MATH101" }),
      session("S2", { subject: "MATH101" }),
    ]);
    const placements = [
      place("S1", "D0P0", { room: "R1", fac: "F1" }),
      place("S2", "D0P1", { room: "R1", fac: "F1" }), // same subject, same day: cluster
    ];
    const findings = validate(prob, placements);
    expect(findings.length, "scenario must produce at least one finding").toBeGreaterThan(0);
    expect(findings.every((f) => f.severity === "warning")).toBe(true);
    expect(isPublishReady(findings)).toBe(true);
  });

  test("a single error blocks publication", () => {
    const prob = problem([session("S1")]);
    const findings = validate(prob, [place("S1", "D0P3")]); // on the break slot
    const errors = findings.filter((f) => f.severity === "error");
    expect(errors).toHaveLength(1);
    expect(isPublishReady(findings)).toBe(false);
  });

  test("no findings is publish-ready", () => {
    expect(isPublishReady([])).toBe(true);
  });

  test("a fully clean timetable has no findings and is publish-ready", () => {
    // A sensible little timetable triggers nothing at all.
    const prob = problem([
      session("LEC1", { subject: "MATH101", groups: ["DIV1"] }),
      session("LAB1", {
        subject: "PHY101",
        activity: "lab",
        groups: ["B1"],
        duration: 2,
        consecutive: true,
      }),
      session("LEC2", { subject: "CHEM101", groups: ["DIV2"] }),
    ]);
    const placements = [
      place("LEC1", "D0P0", { room: "R1", fac: "F1" }),
      place("LAB1", ["D0P1", "D0P2"], { room: "R2", fac: "F2" }),
      place("LEC2", "D0P1", { room: "R1", fac: "F4" }),
    ];
    const findings = validate(prob, placements);
    expect(findings).toEqual([]);
    expect(isPublishReady(findings)).toBe(true);
  });
});
