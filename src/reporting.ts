import {
  getGradeValue,
  getTraineeTotals,
  getTraineeTotalsWeighted,
  isWeightedMode,
  kindLabel
} from "./courseData";
import type { AppState, Assessment, CourseTrainer, Trainee } from "./types";

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function assessmentRows(assessments: Assessment[], traineeId: string, state: AppState, weighted: boolean) {
  return assessments
    .map((assessment) => {
      const score = getGradeValue(traineeId, assessment.id, state.grades);
      const contribution = weighted && assessment.weight ? ` (${assessment.weight}%)` : "";
      return `<tr><td>${escapeHtml(assessment.name)}${escapeHtml(contribution)}</td><td>${escapeHtml(score === "" ? "-" : score)} / ${escapeHtml(assessment.maxScore)}</td></tr>`;
    })
    .join("");
}

export function buildTraineeReportHtml(
  trainee: Trainee,
  state: AppState,
  courseTrainers: CourseTrainer[]
) {
  const weighted = isWeightedMode(state.assessments);
  const totals = weighted
    ? getTraineeTotalsWeighted(trainee.id, state.assessments, state.grades)
    : getTraineeTotals(trainee.id, state.assessments, state.grades);
  const theoryRows = assessmentRows(
    state.assessments.filter((assessment) => assessment.kind === "theory"),
    trainee.id,
    state,
    weighted
  );
  const practicalRows = assessmentRows(
    state.assessments.filter((assessment) => assessment.kind === "practical"),
    trainee.id,
    state,
    weighted
  );
  const trainers = courseTrainers.map((trainer) => trainer.name || "مدرب بدون اسم").join("، ");
  const subtitle = [state.account.collegeName, state.course.name].filter(Boolean).join(" - ");

  return `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8">
<title>تقرير ${escapeHtml(trainee.name)}</title><style>
body{font-family:"Segoe UI",Tahoma,Arial,sans-serif;direction:rtl;padding:32px;color:#17202a;max-width:560px;margin:auto;}
h1{color:#1f6f61;margin:0 0 4px;}
.sub{color:#607077;font-size:14px;margin:0 0 24px;}
table{width:100%;border-collapse:collapse;margin:12px 0 20px;}
th{background:#f7f9fa;padding:8px 12px;text-align:right;font-size:12px;color:#445158;border-bottom:2px solid #dce3e7;}
td{padding:8px 12px;border-bottom:1px solid #e0e6e9;font-size:14px;}
.sec{font-size:13px;font-weight:900;color:#1f6f61;margin:16px 0 4px;}
.total{background:#e8f3ee;border-radius:8px;padding:12px 16px;display:flex;justify-content:space-between;align-items:center;margin-top:16px;}
.total span{font-size:14px;color:#607077;}
.total strong{font-size:26px;color:#1f6f61;font-weight:900;}
@media print{button{display:none!important;}}
</style></head><body>
<button onclick="window.print()" style="margin-bottom:16px;padding:8px 16px;background:#1f6f61;color:#fff;border:0;border-radius:6px;cursor:pointer;font-size:14px;">طباعة / PDF</button>
<h1>تقرير متدرب</h1>
<p class="sub">${escapeHtml(subtitle)}</p>
<table>
<tr><th>الاسم</th><td>${escapeHtml(trainee.name)}</td></tr>
<tr><th>الرقم التدريبي</th><td>${escapeHtml(trainee.trainingNumber || "-")}</td></tr>
<tr><th>الشعبة النظرية</th><td>${escapeHtml(trainee.theorySection || "-")}</td></tr>
<tr><th>الشعبة العملية</th><td>${escapeHtml(trainee.practicalSection || "-")}</td></tr>
<tr><th>نوع المقرر</th><td>${escapeHtml(kindLabel(state.course.kind))}</td></tr>
<tr><th>مدربو المقرر</th><td>${escapeHtml(trainers || "-")}</td></tr>
</table>
${theoryRows ? `<p class="sec">درجات النظري</p><table><tr><th>الاختبار</th><th>الدرجة</th></tr>${theoryRows}</table>` : ""}
${practicalRows ? `<p class="sec">درجات العملي</p><table><tr><th>الاختبار</th><th>الدرجة</th></tr>${practicalRows}</table>` : ""}
<div class="total"><span>المجموع${weighted ? " الموزون" : ""}</span><strong>${escapeHtml(totals.total)}</strong></div>
</body></html>`;
}
