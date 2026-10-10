"""Tunable soft-objective weights for the Chronos CP-SAT solver.

Every soft preference the solver optimises is weighted here and nowhere else.
Soft terms only ever contribute to the objective function of the CP-SAT model;
hard constraints are posted as model constraints, so no weight in this file can
override a hard constraint.
"""

from __future__ import annotations

# Penalty for each extra session of the same subject (for the same set of
# student groups) scheduled on the same day. Pushes repeated sessions of a
# subject onto different days.
W_SPREAD_SAME_DAY = 8

# Penalty per idle teaching period sandwiched between busy periods in a
# student group's day. Breaks are not teaching periods and never count as gaps.
W_GROUP_GAP = 6

# Penalty per idle teaching period sandwiched between busy periods in a
# faculty member's day.
W_FACULTY_GAP = 3

# A faculty member teaching more than this many contiguous periods in a row
# starts accruing W_EXCESS_CONSECUTIVE per sliding window that exceeds it.
MAX_DESIRED_CONSECUTIVE_TEACHING = 3
W_EXCESS_CONSECUTIVE = 4

# Penalty per period of a faculty member's busiest day. Minimising the peak
# daily load balances teaching across the week.
W_DAILY_LOAD_BALANCE = 2

# Disruption penalties, applied only when Problem.locked_placements carries
# prior placements with locked=False (the previous timetable). Locked=True
# placements are preserved as hard constraints and need no weight. For each
# unlocked prior placement, deviating from its slots / room / faculty costs:
W_DISRUPTION_SLOT = 25
W_DISRUPTION_ROOM = 10
W_DISRUPTION_FACULTY = 15
