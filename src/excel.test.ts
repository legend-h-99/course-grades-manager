/**
 * Tests for the file-handling helpers in excel.ts.
 *
 * readTraineeRows — CSV path only; the Excel path uses a dynamic import of
 * "read-excel-file/browser" which is unavailable in the Node test environment.
 * exportGradesWorkbook is excluded entirely (browser-only APIs).
 */
import { describe, expect, it } from "vitest";
import { readTraineeRows } from "./excel";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCsvFile(content: string, name = "data.csv", sizeOverride?: number): File {
  const blob = new Blob([content], { type: "text/csv" });
  const file = new File([blob], name);
  if (sizeOverride !== undefined) {
    Object.defineProperty(file, "size", { value: sizeOverride, configurable: true });
  }
  return file;
}

// ── readTraineeRows — size guard ──────────────────────────────────────────────

describe("readTraineeRows — file size guard", () => {
  it("throws Arabic error for files larger than 10MB", async () => {
    const file = makeCsvFile("", "data.csv", 10 * 1024 * 1024 + 1);
    await expect(readTraineeRows(file)).rejects.toThrow("10 ميغابايت");
  });

  it("does NOT throw for files exactly at 10MB", async () => {
    const csv = "الرقم التدريبي,اسم المتدرب\n1001,محمد";
    const file = makeCsvFile(csv, "data.csv", 10 * 1024 * 1024);
    await expect(readTraineeRows(file)).resolves.toBeDefined();
  });
});

// ── readTraineeRows — CSV path ────────────────────────────────────────────────

describe("readTraineeRows — CSV parsing", () => {
  it("parses a simple Arabic CSV with two columns", async () => {
    const csv = "الرقم التدريبي,اسم المتدرب\n1001,محمد\n1002,سارة";
    const rows = await readTraineeRows(makeCsvFile(csv));

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ "الرقم التدريبي": "1001", "اسم المتدرب": "محمد" });
    expect(rows[1]).toMatchObject({ "الرقم التدريبي": "1002", "اسم المتدرب": "سارة" });
  });

  it("handles names containing an Arabic comma inside quotes", async () => {
    const csv = 'الرقم التدريبي,اسم المتدرب\n1001,"محمد، عبدالله"';
    const rows = await readTraineeRows(makeCsvFile(csv));

    expect(rows[0]["اسم المتدرب"]).toBe("محمد، عبدالله");
  });

  it("handles Windows CRLF line endings", async () => {
    const csv = "الرقم التدريبي,اسم المتدرب\r\n1001,أحمد\r\n1002,خالد";
    const rows = await readTraineeRows(makeCsvFile(csv));

    expect(rows).toHaveLength(2);
  });

  it("skips entirely blank lines in the CSV", async () => {
    const csv = "الرقم التدريبي,اسم المتدرب\n1001,أحمد\n\n1002,خالد";
    const rows = await readTraineeRows(makeCsvFile(csv));

    expect(rows).toHaveLength(2);
  });

  it("returns an empty array for a header-only CSV", async () => {
    const csv = "الرقم التدريبي,اسم المتدرب";
    const rows = await readTraineeRows(makeCsvFile(csv));

    expect(rows).toHaveLength(0);
  });

  it("handles English headers for English-named CSV files", async () => {
    const csv = "trainingNumber,name\n2001,Ali Hassan";
    const rows = await readTraineeRows(makeCsvFile(csv, "students.csv"));

    expect(rows[0]).toMatchObject({ trainingNumber: "2001", name: "Ali Hassan" });
  });

  it("is case-insensitive on the .csv extension", async () => {
    const csv = "الرقم التدريبي,اسم المتدرب\n3001,نورة";
    const rows = await readTraineeRows(makeCsvFile(csv, "data.CSV"));

    expect(rows).toHaveLength(1);
  });

  it("returns correct row count for 50-row CSV", async () => {
    const header = "الرقم التدريبي,اسم المتدرب";
    const body = Array.from({ length: 50 }, (_, i) => `${1000 + i},متدرب ${i + 1}`).join("\n");
    const rows = await readTraineeRows(makeCsvFile(`${header}\n${body}`));

    expect(rows).toHaveLength(50);
  });
});
