import { describe, expect, it } from "vitest";
import { buildTraineeReportHtml } from "./reporting";
import type { AppState, Trainee } from "./types";

describe("buildTraineeReportHtml", () => {
  it("escapes user-controlled values before writing printable HTML", () => {
    const trainee: Trainee = {
      id: "t1",
      trainingNumber: "100<script>",
      name: '<img src=x onerror="alert(1)">',
      theorySection: "ن-1",
      practicalSection: "ع-1",
    };
    const state: AppState = {
      account: { collegeName: "كلية <تقنية>", departmentName: "", majorName: "" },
      trainer: { name: "", employeeNumber: "" },
      trainers: [],
      course: { name: "مقرر & خاص", kind: "theory", sectionNumber: "ن-1", savedAt: "", updatedAt: "", inviteCode: "", code: "ABC12345" },
      trainees: [trainee],
      assessments: [
        { id: "a1", name: 'اختبار "نهائي"', kind: "theory", maxScore: 20, date: "2026-01-01", weight: 0 },
      ],
      grades: [{ traineeId: "t1", assessmentId: "a1", score: 19 }],
    };

    const html = buildTraineeReportHtml(trainee, state, [
      { userId: "u1", name: "<مدرب>", employeeNumber: "", joinedAt: "" },
    ]);

    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).toContain("كلية &lt;تقنية&gt; - مقرر &amp; خاص");
    expect(html).toContain("اختبار &quot;نهائي&quot;");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("100<script>");
  });
});
