/** One triggering and one clean case for every hard rule (severity "error"). */
import { describe, expect, test } from "vitest";
import { validate } from "@/validator";
import * as ruleIds from "@/validator/ruleIds";
import { byRule, place, problem, rules, session } from "./brokenTimetables";

describe("H-FACULTY-CLASH", () => {
  test("faculty clash detected", () => {
    const prob = problem([
      session("S1", { groups: ["DIV1"] }),
      session("S2", { groups: ["DIV2"] }),
    ]);
    const placements = [
      place("S1", "D0P0", { room: "R1", fac: "F2" }),
      place("S2", "D0P0", { room: "R4", fac: "F2" }),
    ];
    const findings = validate(prob, placements);
    const hits = byRule(findings, ruleIds.FACULTY_CLASH);
    expect(hits).toHaveLength(1);
    const f = hits[0];
    expect(f.severity).toBe("error");
    expect(new Set(f.sessionIds)).toEqual(new Set(["S1", "S2"]));
    expect(f.slotIds).toEqual(["D0P0"]);
    expect(f.message).toContain("Dr. Iyer"); // names the actual faculty member
    expect(f.message).toContain("Suggested");
  });

  test("no faculty clash when slots differ", () => {
    const prob = problem([
      session("S1", { groups: ["DIV1"] }),
      session("S2", { groups: ["DIV2"] }),
    ]);
    const placements = [
      place("S1", "D0P0", { room: "R1", fac: "F2" }),
      place("S2", "D0P1", { room: "R1", fac: "F2" }),
    ];
    expect(rules(validate(prob, placements))).not.toContain(
      ruleIds.FACULTY_CLASH,
    );
  });
});

describe("H-GROUP-CLASH", () => {
  test("group clash on the same group", () => {
    const prob = problem([
      session("S1", { groups: ["DIV1"] }),
      session("S2", { subject: "PHY101", groups: ["DIV1"] }),
    ]);
    const placements = [
      place("S1", "D0P0", { room: "R1", fac: "F1" }),
      place("S2", "D0P0", { room: "R4", fac: "F2" }),
    ];
    const hits = byRule(validate(prob, placements), ruleIds.GROUP_CLASH);
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe("error");
    expect(new Set(hits[0].sessionIds)).toEqual(new Set(["S1", "S2"]));
    expect(hits[0].message).toContain("Division 1");
  });

  test("division lecture clashes with a lab of one of its own batches", () => {
    const prob = problem([
      session("LEC", { groups: ["DIV1"] }),
      session("LAB", { subject: "PHY101", activity: "lab", groups: ["B1"] }),
    ]);
    const placements = [
      place("LEC", "D0P0", { room: "R1", fac: "F1" }),
      place("LAB", "D0P0", { room: "R2", fac: "F2" }),
    ];
    const hits = byRule(validate(prob, placements), ruleIds.GROUP_CLASH);
    expect(hits).toHaveLength(1);
    expect(new Set(hits[0].sessionIds)).toEqual(new Set(["LAB", "LEC"]));
    expect(hits[0].message).toContain("Batch 1");
    expect(hits[0].message).toContain("Division 1");
  });

  test("sibling batches may run in parallel (disjoint students: no clash)", () => {
    const prob = problem([
      session("LAB1", { activity: "lab", groups: ["B1"] }),
      session("LAB2", { subject: "PHY101", activity: "lab", groups: ["B2"] }),
    ]);
    const placements = [
      place("LAB1", "D0P0", { room: "R2", fac: "F1" }),
      place("LAB2", "D0P0", { room: "R4", fac: "F2" }),
    ];
    expect(rules(validate(prob, placements))).not.toContain(
      ruleIds.GROUP_CLASH,
    );
  });

  test("lineage resolution survives a parentId cycle", () => {
    const groups = [
      { id: "G1", name: "Group 1", strength: 20, parentId: "G2" },
      { id: "G2", name: "Group 2", strength: 20, parentId: "G1" }, // cycle
      { id: "DIV2", name: "Division 2", strength: 55, parentId: null },
    ];
    const prob = problem(
      [
        session("S1", { groups: ["G1"] }),
        session("S2", { subject: "PHY101", groups: ["G2"] }),
      ],
      [],
      { groups },
    );
    const placements = [
      place("S1", "D0P0", { room: "R1", fac: "F1" }),
      place("S2", "D0P0", { room: "R4", fac: "F2" }),
    ];
    // Must terminate and still see G1/G2 as overlapping (same lineage).
    const hits = byRule(validate(prob, placements), ruleIds.GROUP_CLASH);
    expect(hits).toHaveLength(1);
  });
});

