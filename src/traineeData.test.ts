/**
 * Tests for trainee data operations:
 * - File import (CSV / Excel-like rows)
 * - Manual text entry
 * - Grade updates
 * - Performance with large datasets
 */
import { describe, expect, it, vi } from "vitest";
import {
  importTraineesFromFile,
  addManualTrainees,
  updateGrade,
} from "./core/use-cases/grades";
import type { FileParserPort } from "./core/ports";
import type { Assessment, CourseSetup, Grade } from "./types";
import { parseCsv, rowsToObjects } from "./courseData";

// ── Helpers ─────────────────────────────────────────────────────────────────

const theoryCourse: CourseSetup = {
  name: "برمجة وب",
  kind: "theory",
  sectionNumber: "ن-1",
  savedAt: "",
  updatedAt: "",
  inviteCode: "",
  code: "WEB12345",
};

const mixedCourse: CourseSetup = {
  name: "شبكات",
  kind: "both",
  sectionNumber: "ن-2",
  savedAt: "",
  updatedAt: "",
  inviteCode: "",
  code: "NET12345",
};

function makeFilePort(rows: Record<string, unknown>[]): FileParserPort {
  return { readFile: vi.fn().mockResolvedValue(rows) };
}

function makeFile(name: string, sizeBytes = 1024): File {
  const blob = new Blob(["x".repeat(sizeBytes)], { type: "application/octet-stream" });
  return new File([blob], name);
}

const assessments: Assessment[] = [
  { id: "a1", name: "اختبار نظري", kind: "theory", maxScore: 20, date: "2026-01-01", weight: 0 },
  { id: "a2", name: "تقييم عملي",  kind: "practical", maxScore: 30, date: "2026-01-02", weight: 0 },
];

// ── importTraineesFromFile ───────────────────────────────────────────────────

describe("importTraineesFromFile", () => {
  it("imports trainees with Arabic column headers", async () => {
    const rows = [
      { "الرقم التدريبي": "1001", "اسم المتدرب": "محمد عبدالله" },
      { "الرقم التدريبي": "1002", "اسم المتدرب": "سارة أحمد" },
    ];
    const port = makeFilePort(rows);
    const trainees = await importTraineesFromFile(port, makeFile("data.xlsx"), theoryCourse);

    expect(trainees).toHaveLength(2);
    expect(trainees[0]).toMatchObject({ trainingNumber: "1001", name: "محمد عبدالله", theorySection: "ن-1" });
    expect(trainees[1]).toMatchObject({ trainingNumber: "1002", name: "سارة أحمد" });
  });

  it("imports trainees with English column headers", async () => {
    const rows = [{ trainingNumber: "2001", name: "Ali Hassan" }];
    const port = makeFilePort(rows);
    const trainees = await importTraineesFromFile(port, makeFile("students.xlsx"), theoryCourse);

    expect(trainees[0]).toMatchObject({ trainingNumber: "2001", name: "Ali Hassan" });
  });

  it("fills missing section from course when row has none", async () => {
    const rows = [{ "الرقم التدريبي": "3001", "اسم المتدرب": "خالد" }];
    const port = makeFilePort(rows);
    const trainees = await importTraineesFromFile(port, makeFile("data.xlsx"), theoryCourse);

    expect(trainees[0].theorySection).toBe("ن-1");
  });

  it("preserves existing section from the spreadsheet", async () => {
    const rows = [{ "الرقم التدريبي": "4001", "اسم المتدرب": "نورة", "الشعبة النظرية": "ن-5" }];
    const port = makeFilePort(rows);
    const trainees = await importTraineesFromFile(port, makeFile("data.xlsx"), theoryCourse);

    expect(trainees[0].theorySection).toBe("ن-5");
  });

  it("skips rows without a name", async () => {
    const rows = [
      { "الرقم التدريبي": "5001", "اسم المتدرب": "" },
      { "الرقم التدريبي": "5002", "اسم المتدرب": "أحمد" },
    ];
    const port = makeFilePort(rows);
    const trainees = await importTraineesFromFile(port, makeFile("data.xlsx"), theoryCourse);

    expect(trainees).toHaveLength(1);
    expect(trainees[0].name).toBe("أحمد");
  });

  it("throws when file has no trainees", async () => {
    const port = makeFilePort([]);
    await expect(importTraineesFromFile(port, makeFile("empty.xlsx"), theoryCourse))
      .rejects.toThrow("لم يتم العثور على متدربين");
  });

  it("throws when file is larger than 10MB", async () => {
    const bigFile = makeFile("big.xlsx", 11 * 1024 * 1024);
    const port = makeFilePort([]);
    await expect(importTraineesFromFile(port, bigFile, theoryCourse))
      .rejects.toThrow("10MB");
  });

  it("each imported trainee gets a unique id", async () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      "الرقم التدريبي": String(1000 + i),
      "اسم المتدرب": `متدرب ${i + 1}`,
    }));
    const port = makeFilePort(rows);
    const trainees = await importTraineesFromFile(port, makeFile("data.xlsx"), theoryCourse);
    const ids = trainees.map((t) => t.id);

    expect(new Set(ids).size).toBe(20);
  });
});

