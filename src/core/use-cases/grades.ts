/**
 * Grade and trainee-import use cases.
 * updateGrade is pure (no port). importTraineesFromFile depends only on FileParserPort.
 * addManualTrainees is pure.
 */

import type { Assessment, CourseSetup, Grade, Trainee } from "../../types";
import type { FileParserPort } from "../ports";
import { mapRowsToTrainees, numberOrZero } from "../../courseData";

/**
 * Immutably set a grade score, clamped to [0, maxScore].
 * An empty string clears the grade entry without deleting the row.
 */
export function updateGrade(
  grades: Grade[],
  traineeId: string,
  assessmentId: string,
  rawScore: string,
  assessments: Assessment[],
): Grade[] {
  const assessment = assessments.find((a) => a.id === assessmentId);
  const score =
    rawScore === ""
      ? ""
      : Math.min(Math.max(numberOrZero(rawScore), 0), assessment?.maxScore ?? 100);

  const exists = grades.some(
    (g) => g.traineeId === traineeId && g.assessmentId === assessmentId,
  );
  if (exists) {
    return grades.map((g) =>
      g.traineeId === traineeId && g.assessmentId === assessmentId ? { ...g, score } : g,
    );
  }
  return [...grades, { traineeId, assessmentId, score }];
}

/**
 * Parse a spreadsheet/CSV file into Trainee objects.
 * File reading is delegated to FileParserPort (infrastructure concern).
 * Row-to-Trainee mapping is a pure domain function.
 */
export async function importTraineesFromFile(
  port: FileParserPort,
  file: File,
  course: CourseSetup,
): Promise<Trainee[]> {
  if (file.size > 10 * 1024 * 1024) {
    throw new Error("حجم الملف أكبر من 10MB. يُرجى تقليص الملف.");
  }
  const rows = await port.readFile(file);
  const trainees = mapRowsToTrainees(rows, course);
  if (!trainees.length) throw new Error("لم يتم العثور على متدربين في الملف.");
  return trainees;
}

/**
 * Parse free-form text (one trainee per line) and merge with the existing list.
 * Supports "number, name" and "name" line formats.
 * Applies section assignment if a section filter is active.
 */
export function addManualTrainees(
  existing: Trainee[],
  rawText: string,
  course: CourseSetup,
  sectionKind: "all" | "theory" | "practical",
  sectionNumber: string,
): Trainee[] {
  const rows = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const parts = line.split(/[,،\t]/).map((p) => p.trim()).filter(Boolean);
      if (parts.length >= 2) {
        return { "الرقم التدريبي": parts[0], "اسم المتدرب": parts.slice(1).join(" ") };
      }
      return {
        "الرقم التدريبي": String(existing.length + index + 1),
        "اسم المتدرب": parts[0] ?? "",
      };
    });

  const newTrainees = mapRowsToTrainees(rows, course).map((trainee) => {
    if (sectionKind === "all" || !sectionNumber.trim()) return trainee;
    return sectionKind === "theory"
      ? { ...trainee, theorySection: sectionNumber.trim() }
      : { ...trainee, practicalSection: sectionNumber.trim() };
  });

  if (!newTrainees.length) throw new Error("لا توجد أسماء صالحة للإضافة.");
  return [...existing, ...newTrainees];
}
