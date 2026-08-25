import {
  getGradeValue,
  getTraineeTotals,
  getTraineeTotalsWeighted,
  isWeightedMode,
  kindLabel,
  parseCsv,
  rowsToObjects,
  today
} from "./courseData";
import type { AppState, AssessmentKind, CourseTrainer, Trainee } from "./types";
import type { SheetData } from "write-excel-file/browser";

export async function readTraineeRows(file: File) {
  if (file.name.toLowerCase().endsWith(".csv")) {
    return parseCsv(await file.text());
  }

  const { readSheet } = await import("read-excel-file/browser");
  return rowsToObjects((await readSheet(file)) as unknown[][]);
}

export async function exportGradesWorkbook({
  state,
  trainees,
  courseTrainers,
  sectionKind,
  sectionNumber,
}: {
  state: AppState;
  trainees: Trainee[];
  courseTrainers: CourseTrainer[];
  sectionKind: "all" | AssessmentKind;
  sectionNumber: string;
}) {
  const { default: writeXlsxFile } = await import("write-excel-file/browser");
  const headers = [
    "اسم الكلية", "القسم", "التخصص", "اسم المدرب", "الرقم الوظيفي",
    "مدربو المقرر", "اسم المقرر", "رمز المقرر", "نوع الشعبة", "رقم الشعبة",
    "الرقم التدريبي", "اسم المتدرب", "الشعبة النظرية", "الشعبة العملية",
    "مجموع النظري", "مجموع العملي", "المجموع الكامل",
    ...state.assessments.map((assessment) => assessment.name)
  ];
  const rows = trainees.map((trainee) => {
    const totals = isWeightedMode(state.assessments)
      ? getTraineeTotalsWeighted(trainee.id, state.assessments, state.grades)
      : getTraineeTotals(trainee.id, state.assessments, state.grades);
    return [
      state.account.collegeName, state.account.departmentName, state.account.majorName,
      state.trainer.name, state.trainer.employeeNumber,
      courseTrainers.map((trainer) => trainer.name || "مدرب بدون اسم").join("، "),
      state.course.name, state.course.code, kindLabel(state.course.kind), state.course.sectionNumber,
      trainee.trainingNumber, trainee.name, trainee.theorySection, trainee.practicalSection,
      totals.theory, totals.practical, totals.total,
      ...state.assessments.map((assessment) => getGradeValue(trainee.id, assessment.id, state.grades) || 0)
    ];
  });
  const sheetData: SheetData = [
    headers.map((value) => ({ value, fontWeight: "bold" as const })),
    ...rows.map((row) => row.map((value) => ({ value })))
  ];
  const sectionSuffix =
    sectionKind === "all"
      ? "كل-الشعب"
      : `${kindLabel(sectionKind)}-${sectionNumber || "كل-الشعب"}`;

  await writeXlsxFile(sheetData).toFile(`درجات-${state.course.name || "المقرر"}-${sectionSuffix}-${today()}.xlsx`);
}
