"""Stable rule identifiers for validator findings.

These strings are part of the machine-addressable contract of the validator:
UI, API and tests refer to findings by these ids.  Never rename one without a
deliberate migration.  ``H-`` rules are hard constraints (ERROR), ``W-`` rules
are soft preferences (WARNING).
"""

# Hard constraints (requirements.md sections 8 and 9) - severity ERROR.
FACULTY_CLASH = "H-FACULTY-CLASH"
GROUP_CLASH = "H-GROUP-CLASH"
ROOM_CLASH = "H-ROOM-CLASH"
FACULTY_UNAVAILABLE = "H-FACULTY-UNAVAILABLE"
ROOM_UNAVAILABLE = "H-ROOM-UNAVAILABLE"
ROOM_TYPE_UNSUITABLE = "H-ROOM-TYPE"
ROOM_CAPACITY = "H-ROOM-CAPACITY"
SESSION_MISSING = "H-SESSION-MISSING"
SESSION_DUPLICATE = "H-SESSION-DUPLICATE"
DURATION_MISMATCH = "H-DURATION-MISMATCH"
NOT_CONSECUTIVE = "H-NOT-CONSECUTIVE"
BREAK_PLACEMENT = "H-BREAK-PLACEMENT"
FIXED_SLOT_CHANGED = "H-FIXED-SLOT"
FIXED_ROOM_CHANGED = "H-FIXED-ROOM"
FIXED_FACULTY_CHANGED = "H-FIXED-FACULTY"
LOCKED_CHANGED = "H-LOCKED-CHANGED"
FACULTY_MAX_PERIODS = "H-FACULTY-MAX-PERIODS"
ORPHAN_SESSION = "H-ORPHAN-SESSION"
ORPHAN_ROOM = "H-ORPHAN-ROOM"
ORPHAN_FACULTY = "H-ORPHAN-FACULTY"
ORPHAN_SLOT = "H-ORPHAN-SLOT"

# Soft preferences (requirements.md section 8) - severity WARNING, never ERROR.
SUBJECT_CLUSTER = "W-SUBJECT-CLUSTER"
GROUP_GAPS = "W-GROUP-GAPS"
FACULTY_GAPS = "W-FACULTY-GAPS"
WORKLOAD_IMBALANCE = "W-WORKLOAD-IMBALANCE"

HARD_RULES = frozenset(
    v for k, v in list(globals().items()) if isinstance(v, str) and v.startswith("H-")
)
SOFT_RULES = frozenset(
    v for k, v in list(globals().items()) if isinstance(v, str) and v.startswith("W-")
)
