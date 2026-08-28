/**
 * Excel/CSV implementation of FileParserPort.
 * Delegates to the low-level excel.ts adapter (xlsx library).
 * Core use cases receive only Record<string,unknown>[] — no xlsx dependency.
 */

import { readTraineeRows } from "../excel";
import type { FileParserPort } from "../core/ports";

export class ExcelFileParser implements FileParserPort {
  readFile(file: File): Promise<Record<string, unknown>[]> {
    return readTraineeRows(file);
  }
}
