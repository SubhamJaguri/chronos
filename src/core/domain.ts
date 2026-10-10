export type ActivityType =
  | "lecture" | "lab" | "practical" | "elective" | "project" | "library" | "fixed";

export type RoomType = "classroom" | "lab" | "auditorium";

export interface TimeSlot {
  id: string;
  day: number;          // 0 = Monday
  period: number;       // 0-based ordinal within the day
  startMinute: number;
  endMinute: number;
  isBreak: boolean;
}

export interface Room {
  id: string;
  name: string;
  capacity: number;
  roomType: RoomType;
  facilities: string[];
  unavailableSlots: string[];
}

export interface Faculty {
  id: string;
  name: string;
  unavailableSlots: string[];
  maxPeriodsPerDay: number | null;
}

export interface StudentGroup {
  id: string;
  name: string;
  strength: number;
  parentId: string | null;
}

export interface Session {
  id: string;
  subjectId: string;
  subjectName: string;
  activityType: ActivityType;
  groupIds: string[];
  eligibleFacultyIds: string[];
  eligibleRoomIds: string[];
  durationPeriods: number;
  requiresConsecutive: boolean;
  fixedSlotId: string | null;
  fixedRoomId: string | null;
  fixedFacultyId: string | null;
}

export interface Placement {
  sessionId: string;
  slotIds: string[];
  roomId: string;
  facultyId: string;
  locked: boolean;
}

export interface Problem {
  slots: TimeSlot[];
  rooms: Room[];
  faculty: Faculty[];
  groups: StudentGroup[];
  sessions: Session[];
  lockedPlacements: Placement[];
}

export type SolveStatus = "optimal" | "feasible" | "infeasible" | "timeout";

export interface Solution {
  placements: Placement[];
  status: SolveStatus;
  diagnostics: string[];
}

export type Severity = "error" | "warning";

export interface Finding {
  ruleId: string;
  severity: Severity;
  message: string;
  sessionIds: string[];
  slotIds: string[];
}
