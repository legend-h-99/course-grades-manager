import {
  getGradeValue,
  groupGradesByTrainee,
  getTraineeTotals,
  getTraineeTotalsWeighted,
  isWeightedMode,
  kindLabel,
  parseCsv,
  rowsToObjects,
  sliceToDataTable,
  today
} from "./courseData";
import type { AppState, AssessmentKind, CourseTrainer, Trainee } from "./types";
import type { SheetData } from "write-excel-file/browser";

export async function readTraineeRows(file: File) {
  if (file.size > 10 * 1024 * 1024) {
    throw new Error("حجم الملف كبير جداً (الحد الأقصى 10 ميغابايت).");
  }
  if (file.name.toLowerCase().endsWith(".csv")) {
    return parseCsv(await file.text());
  }
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    throw new Error("صيغة الملف غير مدعومة. استخدم CSV أو XLSX؛ احفظ ملفات XLS القديمة بصيغة XLSX أولًا.");
  }

  const { readSheet } = await import("read-excel-file/browser");
  return rowsToObjects(sliceToDataTable((await readSheet(file)) as unknown[][]));
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
  const grouped = groupGradesByTrainee(state.grades);
  const rows = trainees.map((trainee) => {
    const grades = grouped.get(trainee.id) ?? [];
    const totals = isWeightedMode(state.assessments)
      ? getTraineeTotalsWeighted(trainee.id, state.assessments, grades)
      : getTraineeTotals(trainee.id, state.assessments, grades);
    return [
      state.account.collegeName, state.account.departmentName, state.account.majorName,
      state.trainer.name, state.trainer.employeeNumber,
      courseTrainers.map((trainer) => trainer.name || "مدرب بدون اسم").join("، "),
      state.course.name, state.course.code, kindLabel(state.course.kind), state.course.sectionNumber,
      trainee.trainingNumber, trainee.name, trainee.theorySection, trainee.practicalSection,
      totals.theory, totals.practical, totals.total,
      ...state.assessments.map((assessment) => getGradeValue(trainee.id, assessment.id, grades) || 0)
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