describe("H-ROOM-CLASH", () => {
  test("room clash detected", () => {
    const prob = problem([
      session("S1", { groups: ["DIV1"] }),
      session("S2", { groups: ["DIV2"] }),
    ]);
    const placements = [
      place("S1", "D0P0", { room: "R1", fac: "F1" }),
      place("S2", "D0P0", { room: "R1", fac: "F2" }),
    ];
    const hits = byRule(validate(prob, placements), ruleIds.ROOM_CLASH);
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe("error");
    expect(new Set(hits[0].sessionIds)).toEqual(new Set(["S1", "S2"]));
    expect(hits[0].message).toContain("Main Hall");
  });

  test("no room clash when rooms differ", () => {
    const prob = problem([
      session("S1", { groups: ["DIV1"] }),
      session("S2", { groups: ["DIV2"] }),
    ]);
    const placements = [
      place("S1", "D0P0", { room: "R1", fac: "F1" }),
      place("S2", "D0P0", { room: "R4", fac: "F2" }),
    ];
    expect(rules(validate(prob, placements))).not.toContain(ruleIds.ROOM_CLASH);
  });
});

describe("H-FACULTY-UNAVAILABLE", () => {
  test("faculty unavailability violation", () => {
    const prob = problem([session("S1")]);
    // F3 is unavailable at D0P1.
    const findings = validate(prob, [place("S1", "D0P1", { fac: "F3" })]);
    const hits = byRule(findings, ruleIds.FACULTY_UNAVAILABLE);
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe("error");
    expect(hits[0].message).toContain("Dr. Mehta");
    expect(hits[0].slotIds).toEqual(["D0P1"]);
  });

  test("faculty available slot is clean", () => {
    const prob = problem([session("S1")]);
    const findings = validate(prob, [place("S1", "D0P0", { fac: "F3" })]);
    expect(rules(findings)).not.toContain(ruleIds.FACULTY_UNAVAILABLE);
  });
});

describe("H-ROOM-UNAVAILABLE", () => {
  test("room unavailability violation", () => {
    const prob = problem([session("S1", { groups: ["ELEC1"] })]);
    // R3 is unavailable at D0P2.
    const findings = validate(prob, [place("S1", "D0P2", { room: "R3" })]);
    const hits = byRule(findings, ruleIds.ROOM_UNAVAILABLE);
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("Seminar Room");
    expect(hits[0].slotIds).toEqual(["D0P2"]);
  });

  test("room available slot is clean", () => {
    const prob = problem([session("S1", { groups: ["ELEC1"] })]);
    const findings = validate(prob, [place("S1", "D0P0", { room: "R3" })]);
    expect(rules(findings)).not.toContain(ruleIds.ROOM_UNAVAILABLE);
  });
});

describe("H-ROOM-TYPE", () => {
  test("lab in a classroom is unsuitable", () => {
    const prob = problem([session("LAB1", { activity: "lab", groups: ["B1"] })]);
    const findings = validate(prob, [place("LAB1", "D0P0", { room: "R1" })]);
    const hits = byRule(findings, ruleIds.ROOM_TYPE_UNSUITABLE);
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe("error");
    expect(hits[0].message).toContain("Main Hall");
    expect(hits[0].message).toContain("'lab'");
  });

  test("lab in a lab room is suitable", () => {
    const prob = problem([session("LAB1", { activity: "lab", groups: ["B1"] })]);
    const findings = validate(prob, [place("LAB1", "D0P0", { room: "R2" })]);
    expect(rules(findings)).not.toContain(ruleIds.ROOM_TYPE_UNSUITABLE);
  });

  test("lecture in a classroom is suitable", () => {
    const prob = problem([session("S1")]);
    const findings = validate(prob, [place("S1", "D0P0", { room: "R1" })]);
    expect(rules(findings)).not.toContain(ruleIds.ROOM_TYPE_UNSUITABLE);
  });
});

