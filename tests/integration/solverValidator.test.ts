/**
 * Cross-check the solver against the independent validator.
 *
 * The solver and the validator were built separately from requirements.md and
 * share no code beyond the type-only contract in `@/core/domain`. Neither can
 * mark its own work. These tests are the only place the two meet: a schedule
 * the solver calls optimal must survive the validator's independent reading of
 * the same rules.
 *
 * A failure here means the two components disagree about what a rule means.
 * That disagreement is the signal worth having - do not silence it by making
 * one side import the other.
 */

import { describe, expect, it } from "vitest";

import type { Finding, Problem } from "@/core/domain";
import {
  infeasibleOverbooked,
  labConsecutive,
  tinyFeasible,
  withLocked,
} from "@/core/fixtures";
import { solve } from "@/solver";
import { isPublishReady, validate } from "@/validator";

const TIME_LIMIT_MS = 30_000;

const errorsOf = (findings: Finding[]) =>
  findings.filter((f) => f.severity === "error");

const describeFindings = (findings: Finding[]) =>
  findings.map((f) => `  ${f.ruleId}: ${f.message}`).join("\n");

const FEASIBLE_CASES: Array<[string, () => Problem]> = [
  ["tinyFeasible", tinyFeasible],
  ["labConsecutive", labConsecutive],
  ["withLocked", withLocked],
];

describe("solver output judged by the independent validator", () => {
  it.each(FEASIBLE_CASES)(
    "%s produces a schedule the validator accepts",
    async (_name, build) => {
      const problem = build();
      const solution = await solve(problem, { timeLimitMs: TIME_LIMIT_MS });

      expect(
        ["optimal", "feasible"],
        `expected a solution, got ${solution.status}: ${solution.diagnostics.join("; ")}`,
      ).toContain(solution.status);
      expect(solution.placements).toHaveLength(problem.sessions.length);

      const findings = validate(problem, solution.placements);
      const errors = errorsOf(findings);

      expect(
        errors,
        "solver produced a schedule the independent validator rejects - " +
          `the two disagree about a rule:\n${describeFindings(errors)}`,
      ).toEqual([]);
      expect(isPublishReady(findings)).toBe(true);
    },
  );

  it("honours locked placements in a way the validator also accepts", async () => {
    const problem = withLocked();
    const solution = await solve(problem, { timeLimitMs: TIME_LIMIT_MS });

    const bySession = new Map(solution.placements.map((p) => [p.sessionId, p]));
    for (const locked of problem.lockedPlacements) {
      const placed = bySession.get(locked.sessionId);
      expect(placed, `locked session ${locked.sessionId} was not placed`).toBeDefined();
      expect(new Set(placed!.slotIds)).toEqual(new Set(locked.slotIds));
      expect(placed!.roomId).toBe(locked.roomId);
      expect(placed!.facultyId).toBe(locked.facultyId);
    }

    expect(errorsOf(validate(problem, solution.placements))).toEqual([]);
  });

  it("refuses an infeasible problem with a stated reason", async () => {
    const solution = await solve(infeasibleOverbooked(), {
      timeLimitMs: TIME_LIMIT_MS,
    });

    expect(solution.status).toBe("infeasible");
    expect(
      solution.diagnostics.length,
      "infeasible result carried no explanation",
    ).toBeGreaterThan(0);
    expect(
      solution.diagnostics.some(
        (d) => d.startsWith("PROVEN:") || d.startsWith("LIKELY:"),
      ),
      `diagnostics must state confidence: ${solution.diagnostics.join("; ")}`,
    ).toBe(true);
  });

  it("is deterministic, and validation of its output is stable", async () => {
    const problem = tinyFeasible();
    const first = await solve(problem, { timeLimitMs: TIME_LIMIT_MS });
    const second = await solve(problem, { timeLimitMs: TIME_LIMIT_MS });

    expect(first.placements).toEqual(second.placements);
    expect(validate(problem, first.placements)).toEqual(
      validate(problem, second.placements),
    );
  });
});