// ── CSV parsing ──────────────────────────────────────────────────────────────

describe("CSV file parsing", () => {
  it("parses standard Arabic CSV correctly", () => {
    const csv = "الرقم التدريبي,اسم المتدرب\n1001,محمد\n1002,سارة";
    const rows = parseCsv(csv);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ "الرقم التدريبي": "1001", "اسم المتدرب": "محمد" });
  });

  it("handles names with commas inside quotes", () => {
    const csv = 'الرقم التدريبي,اسم المتدرب\n1001,"محمد، عبدالله"';
    const rows = parseCsv(csv);

    expect(rows[0]["اسم المتدرب"]).toBe("محمد، عبدالله");
  });

  it("handles Windows CRLF line endings", () => {
    const csv = "الرقم التدريبي,اسم المتدرب\r\n1001,أحمد\r\n1002,خالد";
    expect(parseCsv(csv)).toHaveLength(2);
  });

  it("ignores completely blank lines", () => {
    const csv = "الرقم التدريبي,اسم المتدرب\n1001,أحمد\n\n1002,خالد";
    expect(parseCsv(csv)).toHaveLength(2);
  });

  it("rowsToObjects stores null cells and pick() skips them safely", () => {
    const rows = rowsToObjects([
      ["الرقم التدريبي", "اسم المتدرب"],
      [null, "مجهول"],
    ]);
    // rowsToObjects stores the raw null; pick() guards against it
    expect(rows[0]["الرقم التدريبي"]).toBeNull();
    expect(rows[0]["اسم المتدرب"]).toBe("مجهول");
  });
});

// ── addManualTrainees ────────────────────────────────────────────────────────

describe("addManualTrainees", () => {
  it("adds trainees from 'number, name' lines", () => {
    const result = addManualTrainees([], "1001، محمد عبدالله\n1002، سارة أحمد", theoryCourse, "all", "");

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ trainingNumber: "1001", name: "محمد عبدالله" });
    expect(result[1]).toMatchObject({ trainingNumber: "1002", name: "سارة أحمد" });
  });

  it("adds trainees from name-only lines using sequential numbers", () => {
    const result = addManualTrainees([], "محمد\nسارة\nخالد", theoryCourse, "all", "");

    expect(result).toHaveLength(3);
    expect(result[0].name).toBe("محمد");
    expect(result[0].trainingNumber).toBe("1");
    expect(result[2].trainingNumber).toBe("3");
  });

  it("merges with existing trainees without duplication", () => {
    const existing = [{ id: "e1", trainingNumber: "500", name: "نورة", theorySection: "ن-1", practicalSection: "" }];
    const result = addManualTrainees(existing, "1001، أحمد", theoryCourse, "all", "");

    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("نورة");
    expect(result[1].name).toBe("أحمد");
  });

  it("assigns theory section when section filter is active", () => {
    const result = addManualTrainees([], "1001، محمد", theoryCourse, "theory", "ن-3");

    expect(result[0].theorySection).toBe("ن-3");
  });

  it("assigns practical section when section filter is practical", () => {
    const result = addManualTrainees([], "1001، علي", mixedCourse, "practical", "ع-2");

    expect(result[0].practicalSection).toBe("ع-2");
  });

  it("supports tab-separated number and name", () => {
    const result = addManualTrainees([], "1001\tمحمد عبدالله", theoryCourse, "all", "");

    expect(result[0]).toMatchObject({ trainingNumber: "1001", name: "محمد عبدالله" });
  });

  it("ignores blank lines in the input", () => {
    const result = addManualTrainees([], "محمد\n\n\nسارة", theoryCourse, "all", "");

    expect(result).toHaveLength(2);
  });

  it("throws when no valid names found", () => {
    expect(() => addManualTrainees([], "   \n  \n", theoryCourse, "all", ""))
      .toThrow("لا توجد أسماء صالحة");
  });

  it("sequential numbers start after existing trainees count", () => {
    const existing = [
      { id: "e1", trainingNumber: "1", name: "نورة", theorySection: "ن-1", practicalSection: "" },
      { id: "e2", trainingNumber: "2", name: "منى",  theorySection: "ن-1", practicalSection: "" },
    ];
    const result = addManualTrainees(existing, "خالد", theoryCourse, "all", "");

    expect(result[2].trainingNumber).toBe("3");
  });
});

