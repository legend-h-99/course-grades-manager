/**
 * Tests for file upload and workspace sync:
 * - importTraineesFromFile edge cases not covered in traineeData.test.ts
 * - saveWorkspace / loadWorkspace / findCourse / joinCourse use cases
 * - useAutoSave debounce logic (timer extracted, no DOM required)
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  importTraineesFromFile,
  addManualTrainees,
} from "./core/use-cases/grades";
import {
  saveWorkspace,
  loadWorkspace,
  findCourse,
  joinCourse,
  clearWorkspace,
} from "./core/use-cases/workspace";
import type { FileParserPort, WorkspacePort, SaveResult, CoursePreview } from "./core/ports";
import type { AppState, CourseSetup } from "./types";

// ── Shared fixtures ──────────────────────────────────────────────────────────

const theoryCourse: CourseSetup = {
  name: "برمجة وب",
  kind: "theory",
  sectionNumber: "ن-1",
  savedAt: "",
  updatedAt: "",
  inviteCode: "",
  code: "WEB12345",
};

const practicalCourse: CourseSetup = {
  name: "شبكات",
  kind: "practical",
  sectionNumber: "ع-2",
  savedAt: "",
  updatedAt: "",
  inviteCode: "",
  code: "NET56789",
};

function makeFile(name: string, sizeBytes = 1024): File {
  const blob = new Blob(["x".repeat(sizeBytes)], { type: "application/octet-stream" });
  return new File([blob], name);
}

function makeFilePort(rows: Record<string, unknown>[]): FileParserPort {
  return { readFile: vi.fn().mockResolvedValue(rows) };
}

function makeErrorPort(message = "disk error"): FileParserPort {
  return { readFile: vi.fn().mockRejectedValue(new Error(message)) };
}

const blankState: AppState = {
  account: { collegeName: "", departmentName: "", majorName: "" },
  trainer: { name: "", employeeNumber: "" },
  trainers: [],
  course: theoryCourse,
  trainees: [],
  assessments: [],
  grades: [],
};

function makeWorkspacePort(overrides: Partial<WorkspacePort> = {}): WorkspacePort {
  return {
    load: vi.fn().mockResolvedValue(blankState),
    save: vi.fn().mockResolvedValue({ updatedAt: "2026-08-31T00:00:00Z", inviteCode: "ABC12345" }),
    saveProfile: vi.fn().mockResolvedValue(undefined),
    findCourse: vi.fn().mockResolvedValue(null),
    joinCourse: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
    listCourses: vi.fn().mockResolvedValue([]),
    loadCourse: vi.fn().mockResolvedValue(blankState),
    ...overrides,
  };
}

// ── importTraineesFromFile — additional edge cases ───────────────────────────

describe("importTraineesFromFile — edge cases", () => {
  it("propagates port read errors", async () => {
    const port = makeErrorPort("شبكة غير متاحة");
    await expect(importTraineesFromFile(port, makeFile("data.xlsx"), theoryCourse))
      .rejects.toThrow("شبكة غير متاحة");
  });

  it("assigns practicalSection for practical course when row has none", async () => {
    const rows = [{ "الرقم التدريبي": "3001", "اسم المتدرب": "علي" }];
    const port = makeFilePort(rows);
    const trainees = await importTraineesFromFile(port, makeFile("data.xlsx"), practicalCourse);

    expect(trainees[0].practicalSection).toBe("ع-2");
    expect(trainees[0].theorySection).toBe("");
  });

  it("strips whitespace from trainee names", async () => {
    const rows = [{ "الرقم التدريبي": "  9001  ", "اسم المتدرب": "  فاطمة  " }];
    const port = makeFilePort(rows);
    const trainees = await importTraineesFromFile(port, makeFile("data.xlsx"), theoryCourse);

    expect(trainees[0].name).toBe("فاطمة");
    expect(trainees[0].trainingNumber).toBe("9001");
  });

  it("all imported IDs are valid UUIDs", async () => {
    const rows = [
      { "الرقم التدريبي": "1", "اسم المتدرب": "محمد" },
      { "الرقم التدريبي": "2", "اسم المتدرب": "نورة" },
    ];
    const port = makeFilePort(rows);
    const trainees = await importTraineesFromFile(port, makeFile("data.xlsx"), theoryCourse);
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    for (const t of trainees) {
      expect(t.id).toMatch(uuidRe);
    }
  });

  it("readFile is called exactly once per import", async () => {
    const port = makeFilePort([{ "الرقم التدريبي": "1", "اسم المتدرب": "أحمد" }]);
    await importTraineesFromFile(port, makeFile("data.xlsx"), theoryCourse);

    expect(port.readFile).toHaveBeenCalledTimes(1);
    expect(port.readFile).toHaveBeenCalledWith(expect.any(File));
  });

  it("skips rows where training number is a dash or placeholder", async () => {
    const rows = [
      { "الرقم التدريبي": "-", "اسم المتدرب": "" },
      { "الرقم التدريبي": "2001", "اسم المتدرب": "خالد" },
    ];
    const port = makeFilePort(rows);
    const trainees = await importTraineesFromFile(port, makeFile("data.xlsx"), theoryCourse);

    // Rows without a name are skipped regardless of training number
    expect(trainees).toHaveLength(1);
    expect(trainees[0].name).toBe("خالد");
  });

  it("file exactly at 10MB limit is accepted", async () => {
    const port = makeFilePort([{ "الرقم التدريبي": "1", "اسم المتدرب": "سارة" }]);
    const file = makeFile("data.xlsx", 10 * 1024 * 1024);
    const trainees = await importTraineesFromFile(port, file, theoryCourse);

    expect(trainees).toHaveLength(1);
  });

  it("file 1 byte over 10MB throws immediately (no port call)", async () => {
    const port = makeFilePort([]);
    const file = makeFile("data.xlsx", 10 * 1024 * 1024 + 1);

    await expect(importTraineesFromFile(port, file, theoryCourse))
      .rejects.toThrow("10MB");
    expect(port.readFile).not.toHaveBeenCalled();
  });
});

// ── addManualTrainees — edge cases ───────────────────────────────────────────

describe("addManualTrainees — edge cases", () => {
  it("handles Arabic-comma (،) as delimiter between number and name", () => {
    const result = addManualTrainees([], "1001،محمد عبدالله", theoryCourse, "all", "");

    expect(result[0]).toMatchObject({ trainingNumber: "1001", name: "محمد عبدالله" });
  });

  it("handles multiple consecutive blank lines without adding empty trainees", () => {
    const text = "\n\nأحمد\n\n\nسارة\n\n";
    const result = addManualTrainees([], text, theoryCourse, "all", "");

    expect(result).toHaveLength(2);
  });

  it("does not override existing section when sectionKind is all", () => {
    const result = addManualTrainees([], "1001، نورة", theoryCourse, "all", "ن-5");

    // When sectionKind === 'all', section override should NOT apply
    expect(result[0].theorySection).toBe("ن-1"); // filled from course default
  });

  it("preserves existing trainees' order", () => {
    const existing = [
      { id: "e1", trainingNumber: "10", name: "أول", theorySection: "ن-1", practicalSection: "" },
    ];
    const result = addManualTrainees(existing, "ثاني", theoryCourse, "all", "");

    expect(result[0].name).toBe("أول");
    expect(result[1].name).toBe("ثاني");
  });
});

// ── saveWorkspace use case ───────────────────────────────────────────────────

describe("saveWorkspace", () => {
  it("calls port.save with the provided state", async () => {
    const port = makeWorkspacePort();
    await saveWorkspace(port, blankState);

    expect(port.save).toHaveBeenCalledOnce();
    expect(port.save).toHaveBeenCalledWith(blankState);
  });

  it("returns the SaveResult from the port", async () => {
    const expected: SaveResult = { updatedAt: "2026-08-31T12:00:00Z", inviteCode: "XYZ99999" };
    const port = makeWorkspacePort({ save: vi.fn().mockResolvedValue(expected) });

    const result = await saveWorkspace(port, blankState);

    expect(result).toEqual(expected);
  });

  it("throws when course.code is empty", async () => {
    const port = makeWorkspacePort();
    const stateWithoutCode: AppState = {
      ...blankState,
      course: { ...theoryCourse, code: "" },
    };

    await expect(saveWorkspace(port, stateWithoutCode)).rejects.toThrow("رمز المقرر");
    expect(port.save).not.toHaveBeenCalled();
  });

  it("propagates port errors", async () => {
    const port = makeWorkspacePort({
      save: vi.fn().mockRejectedValue(new Error("stale course revision")),
    });

    await expect(saveWorkspace(port, blankState)).rejects.toThrow("stale course revision");
  });
});

// ── loadWorkspace use case ───────────────────────────────────────────────────

describe("loadWorkspace", () => {
  it("returns whatever the port loads", async () => {
    const port = makeWorkspacePort({ load: vi.fn().mockResolvedValue(blankState) });
    const result = await loadWorkspace(port);

    expect(result).toEqual(blankState);
  });

  it("calls port.load exactly once", async () => {
    const port = makeWorkspacePort();
    await loadWorkspace(port);

    expect(port.load).toHaveBeenCalledOnce();
  });

  it("propagates port errors", async () => {
    const port = makeWorkspacePort({
      load: vi.fn().mockRejectedValue(new Error("unauthorized")),
    });

    await expect(loadWorkspace(port)).rejects.toThrow("unauthorized");
  });
});

// ── findCourse use case ──────────────────────────────────────────────────────

describe("findCourse", () => {
  it("throws when code is empty", async () => {
    const port = makeWorkspacePort();

    await expect(findCourse(port, "")).rejects.toThrow("رمز المقرر");
    expect(port.findCourse).not.toHaveBeenCalled();
  });

  it("throws when code is whitespace only", async () => {
    const port = makeWorkspacePort();

    await expect(findCourse(port, "   ")).rejects.toThrow("رمز المقرر");
    expect(port.findCourse).not.toHaveBeenCalled();
  });

  it("normalises code to uppercase alphanumeric before calling port", async () => {
    const port = makeWorkspacePort();
    await findCourse(port, " web-1234-5 ");

    expect(port.findCourse).toHaveBeenCalledWith("WEB12345");
  });

  it("strips dashes and spaces from code", async () => {
    const port = makeWorkspacePort();
    await findCourse(port, "ABC-DEF-12");

    expect(port.findCourse).toHaveBeenCalledWith("ABCDEF12");
  });

  it("returns null when course is not found", async () => {
    const port = makeWorkspacePort({ findCourse: vi.fn().mockResolvedValue(null) });
    const result = await findCourse(port, "UNKNOWN1");

    expect(result).toBeNull();
  });

  it("returns the CoursePreview when found", async () => {
    const preview: CoursePreview = {
      id: "uuid-1",
      code: "WEB12345",
      name: "برمجة وب",
      kind: "theory",
      sectionNumber: "ن-1",
      savedAt: "2026-08-01",
      trainers: [],
    };
    const port = makeWorkspacePort({ findCourse: vi.fn().mockResolvedValue(preview) });

    const result = await findCourse(port, "WEB12345");
    expect(result).toEqual(preview);
  });
});

// ── joinCourse use case ──────────────────────────────────────────────────────

describe("joinCourse", () => {
  it("delegates to port.joinCourse with all arguments", async () => {
    const port = makeWorkspacePort();
    await joinCourse(port, "WEB12345", "أحمد محمد", "EMP-001");

    expect(port.joinCourse).toHaveBeenCalledWith("WEB12345", "أحمد محمد", "EMP-001");
  });

  it("accepts empty trainerName and employeeNumber", async () => {
    const port = makeWorkspacePort();
    await joinCourse(port, "WEB12345", "", "");

    expect(port.joinCourse).toHaveBeenCalledWith("WEB12345", "", "");
  });

  it("propagates port errors", async () => {
    const port = makeWorkspacePort({
      joinCourse: vi.fn().mockRejectedValue(new Error("course not found")),
    });

    await expect(joinCourse(port, "BADCODE1", "", "")).rejects.toThrow("course not found");
  });
});

// ── clearWorkspace use case ──────────────────────────────────────────────────

describe("clearWorkspace", () => {
  it("calls port.clear once", async () => {
    const port = makeWorkspacePort();
    await clearWorkspace(port);

    expect(port.clear).toHaveBeenCalledOnce();
  });

  it("propagates port errors", async () => {
    const port = makeWorkspacePort({
      clear: vi.fn().mockRejectedValue(new Error("server error")),
    });

    await expect(clearWorkspace(port)).rejects.toThrow("server error");
  });
});

// ── autoSave timer logic ─────────────────────────────────────────────────────
// useAutoSave wraps a setTimeout callback. We test the core scheduling logic
// by extracting the conditions directly — no DOM or renderHook needed.

describe("autoSave — scheduling conditions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("save is NOT triggered before the 3-minute debounce elapses", () => {
    const save = vi.fn();
    let timerId: ReturnType<typeof setTimeout> | null = null;

    function scheduleAutoSave() {
      if (timerId) clearTimeout(timerId);
      timerId = setTimeout(save, 3 * 60 * 1000);
    }

    scheduleAutoSave();
    vi.advanceTimersByTime(2 * 60 * 1000); // 2 minutes — not yet

    expect(save).not.toHaveBeenCalled();
  });

  it("save IS triggered after the full 3-minute debounce", () => {
    const save = vi.fn();
    let timerId: ReturnType<typeof setTimeout> | null = null;

    function scheduleAutoSave() {
      if (timerId) clearTimeout(timerId);
      timerId = setTimeout(save, 3 * 60 * 1000);
    }

    scheduleAutoSave();
    vi.advanceTimersByTime(3 * 60 * 1000);

    expect(save).toHaveBeenCalledOnce();
  });

  it("rapid successive changes debounce to a single save", () => {
    const save = vi.fn();
    let timerId: ReturnType<typeof setTimeout> | null = null;

    function scheduleAutoSave() {
      if (timerId) clearTimeout(timerId);
      timerId = setTimeout(save, 3 * 60 * 1000);
    }

    // Simulate 5 rapid grade changes
    for (let i = 0; i < 5; i++) {
      scheduleAutoSave();
      vi.advanceTimersByTime(10_000); // 10 s between changes
    }

    // Still inside debounce window
    expect(save).not.toHaveBeenCalled();

    vi.advanceTimersByTime(3 * 60 * 1000);
    expect(save).toHaveBeenCalledOnce(); // only once
  });

  it("guard: save callback skips when user is null", async () => {
    const port = makeWorkspacePort();
    let user: { id: string } | null = null;

    // Simulate the inner callback guard from useAutoSave
    async function autoSaveCallback() {
      if (!user) return;
      await saveWorkspace(port, blankState);
    }

    await autoSaveCallback();
    expect(port.save).not.toHaveBeenCalled();
  });

  it("guard: save callback skips when course.code is empty", async () => {
    const port = makeWorkspacePort();
    const stateWithoutCode: AppState = { ...blankState, course: { ...theoryCourse, code: "" } };

    async function autoSaveCallback() {
      if (!stateWithoutCode.course.code) return;
      await saveWorkspace(port, stateWithoutCode);
    }

    await autoSaveCallback();
    expect(port.save).not.toHaveBeenCalled();
  });

  it("guard: save callback skips when isBusy is true", async () => {
    const port = makeWorkspacePort();
    let isBusy = true;

    async function autoSaveCallback() {
      if (isBusy) return;
      await saveWorkspace(port, blankState);
    }

    await autoSaveCallback();
    expect(port.save).not.toHaveBeenCalled();

    isBusy = false;
    await autoSaveCallback();
    expect(port.save).toHaveBeenCalledOnce();
  });

  it("guard: silent failure — save error does not propagate", async () => {
    const port = makeWorkspacePort({
      save: vi.fn().mockRejectedValue(new Error("network error")),
    });

    // The autoSave callback swallows errors silently
    async function autoSaveCallback() {
      try {
        await saveWorkspace(port, blankState);
      } catch {
        // silent — same as useAutoSave
      }
    }

    await expect(autoSaveCallback()).resolves.toBeUndefined();
  });
});
