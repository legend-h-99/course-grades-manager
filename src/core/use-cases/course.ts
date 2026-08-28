/**
 * Course management use cases — code generation, assessments, trainees.
 * Pure functions: no port dependencies, no side effects, fully testable.
 */

import type { Assessment, AssessmentKind, Grade, Trainee } from "../../types";
import { today } from "../../courseData";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Generate a random 8-character invite code. Uniqueness is enforced server-side. */
export function generateCourseCode(): string {
  return Array.from(
    { length: 8 },
    () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)],
  ).join("");
}

/** Return a blank assessment draft initialised with the course's primary kind. */
export function defaultAssessmentDraft(kind: AssessmentKind) {
  return { name: "", kind, maxScore: 10, date: today(), weight: 0 };
}

/** Append a validated assessment to the list; throws on invalid input. */
export function addAssessment(
  assessments: Assessment[],
  draft: { name: string; kind: AssessmentKind; maxScore: number; date: string; weight: number },
): Assessment[] {
  if (!draft.name.trim()) throw new Error("اسم الاختبار مطلوب.");
  if (draft.maxScore <= 0) throw new Error("الدرجة القصوى يجب أن تكون أكبر من الصفر.");
  return [
    ...assessments,
    {
      id: crypto.randomUUID(),
      name: draft.name.trim(),
      kind: draft.kind,
      maxScore: draft.maxScore,
      date: draft.date,
      weight: draft.weight,
    },
  ];
}

/** Remove an assessment and all grades that reference it. */
export function removeAssessment(
  assessments: Assessment[],
  grades: Grade[],
  assessmentId: string,
): { assessments: Assessment[]; grades: Grade[] } {
  return {
    assessments: assessments.filter((a) => a.id !== assessmentId),
    grades: grades.filter((g) => g.assessmentId !== assessmentId),
  };
}

/** Update a single field on a trainee row. */
export function updateTrainee(
  trainees: Trainee[],
  id: string,
  field: keyof Trainee,
  value: string,
): Trainee[] {
  return trainees.map((t) => (t.id === id ? { ...t, [field]: value } : t));
}

/** Remove a trainee and all grades that reference them. */
export function removeTrainee(
  trainees: Trainee[],
  grades: Grade[],
  traineeId: string,
): { trainees: Trainee[]; grades: Grade[] } {
  return {
    trainees: trainees.filter((t) => t.id !== traineeId),
    grades: grades.filter((g) => g.traineeId !== traineeId),
  };
}
