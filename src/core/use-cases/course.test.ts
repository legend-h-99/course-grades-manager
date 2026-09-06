/**
 * Tests for course management use cases in course.ts.
 * All functions are pure — no port mocking required.
 */
import { describe, expect, it } from "vitest";
import {
  generateCourseCode,
  defaultAssessmentDraft,
  addAssessment,
  removeAssessment,
  updateTrainee,
  removeTrainee,
} from "./course";
import type { Assessment, Grade, Trainee } from "../../types";

// ── Shared fixtures ───────────────────────────────────────────────────────────

const baseAssessments: Assessment[] = [
  { id: "a1", name: "اختبار نظري", kind: "theory", category: "coursework", maxScore: 20, date: "2026-01-01", weight: 0 },
  { id: "a2", name: "تقييم عملي", kind: "practical", category: "coursework", maxScore: 30, date: "2026-01-02", weight: 0 },
];

const baseGrades: Grade[] = [
  { traineeId: "t1", assessmentId: "a1", score: 18 },
  { traineeId: "t1", assessmentId: "a2", score: 25 },
  { traineeId: "t2", assessmentId: "a1", score: 10 },
];

const baseTrainees: Trainee[] = [
  { id: "t1", trainingNumber: "1001", name: "محمد", theorySection: "ن-1", practicalSection: "ع-1" },
  { id: "t2", trainingNumber: "1002", name: "سارة", theorySection: "ن-1", practicalSection: "ع-1" },
];

// ── generateCourseCode ────────────────────────────────────────────────────────

describe("generateCourseCode", () => {
  it("returns exactly 8 characters", () => {
    expect(generateCourseCode()).toHaveLength(8);
  });

  it("contains only uppercase letters and digits (no O, I, 1, 0)", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateCourseCode();
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    }
  });

  it("produces different codes across calls", () => {
    const codes = new Set(Array.from({ length: 20 }, () => generateCourseCode()));
    // Should not collide for 20 calls given 32^8 ≈ 10^12 possible codes
    expect(codes.size).toBeGreaterThan(15);
  });
});

// ── defaultAssessmentDraft ────────────────────────────────────────────────────

