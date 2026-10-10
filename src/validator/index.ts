/**
 * Independent timetable validator (requirements.md section 9).
 *
 * Public surface: `validate(problem, placements)` returns structured
 * findings; `isPublishReady(findings)` is false whenever any finding carries
 * severity "error". Rule ids are stable, machine-addressable strings.
 */
export { validate, isPublishReady } from "./engine";
export * as ruleIds from "./ruleIds";
export { HARD_RULES, SOFT_RULES } from "./ruleIds";
export { ValidationContext } from "./context";
