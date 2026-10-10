"""Independent timetable validator for Chronos.

Checks final placements against the canonical data and rules, entirely
independently of the solver (requirements.md section 9).
"""
from chronos.validator import rule_ids
from chronos.validator.engine import is_publish_ready, validate

__all__ = ["validate", "is_publish_ready", "rule_ids"]