describe("H-ROOM-CAPACITY", () => {
  test("capacity exceeded by a single group", () => {
    const prob = problem([session("S1", { groups: ["DIV1"] })]); // 60 students
    const findings = validate(prob, [place("S1", "D0P0", { room: "R3" })]); // cap 25
    const hits = byRule(findings, ruleIds.ROOM_CAPACITY);
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("60");
    expect(hits[0].message).toContain("25");
    expect(hits[0].message).toContain("Seminar Room");
  });

  test("capacity exceeded by combined groups", () => {
    const prob = problem([session("S1", { groups: ["B1", "B2"] })]); // 30 + 30 = 60
    const findings = validate(prob, [place("S1", "D0P0", { room: "R3" })]);
    expect(rules(findings)).toContain(ruleIds.ROOM_CAPACITY);
  });

  test("does not double-count a batch inside its own division", () => {
    // DIV1 (60) already contains B1 (30): combined strength is 60, not 90,
    // so Main Hall (70) fits and no capacity finding may fire.
    const prob = problem([session("S1", { groups: ["DIV1", "B1"] })]);
    const findings = validate(prob, [place("S1", "D0P0", { room: "R1" })]);
    expect(rules(findings)).not.toContain(ruleIds.ROOM_CAPACITY);
  });

  test("sufficient capacity is clean", () => {
    const prob = problem([session("S1", { groups: ["DIV1"] })]);
    const findings = validate(prob, [place("S1", "D0P0", { room: "R1" })]); // 60 <= 70
    expect(rules(findings)).not.toContain(ruleIds.ROOM_CAPACITY);
  });
});

describe("H-SESSION-MISSING / H-SESSION-DUPLICATE", () => {
  test("missing required session", () => {
    const prob = problem([session("S1"), session("S2", { groups: ["DIV2"] })]);
    const findings = validate(prob, [place("S1", "D0P0")]);
    const hits = byRule(findings, ruleIds.SESSION_MISSING);
    expect(hits).toHaveLength(1);
    expect(hits[0].sessionIds).toEqual(["S2"]);
    expect(hits[0].severity).toBe("error");
  });

  test("duplicate session placement", () => {
    const prob = problem([session("S1")]);
    const findings = validate(prob, [place("S1", "D0P0"), place("S1", "D0P1")]);
    const hits = byRule(findings, ruleIds.SESSION_DUPLICATE);
    expect(hits).toHaveLength(1);
    expect(hits[0].sessionIds).toEqual(["S1"]);
    expect(hits[0].message).toContain("2 times");
  });

  test("exact coverage is clean", () => {
    const prob = problem([session("S1"), session("S2", { groups: ["DIV2"] })]);
    const findings = validate(prob, [place("S1", "D0P0"), place("S2", "D0P1")]);
    const found = rules(findings);
    expect(found).not.toContain(ruleIds.SESSION_MISSING);
    expect(found).not.toContain(ruleIds.SESSION_DUPLICATE);
  });
});

describe("H-DURATION-MISMATCH", () => {
  test("duration too short", () => {
    const prob = problem([
      session("LAB1", { activity: "lab", groups: ["B1"], duration: 2 }),
    ]);
    const findings = validate(prob, [place("LAB1", "D0P0", { room: "R2" })]);
    const hits = byRule(findings, ruleIds.DURATION_MISMATCH);
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("2 period(s)");
    expect(hits[0].message).toContain("1 slot(s)");
  });

  test("duplicate slot in a placement is a mismatch", () => {
    const prob = problem([
      session("LAB1", { activity: "lab", groups: ["B1"], duration: 2 }),
    ]);
    const findings = validate(prob, [
      place("LAB1", ["D0P0", "D0P0"], { room: "R2" }),
    ]);
    expect(rules(findings)).toContain(ruleIds.DURATION_MISMATCH);
  });

  test("correct duration is clean", () => {
    const prob = problem([
      session("LAB1", { activity: "lab", groups: ["B1"], duration: 2 }),
    ]);
    const findings = validate(prob, [
      place("LAB1", ["D0P0", "D0P1"], { room: "R2" }),
    ]);
    expect(rules(findings)).not.toContain(ruleIds.DURATION_MISMATCH);
  });
});

