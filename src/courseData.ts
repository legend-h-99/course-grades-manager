import type { AppState, Assessment, CourseRecord, CourseSetup, CourseTrainer, Grade, TrainerProfile, Trainee } from "./types";

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export const starterState: AppState = {
  account: { collegeName: "", departmentName: "", majorName: "" },
  trainer: { name: "", employeeNumber: "" },
  trainers: [],
  course: { name: "", kind: "theory", sectionNumber: "", savedAt: "", code: "" },
  trainees: [],
  assessments: [
    { id: crypto.randomUUID(), name: "اختبار نظري 1", kind: "theory", maxScore: 20, date: today() },
    { id: crypto.randomUUID(), name: "تقييم عملي 1", kind: "practical", maxScore: 30, date: today() }
  ],
  grades: []
};

export function numberOrZero(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function kindLabel(kind: CourseSetup["kind"]) {
  return kind === "theory" ? "نظري" : "عملي";
}

export function normalizeCourseCode(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

export function generateCourseCode(records: CourseRecord[]) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    code = Array.from({ length: 8 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  } while (records.some((record) => record.code === code));
  return code;
}

export function trainerEntry(userId: string, trainer: TrainerProfile): CourseTrainer {
  return {
    userId,
    name: trainer.name,
    employeeNumber: trainer.employeeNumber,
    joinedAt: new Date().toISOString()
  };
}

export function mergeTrainer(trainers: CourseTrainer[], trainer: CourseTrainer) {
  return trainers.some((item) => item.userId === trainer.userId)
    ? trainers.map((item) => (item.userId === trainer.userId ? { ...item, ...trainer } : item))
    : [...trainers, trainer];
}

export function withCourseTrainer(userId: string, appState: AppState) {
  const trainer = trainerEntry(userId, appState.trainer);
  return {
    ...appState,
    trainers: mergeTrainer(appState.trainers ?? [], trainer)
  };
}

export function normalizeKey(key: string) {
  return key.trim().replace(/\s+/g, "").toLowerCase();
}

export function pick(row: Record<string, unknown>, names: string[]) {
  const entries = Object.entries(row);
  for (const wanted of names.map(normalizeKey)) {
    const match = entries.find(([key]) => normalizeKey(key) === wanted);
    if (match && match[1] !== undefined && match[1] !== null) return String(match[1]).trim();
  }
  return "";
}

export function rowsToObjects(rows: unknown[][]) {
  const [headerRow, ...bodyRows] = rows;
  const headers = (headerRow ?? []).map((cell) => String(cell ?? "").trim());
  return bodyRows.map((row) => {
    return headers.reduce<Record<string, unknown>>((record, header, index) => {
      if (header) record[header] = row[index];
      return record;
    }, {});
  });
}

export function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rowsToObjects(rows);
}

export function mapRowsToTrainees(rows: Record<string, unknown>[], course: CourseSetup) {
  return rows
    .map((row, index) => {
      const trainingNumber =
        pick(row, ["الرقم التدريبي", "رقم المتدرب", "رقم", "trainingNumber", "id"]) ||
        String(index + 1);
      const name = pick(row, ["اسم المتدرب", "الاسم", "اسم", "name"]);
      if (!name) return null;
      return applyCourseSection(
        {
          id: crypto.randomUUID(),
          trainingNumber,
          name,
          theorySection: pick(row, ["الشعبة النظرية", "شعبة نظري", "نظري", "theorySection"]),
          practicalSection: pick(row, ["الشعبة العملية", "شعبة عملي", "عملي", "practicalSection"])
        },
        course
      );
    })
    .filter(Boolean) as Trainee[];
}

export function applyCourseSection(trainee: Trainee, course: CourseSetup) {
  if (!course.sectionNumber.trim()) return trainee;
  if (course.kind === "theory") {
    return { ...trainee, theorySection: trainee.theorySection || course.sectionNumber };
  }
  return { ...trainee, practicalSection: trainee.practicalSection || course.sectionNumber };
}

export function getGradeValue(traineeId: string, assessmentId: string, grades: Grade[]) {
  return grades.find((grade) => grade.traineeId === traineeId && grade.assessmentId === assessmentId)?.score ?? "";
}

export function getTraineeTotals(traineeId: string, assessments: Assessment[], grades: Grade[]) {
  const theoryIds = new Set(assessments.filter((item) => item.kind === "theory").map((item) => item.id));
  const practicalIds = new Set(assessments.filter((item) => item.kind === "practical").map((item) => item.id));
  const theory = grades
    .filter((grade) => grade.traineeId === traineeId && theoryIds.has(grade.assessmentId))
    .reduce((sum, grade) => sum + numberOrZero(grade.score), 0);
  const practical = grades
    .filter((grade) => grade.traineeId === traineeId && practicalIds.has(grade.assessmentId))
    .reduce((sum, grade) => sum + numberOrZero(grade.score), 0);
  return { theory, practical, total: theory + practical };
}
