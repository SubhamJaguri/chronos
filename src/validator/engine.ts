/**
 * Validator entry points (requirements.md section 9).
 *
 * `validate` checks final placements against the canonical problem data and
 * returns structured findings; `isPublishReady` enforces the rule that a
 * schedule with unresolved hard-constraint violations must never be
 * publish-ready.
 *
 * This module is deliberately independent of the solver: it re-derives every
 * rule from requirements.md so that a disagreement between solver and
 * validator surfaces as a finding instead of being silently shared.
 */
import type { Finding, Placement, Problem } from "@/core/domain";
import { ValidationContext } from "./context";
import { ALL_HARD_CHECKS } from "./hard";
import { ALL_SOFT_CHECKS } from "./soft";

/**
 * Independently validate `placements` against `problem`.
 *
 * Returns every finding: hard-constraint violations as "error", soft-rule
 * observations as "warning". An empty array means a fully clean timetable.
 */
export function validate(problem: Problem, placements: Placement[]): Finding[] {
  const ctx = new ValidationContext(problem, placements);
  const findings: Finding[] = [];
  for (const check of ALL_HARD_CHECKS) {
    findings.push(...check(ctx));
  }
  for (const check of ALL_SOFT_CHECKS) {
    findings.push(...check(ctx));
  }
  return findings;
}

/**
 * False if any finding is a hard-constraint violation (severity "error").
 *
 * Warnings (soft rules) alone never block publication.
 */
export function isPublishReady(findings: Finding[]): boolean {
  return findings.every((f) => f.severity !== "error");
}