describe("H-NOT-CONSECUTIVE", () => {
  const lab2 = (sid = "LAB1") =>
    session(sid, {
      activity: "lab",
      groups: ["B1"],
      duration: 2,
      consecutive: true,
    });

  test("non-consecutive periods detected", () => {
    const prob = problem([lab2()]);
    const findings = validate(prob, [
      place("LAB1", ["D0P0", "D0P2"], { room: "R2" }),
    ]);
    const hits = byRule(findings, ruleIds.NOT_CONSECUTIVE);
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe("error");
  });

  test("run spanning the break is detected", () => {
    // Periods 2 and 4 are ordinally split by the period-3 break.
    const prob = problem([lab2()]);
    const findings = validate(prob, [
      place("LAB1", ["D0P2", "D0P4"], { room: "R2" }),
    ]);
    const hits = byRule(findings, ruleIds.NOT_CONSECUTIVE);
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("break");
  });

  test("placement wrapping across days is detected", () => {
    const prob = problem([lab2()]);
    const findings = validate(prob, [
      place("LAB1", ["D0P5", "D1P0"], { room: "R2" }),
    ]);
    const hits = byRule(findings, ruleIds.NOT_CONSECUTIVE);
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("Monday");
    expect(hits[0].message).toContain("Tuesday");
  });

  test("truly consecutive placement is clean", () => {
    const prob = problem([lab2()]);
    const findings = validate(prob, [
      place("LAB1", ["D0P1", "D0P2"], { room: "R2" }),
    ]);
    expect(rules(findings)).not.toContain(ruleIds.NOT_CONSECUTIVE);
  });
});

describe("H-BREAK-PLACEMENT", () => {
  test("placement on a break slot", () => {
    const prob = problem([session("S1")]);
    const findings = validate(prob, [place("S1", "D0P3")]); // period 3 is the break
    const hits = byRule(findings, ruleIds.BREAK_PLACEMENT);
    expect(hits).toHaveLength(1);
    expect(hits[0].slotIds).toEqual(["D0P3"]);
    expect(hits[0].severity).toBe("error");
  });

  test("teaching slot is not a break violation", () => {
    const prob = problem([session("S1")]);
    const findings = validate(prob, [place("S1", "D0P2")]);
    expect(rules(findings)).not.toContain(ruleIds.BREAK_PLACEMENT);
  });
});

describe("H-FIXED-SLOT / H-FIXED-ROOM / H-FIXED-FACULTY", () => {
  test("fixed slot not honoured", () => {
    const prob = problem([session("S1", { fixedSlot: "D0P0" })]);
    const findings = validate(prob, [place("S1", "D0P1")]);
    const hits = byRule(findings, ruleIds.FIXED_SLOT_CHANGED);
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("Monday period 0");
  });

  test("fixed room not honoured", () => {
    const prob = problem([
      session("S1", { groups: ["ELEC1"], fixedRoom: "R1" }),
    ]);
    const findings = validate(prob, [place("S1", "D0P0", { room: "R3" })]);
    const hits = byRule(findings, ruleIds.FIXED_ROOM_CHANGED);
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("Main Hall");
    expect(hits[0].message).toContain("Seminar Room");
  });

  test("fixed faculty not honoured", () => {
    const prob = problem([session("S1", { fixedFaculty: "F1" })]);
    const findings = validate(prob, [place("S1", "D0P0", { fac: "F2" })]);
    const hits = byRule(findings, ruleIds.FIXED_FACULTY_CHANGED);
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("Prof. Rao");
    expect(hits[0].message).toContain("Dr. Iyer");
  });

  test("honoured fixed assignments are clean", () => {
    const prob = problem([
      session("S1", { fixedSlot: "D0P0", fixedRoom: "R1", fixedFaculty: "F1" }),
    ]);
    const findings = validate(prob, [
      place("S1", "D0P0", { room: "R1", fac: "F1" }),
    ]);
    const found = rules(findings);
    expect(found).not.toContain(ruleIds.FIXED_SLOT_CHANGED);
    expect(found).not.toContain(ruleIds.FIXED_ROOM_CHANGED);
    expect(found).not.toContain(ruleIds.FIXED_FACULTY_CHANGED);
  });
});

