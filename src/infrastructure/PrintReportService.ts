/**
 * DOM/browser implementation of ReportPort.
 * Opens print windows and triggers xlsx downloads.
 * Core use cases receive only the ReportPort interface — zero DOM knowledge.
 */

import { exportGradesWorkbook } from "../excel";
import { buildTraineeReportHtml } from "../reporting";
import type { ReportPort } from "../core/ports";
import type { AppState, AssessmentKind, CourseTrainer, Trainee } from "../types";

export class PrintReportService implements ReportPort {
  printTrainee(trainee: Trainee, state: AppState, trainers: CourseTrainer[]): void {
    const win = window.open("", "_blank", "width=680,height=900");
    if (!win) throw new Error("لم يتمكن المتصفح من فتح نافذة الطباعة.");
    win.document.write(buildTraineeReportHtml(trainee, state, trainers));
    win.document.close();
  }

  exportGrades(params: {
    state: AppState;
    trainees: Trainee[];
    courseTrainers: CourseTrainer[];
    sectionKind: "all" | AssessmentKind;
    sectionNumber: string;
  }): Promise<void> {
    return exportGradesWorkbook(params);
  }
}
