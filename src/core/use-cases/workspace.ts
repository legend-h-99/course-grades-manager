/**
 * Workspace use cases — orchestrate workspace loading, saving, and course operations.
 * Dependencies: WorkspacePort (interface only), pure domain functions from courseData.
 * Zero imports from databases, HTTP, or UI.
 */

import type { AppState } from "../../types";
import type { CoursePreview, ProfilePayload, SaveResult, WorkspacePort } from "../ports";
import { normalizeCourseCode } from "../../courseData";

export async function loadWorkspace(port: WorkspacePort): Promise<AppState> {
  return port.load();
}

export async function saveWorkspace(port: WorkspacePort, state: AppState): Promise<SaveResult> {
  if (!state.course.code) throw new Error("أنشئ رمز المقرر أولًا.");
  return port.save(state);
}

export async function saveProfile(port: WorkspacePort, profile: ProfilePayload): Promise<void> {
  return port.saveProfile(profile);
}

export async function clearWorkspace(port: WorkspacePort): Promise<void> {
  return port.clear();
}

export async function findCourse(
  port: WorkspacePort,
  rawCode: string,
): Promise<CoursePreview | null> {
  const code = normalizeCourseCode(rawCode);
  if (!code) throw new Error("أدخل رمز المقرر أولًا.");
  return port.findCourse(code);
}

export async function joinCourse(
  port: WorkspacePort,
  courseCode: string,
  trainerName: string,
  employeeNumber: string,
): Promise<void> {
  return port.joinCourse(courseCode, trainerName, employeeNumber);
}
