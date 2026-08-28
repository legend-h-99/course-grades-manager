/**
 * HTTP implementation of WorkspacePort.
 * The only file allowed to call apiGet/apiPost for workspace operations.
 * Core use cases never import this — they receive it as a WorkspacePort.
 */

import { apiGet, apiPost } from "../api";
import type { CoursePreview, ProfilePayload, SaveResult, WorkspacePort } from "../core/ports";
import type { AppState } from "../types";

export class WorkspaceRepository implements WorkspacePort {
  load(): Promise<AppState> {
    return apiGet<AppState>("/api/workspace");
  }

  save(state: AppState): Promise<SaveResult> {
    return apiPost<SaveResult>("/api/workspace/save", { state });
  }

  saveProfile(profile: ProfilePayload): Promise<void> {
    return apiPost("/api/workspace/profile", { profile });
  }

  findCourse(code: string): Promise<CoursePreview | null> {
    return apiPost<CoursePreview | null>("/api/workspace/find-course", { code });
  }

  joinCourse(code: string, trainerName: string, employeeNumber: string): Promise<void> {
    return apiPost("/api/workspace/join-course", { code, trainerName, employeeNumber });
  }

  clear(): Promise<void> {
    return apiPost("/api/workspace/clear", {});
  }
}
