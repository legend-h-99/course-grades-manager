import { describe, expect, it } from "vitest";
import { buildTraineeReportHtml } from "./reporting";
import type { AppState, Trainee } from "./types";

const baseCourse = {
  name: "مقرر & خاص",
  kind: "theory" as const,
  sectionNumber: "ن-1",
  savedAt: "",
  updatedAt: "",
  inviteCode: "",
  code: "ABC12345",
};

const baseAssessments = [
  { id: "a1", name: 'اختبار "نهائي"', kind: "theory" as const, maxScore: 20, date: "2026-01-01", weight: 0 },
];

function makeState(overrides: Partial<AppState["account"]> = {}): AppState {
  return {
    account: { collegeName: "كلية <تقنية>", departmentName: "", majorName: "", ...overrides },
    trainer: { name: "", employeeNumber: "" },
    trainers: [],
    course: baseCourse,
    trainees: [],
    assessments: baseAssessments,
    grades: [{ traineeId: "t1", assessmentId: "a1", score: 19 }],
  };
}

describe("buildTraineeReportHtml — XSS escaping", () => {
  it("escapes basic HTML injection in trainee fields", () => {
    const trainee: Trainee = {
      id: "t1",
      trainingNumber: "100<script>alert(1)</script>",
      name: '<img src=x onerror="alert(1)">',
      theorySection: "ن-1",
      practicalSection: "ع-1",
    };

    const html = buildTraineeReportHtml(trainee, makeState(), [
      { userId: "u1", name: "<مدرب>", employeeNumber: "", joinedAt: "" },
    ]);

    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).toContain("كلية &lt;تقنية&gt; - مقرر &amp; خاص");
    expect(html).toContain("اختبار &quot;نهائي&quot;");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("100<script>");
  });

  it("escapes SVG-based XSS vectors", () => {
    const trainee: Trainee = {
      id: "t1",
      trainingNumber: "200",
      name: "<svg onload=alert(1)>محمد</svg>",
      theorySection: "ن-1",
      practicalSection: "",
    };

    const html = buildTraineeReportHtml(trainee, makeState(), []);

    // Angle brackets must be escaped — no live SVG/HTML tag
    expect(html).not.toContain("<svg ");
    expect(html).not.toContain("</svg>");
    // The escaped representation is safe to appear as text content
    expect(html).toContain("&lt;svg onload=alert(1)&gt;");
  });

  it("escapes event-handler attribute injection", () => {
    const trainee: Trainee = {
      id: "t1",
      trainingNumber: "300",
      name: "أحمد",
      theorySection: '"><script>evil()</script>',
      practicalSection: "",
    };

    const html = buildTraineeReportHtml(trainee, makeState(), []);

    expect(html).not.toContain("<script>evil");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes assessment name injection", () => {
    const state: AppState = {
      ...makeState(),
      assessments: [
        { id: "a1", name: '<script>steal()</script>', kind: "theory", maxScore: 20, date: "2026-01-01", weight: 0 },
      ],
    };
    const trainee: Trainee = {
      id: "t1", trainingNumber: "400", name: "سارة", theorySection: "ن-1", practicalSection: "",
    };

    const html = buildTraineeReportHtml(trainee, state, []);

    expect(html).not.toContain("<script>steal");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes trainer name injection", () => {
    const trainee: Trainee = {
      id: "t1", trainingNumber: "500", name: "خالد", theorySection: "ن-1", practicalSection: "",
    };

    const html = buildTraineeReportHtml(trainee, makeState(), [
      { userId: "u1", name: '"><img src=x onerror=alert(2)>', employeeNumber: "", joinedAt: "" },
    ]);

    expect(html).not.toContain('<img src=x onerror=alert(2)>');
    expect(html).toContain('&lt;img src=x onerror=alert(2)&gt;');
  });

  it("escapes college name with ampersand and angle brackets", () => {
    const trainee: Trainee = {
      id: "t1", trainingNumber: "600", name: "نورة", theorySection: "ن-1", practicalSection: "",
    };
    const state = makeState({ collegeName: 'كلية "التقنية" & <العلوم>' });

    const html = buildTraineeReportHtml(trainee, state, []);

    expect(html).not.toContain('<العلوم>');
    expect(html).toContain("&amp;");
    expect(html).toContain("&lt;العلوم&gt;");
  });
});
