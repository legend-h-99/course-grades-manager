import { apiGet, apiPost } from "./api";
import type { AppState, CourseTrainer } from "./types";

export type CoursePreview = {
  id: string;
  code: string;
  name: string;
  kind: "theory" | "practical";
  sectionNumber: string;
  savedAt: string;
  trainers: CourseTrainer[];
};

export type SaveWorkspaceResult = {
  updatedAt: string;
  inviteCode: string;
};

export type ProfilePayload = {
  collegeName: string;
  departmentName: string;
  majorName: string;
  trainerName: string;
  employeeNumber: string;
};

export async function saveProfile(profile: ProfilePayload): Promise<void> {
  await apiPost("/api/workspace/profile", { profile });
}

export async function loadWorkspace(): Promise<AppState> {
  return apiGet<AppState>("/api/workspace");
}

export async function saveWorkspace(state: AppState): Promise<SaveWorkspaceResult | undefined> {
  if (!state.course.code) return;
  return apiPost<SaveWorkspaceResult>("/api/workspace/save", { state });
}

export async function findCourseByCode(code: string): Promise<CoursePreview | null> {
  return apiPost<CoursePreview | null>("/api/workspace/find-course", { code });
}

export async function joinCourse(coursePreview: CoursePreview, trainerName: string, employeeNumber: string): Promise<void> {
  await apiPost("/api/workspace/join-course", {
    code: coursePreview.code,
    trainerName,
    employeeNumber,
  });
}

export async function clearWorkspace(): Promise<void> {
  await apiPost("/api/workspace/clear", {});
}