describe("defaultAssessmentDraft", () => {
  it("returns a theory draft with the correct shape", () => {
    const draft = defaultAssessmentDraft("theory");
    expect(draft).toMatchObject({ name: "", kind: "theory", category: "coursework", maxScore: 10, weight: 0 });
  });

  it("returns a practical draft with kind = practical", () => {
    const draft = defaultAssessmentDraft("practical");
    expect(draft.kind).toBe("practical");
  });

  it("includes a date field formatted as YYYY-MM-DD", () => {
    const draft = defaultAssessmentDraft("theory");
    expect(draft.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ── addAssessment ─────────────────────────────────────────────────────────────

describe("addAssessment", () => {
  it("throws when name is empty", () => {
    expect(() =>
      addAssessment(baseAssessments, {
        name: "",
        kind: "theory",
        category: "coursework",
        maxScore: 10,
        date: "2026-01-01",
        weight: 0,
      }),
    ).toThrow("اسم الاختبار مطلوب");
  });

  it("throws when name is whitespace only", () => {
    expect(() =>
      addAssessment(baseAssessments, {
        name: "   ",
        kind: "theory",
        category: "coursework",
        maxScore: 10,
        date: "2026-01-01",
        weight: 0,
      }),
    ).toThrow("اسم الاختبار مطلوب");
  });

  it("throws when maxScore is zero", () => {
    expect(() =>
      addAssessment(baseAssessments, {
        name: "اختبار",
        kind: "theory",
        category: "coursework",
        maxScore: 0,
        date: "2026-01-01",
        weight: 0,
      }),
    ).toThrow("الدرجة القصوى يجب أن تكون أكبر من الصفر");
  });

  it("throws when maxScore is negative", () => {
    expect(() =>
      addAssessment(baseAssessments, {
        name: "اختبار",
        kind: "theory",
        category: "coursework",
        maxScore: -5,
        date: "2026-01-01",
        weight: 0,
      }),
    ).toThrow("الدرجة القصوى يجب أن تكون أكبر من الصفر");
  });

  it("appends a new assessment to the list", () => {
    const result = addAssessment(baseAssessments, {
      name: "اختبار ثالث",
      kind: "theory",
      category: "coursework",
      maxScore: 15,
      date: "2026-02-01",
      weight: 0,
    });
    expect(result).toHaveLength(3);
    expect(result[2]).toMatchObject({ name: "اختبار ثالث", maxScore: 15 });
  });

  it("trims whitespace from the name", () => {
    const result = addAssessment([], {
      name: "  اختبار  ",
      kind: "theory",
      category: "coursework",
      maxScore: 10,
      date: "2026-01-01",
      weight: 0,
    });
    expect(result[0].name).toBe("اختبار");
  });

  it("assigns a valid UUID as the id", () => {
    const result = addAssessment([], {
      name: "اختبار",
      kind: "theory",
      category: "coursework",
      maxScore: 10,
      date: "2026-01-01",
      weight: 0,
    });
    expect(result[0].id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it("does not mutate the original assessments array", () => {
    const original = [...baseAssessments];
    addAssessment(baseAssessments, {
      name: "جديد",
      kind: "practical",
      category: "coursework",
      maxScore: 20,
      date: "2026-03-01",
      weight: 0,
    });
    expect(baseAssessments).toHaveLength(original.length);
  });
});

// ── removeAssessment ──────────────────────────────────────────────────────────

describe("removeAssessment", () => {
  it("removes the target assessment from the list", () => {
    const { assessments } = removeAssessment(baseAssessments, baseGrades, "a1");
    expect(assessments).toHaveLength(1);
    expect(assessments[0].id).toBe("a2");
  });

  it("removes all grades referencing the deleted assessment", () => {
    const { grades } = removeAssessment(baseAssessments, baseGrades, "a1");
    const orphans = grades.filter((g) => g.assessmentId === "a1");
    expect(orphans).toHaveLength(0);
  });

  it("preserves grades for other assessments", () => {
    const { grades } = removeAssessment(baseAssessments, baseGrades, "a1");
    expect(grades).toHaveLength(1);
    expect(grades[0]).toMatchObject({ traineeId: "t1", assessmentId: "a2" });
  });

  it("returns empty lists when removing the only assessment with all its grades", () => {
    const single: Assessment[] = [baseAssessments[0]];
    const related: Grade[] = baseGrades.filter((g) => g.assessmentId === "a1");
    const result = removeAssessment(single, related, "a1");
    expect(result.assessments).toHaveLength(0);
    expect(result.grades).toHaveLength(0);
  });

  it("is a no-op when the id does not exist", () => {
    const { assessments, grades } = removeAssessment(baseAssessments, baseGrades, "nonexistent");
    expect(assessments).toHaveLength(baseAssessments.length);
    expect(grades).toHaveLength(baseGrades.length);
  });
});

// ── updateTrainee ─────────────────────────────────────────────────────────────

describe("updateTrainee", () => {
  it("updates the specified field on the target trainee", () => {
    const result = updateTrainee(baseTrainees, "t1", "name", "أحمد");
    expect(result.find((t) => t.id === "t1")?.name).toBe("أحمد");
  });

  it("leaves other trainees unchanged", () => {
    const result = updateTrainee(baseTrainees, "t1", "name", "أحمد");
    expect(result.find((t) => t.id === "t2")?.name).toBe("سارة");
  });

  it("does not mutate the original trainees array", () => {
    updateTrainee(baseTrainees, "t1", "name", "أحمد");
    expect(baseTrainees[0].name).toBe("محمد");
  });

  it("updates theorySection correctly", () => {
    const result = updateTrainee(baseTrainees, "t2", "theorySection", "ن-3");
    expect(result.find((t) => t.id === "t2")?.theorySection).toBe("ن-3");
  });

  it("updates trainingNumber correctly", () => {
    const result = updateTrainee(baseTrainees, "t1", "trainingNumber", "9999");
    expect(result.find((t) => t.id === "t1")?.trainingNumber).toBe("9999");
  });

  it("returns the original array reference when id is not found", () => {
    const result = updateTrainee(baseTrainees, "nonexistent", "name", "X");
    // No trainee modified — all names remain the same
    expect(result.map((t) => t.name)).toEqual(baseTrainees.map((t) => t.name));
  });
});

// ── removeTrainee ─────────────────────────────────────────────────────────────

describe("removeTrainee", () => {
  it("removes the target trainee from the list", () => {
    const { trainees } = removeTrainee(baseTrainees, baseGrades, "t1");
    expect(trainees.map((t) => t.id)).not.toContain("t1");
    expect(trainees).toHaveLength(1);
  });

  it("removes all grades belonging to the deleted trainee", () => {
    const { grades } = removeTrainee(baseTrainees, baseGrades, "t1");
    const orphans = grades.filter((g) => g.traineeId === "t1");
    expect(orphans).toHaveLength(0);
  });

  it("preserves grades belonging to other trainees", () => {
    const { grades } = removeTrainee(baseTrainees, baseGrades, "t1");
    expect(grades).toHaveLength(1);
    expect(grades[0].traineeId).toBe("t2");
  });

  it("returns empty lists when the only trainee is removed", () => {
    const single = [baseTrainees[0]];
    const related = baseGrades.filter((g) => g.traineeId === "t1");
    const result = removeTrainee(single, related, "t1");
    expect(result.trainees).toHaveLength(0);
    expect(result.grades).toHaveLength(0);
  });

  it("is a no-op when the id does not exist", () => {
    const { trainees, grades } = removeTrainee(baseTrainees, baseGrades, "nonexistent");
    expect(trainees).toHaveLength(baseTrainees.length);
    expect(grades).toHaveLength(baseGrades.length);
  });
});
