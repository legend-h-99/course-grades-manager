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

export async function saveProfile(userId: string, profile: ProfilePayload): Promise<void> {
  await apiPost("/api/workspace/profile", { userId, profile });
}

export async function loadWorkspace(userId: string): Promise<AppState> {
  return apiGet<AppState>(`/api/workspace?userId=${encodeURIComponent(userId)}`);
}

export async function saveWorkspace(userId: string, state: AppState): Promise<SaveWorkspaceResult | undefined> {
  if (!state.course.code) return;
  return apiPost<SaveWorkspaceResult>("/api/workspace/save", { userId, state });
}

export async function findCourseByCode(code: string): Promise<CoursePreview | null> {
  return apiPost<CoursePreview | null>("/api/workspace/find-course", { code });
}

export async function joinCourse(userId: string, coursePreview: CoursePreview, trainerName: string, employeeNumber: string): Promise<void> {
  await apiPost("/api/workspace/join-course", {
    userId,
    code: coursePreview.code,
    trainerName,
    employeeNumber,
  });
}

export async function clearWorkspace(userId: string): Promise<void> {
  await apiPost("/api/workspace/clear", { userId });
}
