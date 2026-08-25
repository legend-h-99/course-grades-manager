import { describe, expect, it } from "vitest";
import {
  applyCourseSection,
  getClassStats,
  getGradeValue,
  getMaxPossibleTotal,
  getTraineeTotals,
  getTraineeTotalsWeighted,
  isWeightedMode,
  mapRowsToTrainees,
  normalizeCourseCode,
  parseCsv,
  rowsToObjects,
} from "./courseData";
import type { Assessment, CourseSetup, Grade, Trainee } from "./types";

const theoryCourse: CourseSetup = {
  name: "برمجة",
  kind: "theory",
  sectionNumber: "ن-1",
  savedAt: "",
  updatedAt: "",
  inviteCode: "",
  code: "ABC12345",
};

const assessments: Assessment[] = [
  { id: "a1", name: "اختبار نظري", kind: "theory", maxScore: 20, date: "2026-01-01", weight: 0 },
  { id: "a2", name: "تقييم عملي", kind: "practical", maxScore: 30, date: "2026-01-02", weight: 0 },
];

const weightedAssessments: Assessment[] = [
  { id: "a1", name: "اختبار نظري", kind: "theory", maxScore: 20, date: "2026-01-01", weight: 40 },
  { id: "a2", name: "تقييم عملي", kind: "practical", maxScore: 30, date: "2026-01-02", weight: 60 },
];

const trainees: Trainee[] = [
  { id: "t1", trainingNumber: "100", name: "سارة", theorySection: "ن-1", practicalSection: "ع-1" },
  { id: "t2", trainingNumber: "101", name: "علي", theorySection: "ن-1", practicalSection: "ع-1" },
];

const grades: Grade[] = [
  { traineeId: "t1", assessmentId: "a1", score: 18 },
  { traineeId: "t1", assessmentId: "a2", score: 27 },
  { traineeId: "t2", assessmentId: "a1", score: 10 },
  { traineeId: "t2", assessmentId: "a2", score: 15 },
];

describe("courseData", () => {
  it("normalizes course codes to alphanumeric uppercase", () => {
    expect(normalizeCourseCode(" ab-12 q ")).toBe("AB12Q");
  });

  it("parses CSV with quoted commas", () => {
    expect(parseCsv('اسم المتدرب,الرقم التدريبي\n"أحمد، محمد",123\n"Name, With comma",124')).toEqual([
      { "اسم المتدرب": "أحمد، محمد", "الرقم التدريبي": "123" },
      { "اسم المتدرب": "Name, With comma", "الرقم التدريبي": "124" },
    ]);
  });

  it("maps Arabic and English spreadsheet headers to trainees", () => {
    const rows = rowsToObjects([
      ["name", "trainingNumber", "الشعبة العملية"],
      ["نورة", "555", "ع-2"],
    ]);

    const [trainee] = mapRowsToTrainees(rows, theoryCourse);

    expect(trainee).toMatchObject({
      name: "نورة",
      trainingNumber: "555",
      theorySection: "ن-1",
      practicalSection: "ع-2",
    });
  });

  it("applies the active course section only when the trainee has no section", () => {
    expect(applyCourseSection({ ...trainees[0], theorySection: "" }, theoryCourse).theorySection).toBe("ن-1");
    expect(applyCourseSection({ ...trainees[0], theorySection: "ن-9" }, theoryCourse).theorySection).toBe("ن-9");
  });

  it("calculates raw theory, practical, and total scores", () => {
    expect(getGradeValue("t1", "a2", grades)).toBe(27);
    expect(getTraineeTotals("t1", assessments, grades)).toEqual({ theory: 18, practical: 27, total: 45 });
  });

  it("calculates weighted scores when assessment weights are present", () => {
    expect(isWeightedMode(weightedAssessments)).toBe(true);
    expect(getMaxPossibleTotal(weightedAssessments)).toBe(100);
    expect(getTraineeTotalsWeighted("t1", weightedAssessments, grades)).toEqual({
      theory: 36,
      practical: 54,
      total: 90,
    });
  });

  it("builds class statistics from totals", () => {
    const stats = getClassStats(trainees, assessments, grades);

    expect(stats).toMatchObject({
      avg: 35,
      median: 35,
      min: 25,
      max: 45,
      passCount: 1,
      passRate: 50,
    });
  });
});