describe("H-LOCKED-CHANGED", () => {
  test("locked placement moved", () => {
    const locked = place("S1", "D0P0", { room: "R1", fac: "F2", locked: true });
    const prob = problem([session("S1")], [locked]);
    const findings = validate(prob, [
      place("S1", "D0P1", { room: "R1", fac: "F2" }),
    ]);
    const hits = byRule(findings, ruleIds.LOCKED_CHANGED);
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe("error");
    expect(hits[0].message).toContain("unlock");
  });

  test("locked placement removed", () => {
    const locked = place("S1", "D0P0", { room: "R1", fac: "F2", locked: true });
    const prob = problem([session("S1")], [locked]);
    const found = rules(validate(prob, []));
    expect(found).toContain(ruleIds.LOCKED_CHANGED);
    expect(found).toContain(ruleIds.SESSION_MISSING);
  });

  test("preserved locked placement is clean even with reordered slots", () => {
    const locked = place("S1", ["D0P0", "D0P1"], {
      room: "R1",
      fac: "F2",
      locked: true,
    });
    const prob = problem([session("S1", { duration: 2 })], [locked]);
    const findings = validate(prob, [
      place("S1", ["D0P1", "D0P0"], { room: "R1", fac: "F2" }),
    ]);
    expect(rules(findings)).not.toContain(ruleIds.LOCKED_CHANGED);
  });
});

describe("H-FACULTY-MAX-PERIODS", () => {
  test("faculty daily maximum exceeded", () => {
    const sessions = [0, 1, 2, 3, 4].map((i) =>
      session(`S${i}`, { subject: `SUB${i}` }),
    );
    const prob = problem(sessions);
    const periods = [0, 1, 2, 4, 5]; // five teaching periods on Monday (3 is break)
    const placements = periods.map((p, i) =>
      place(`S${i}`, `D0P${p}`, { fac: "F1" }),
    );
    const findings = validate(prob, placements);
    const hits = byRule(findings, ruleIds.FACULTY_MAX_PERIODS);
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("Prof. Rao");
    expect(hits[0].message).toContain("5 periods");
    expect(hits[0].message).toContain("maximum of 4");
  });

  test("faculty daily maximum respected", () => {
    const sessions = [0, 1, 2, 3].map((i) =>
      session(`S${i}`, { subject: `SUB${i}` }),
    );
    const prob = problem(sessions);
    const periods = [0, 1, 2, 4];
    const placements = periods.map((p, i) =>
      place(`S${i}`, `D0P${p}`, { fac: "F1" }),
    );
    expect(rules(validate(prob, placements))).not.toContain(
      ruleIds.FACULTY_MAX_PERIODS,
    );
  });
});

describe("H-ORPHAN-*", () => {
  test("orphaned session reference", () => {
    const prob = problem([session("S1")]);
    const findings = validate(prob, [
      place("S1", "D0P0"),
      place("GHOST", "D0P1"),
    ]);
    const hits = byRule(findings, ruleIds.ORPHAN_SESSION);
    expect(hits).toHaveLength(1);
    expect(hits[0].sessionIds).toEqual(["GHOST"]);
  });

  test("orphaned room reference", () => {
    const prob = problem([session("S1")]);
    const findings = validate(prob, [
      place("S1", "D0P0", { room: "NO-SUCH-ROOM" }),
    ]);
    const hits = byRule(findings, ruleIds.ORPHAN_ROOM);
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("NO-SUCH-ROOM");
  });

  test("orphaned faculty reference", () => {
    const prob = problem([session("S1")]);
    const findings = validate(prob, [
      place("S1", "D0P0", { fac: "NO-SUCH-FACULTY" }),
    ]);
    const hits = byRule(findings, ruleIds.ORPHAN_FACULTY);
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("NO-SUCH-FACULTY");
  });

  test("orphaned slot reference", () => {
    const prob = problem([session("S1")]);
    const findings = validate(prob, [place("S1", "D9P9")]);
    const hits = byRule(findings, ruleIds.ORPHAN_SLOT);
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("D9P9");
  });

  test("valid references produce no orphans", () => {
    const prob = problem([session("S1")]);
    const found = rules(validate(prob, [place("S1", "D0P0")]));
    for (const ruleId of [
      ruleIds.ORPHAN_SESSION,
      ruleIds.ORPHAN_ROOM,
      ruleIds.ORPHAN_FACULTY,
      ruleIds.ORPHAN_SLOT,
    ]) {
      expect(found).not.toContain(ruleId);
    }
  });
});
