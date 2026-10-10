/**
 * Stable rule identifiers for validator findings.
 *
 * These strings are part of the machine-addressable contract of the
 * validator: UI, API and tests refer to findings by these ids. Never rename
 * one without a deliberate migration. `H-` rules are hard constraints
 * (severity "error"), `W-` rules are soft preferences (severity "warning").
 */

// Hard constraints (requirements.md sections 8 and 9) - severity "error".
export const FACULTY_CLASH = "H-FACULTY-CLASH";
export const GROUP_CLASH = "H-GROUP-CLASH";
export const ROOM_CLASH = "H-ROOM-CLASH";
export const FACULTY_UNAVAILABLE = "H-FACULTY-UNAVAILABLE";
export const ROOM_UNAVAILABLE = "H-ROOM-UNAVAILABLE";
export const ROOM_TYPE_UNSUITABLE = "H-ROOM-TYPE";
export const ROOM_CAPACITY = "H-ROOM-CAPACITY";
export const SESSION_MISSING = "H-SESSION-MISSING";
export const SESSION_DUPLICATE = "H-SESSION-DUPLICATE";
export const DURATION_MISMATCH = "H-DURATION-MISMATCH";
export const NOT_CONSECUTIVE = "H-NOT-CONSECUTIVE";
export const BREAK_PLACEMENT = "H-BREAK-PLACEMENT";
export const FIXED_SLOT_CHANGED = "H-FIXED-SLOT";
export const FIXED_ROOM_CHANGED = "H-FIXED-ROOM";
export const FIXED_FACULTY_CHANGED = "H-FIXED-FACULTY";
export const LOCKED_CHANGED = "H-LOCKED-CHANGED";
export const FACULTY_MAX_PERIODS = "H-FACULTY-MAX-PERIODS";
export const ORPHAN_SESSION = "H-ORPHAN-SESSION";
export const ORPHAN_ROOM = "H-ORPHAN-ROOM";
export const ORPHAN_FACULTY = "H-ORPHAN-FACULTY";
export const ORPHAN_SLOT = "H-ORPHAN-SLOT";

// Soft preferences (requirements.md section 8) - severity "warning", never "error".
export const SUBJECT_CLUSTER = "W-SUBJECT-CLUSTER";
export const GROUP_GAPS = "W-GROUP-GAPS";
export const FACULTY_GAPS = "W-FACULTY-GAPS";
export const WORKLOAD_IMBALANCE = "W-WORKLOAD-IMBALANCE";

export const HARD_RULES: ReadonlySet<string> = new Set([
  FACULTY_CLASH,
  GROUP_CLASH,
  ROOM_CLASH,
  FACULTY_UNAVAILABLE,
  ROOM_UNAVAILABLE,
  ROOM_TYPE_UNSUITABLE,
  ROOM_CAPACITY,
  SESSION_MISSING,
  SESSION_DUPLICATE,
  DURATION_MISMATCH,
  NOT_CONSECUTIVE,
  BREAK_PLACEMENT,
  FIXED_SLOT_CHANGED,
  FIXED_ROOM_CHANGED,
  FIXED_FACULTY_CHANGED,
  LOCKED_CHANGED,
  FACULTY_MAX_PERIODS,
  ORPHAN_SESSION,
  ORPHAN_ROOM,
  ORPHAN_FACULTY,
  ORPHAN_SLOT,
]);

export const SOFT_RULES: ReadonlySet<string> = new Set([
  SUBJECT_CLUSTER,
  GROUP_GAPS,
  FACULTY_GAPS,
  WORKLOAD_IMBALANCE,
]);