// ── updateGrade ──────────────────────────────────────────────────────────────

describe("updateGrade", () => {
  it("creates a new grade entry when none exists", () => {
    const grades = updateGrade([], "t1", "a1", "15", assessments);

    expect(grades).toHaveLength(1);
    expect(grades[0]).toMatchObject({ traineeId: "t1", assessmentId: "a1", score: 15 });
  });

  it("updates an existing grade in place", () => {
    const initial: Grade[] = [{ traineeId: "t1", assessmentId: "a1", score: 10 }];
    const grades = updateGrade(initial, "t1", "a1", "18", assessments);

    expect(grades).toHaveLength(1);
    expect(grades[0].score).toBe(18);
  });

  it("clamps score at assessment maxScore", () => {
    const grades = updateGrade([], "t1", "a1", "999", assessments);

    expect(grades[0].score).toBe(20);
  });

  it("clamps score at 0 for negative input", () => {
    const grades = updateGrade([], "t1", "a1", "-5", assessments);

    expect(grades[0].score).toBe(0);
  });

  it("stores empty string for empty input (clear grade)", () => {
    const initial: Grade[] = [{ traineeId: "t1", assessmentId: "a1", score: 15 }];
    const grades = updateGrade(initial, "t1", "a1", "", assessments);

    expect(grades[0].score).toBe("");
  });

  it("does not mutate existing unrelated grades", () => {
    const initial: Grade[] = [
      { traineeId: "t1", assessmentId: "a1", score: 10 },
      { traineeId: "t2", assessmentId: "a2", score: 20 },
    ];
    const grades = updateGrade(initial, "t1", "a1", "18", assessments);

    expect(grades.find((g) => g.traineeId === "t2")?.score).toBe(20);
  });
});

// ── Performance ──────────────────────────────────────────────────────────────

describe("performance with large datasets", () => {
  const COUNT = 500;

  it(`imports ${COUNT} trainees in under 200ms`, async () => {
    const rows = Array.from({ length: COUNT }, (_, i) => ({
      "الرقم التدريبي": String(1000 + i),
      "اسم المتدرب": `متدرب ${i + 1}`,
      "الشعبة النظرية": i % 2 === 0 ? "ن-1" : "ن-2",
    }));
    const port = makeFilePort(rows);
    const t0 = performance.now();
    const trainees = await importTraineesFromFile(port, makeFile("big.xlsx"), theoryCourse);
    const elapsed = performance.now() - t0;

    expect(trainees).toHaveLength(COUNT);
    expect(elapsed).toBeLessThan(200);
  });

  it(`adds ${COUNT} manual trainees in under 100ms`, () => {
    const text = Array.from({ length: COUNT }, (_, i) => `${1000 + i}، متدرب ${i + 1}`).join("\n");
    const t0 = performance.now();
    const trainees = addManualTrainees([], text, theoryCourse, "all", "");
    const elapsed = performance.now() - t0;

    expect(trainees).toHaveLength(COUNT);
    expect(elapsed).toBeLessThan(100);
  });

  it(`updates ${COUNT * 2} grades in under 150ms`, () => {
    const tIds = Array.from({ length: COUNT }, (_, i) => `t${i}`);
    let grades: Grade[] = [];
    const t0 = performance.now();

    for (const id of tIds) {
      grades = updateGrade(grades, id, "a1", "15", assessments);
      grades = updateGrade(grades, id, "a2", "25", assessments);
    }
    const elapsed = performance.now() - t0;

    expect(grades).toHaveLength(COUNT * 2);
    expect(elapsed).toBeLessThan(150);
  });
});
