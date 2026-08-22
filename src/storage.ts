import { mergeTrainer, starterState, trainerEntry, withCourseTrainer } from "./courseData";
import type { AppState, AuthUser, CourseRecord } from "./types";

const LEGACY_STORAGE_KEY = "shared-course-grades-v3";
const WORKSPACE_PREFIX = "shared-course-workspace-v1:";
const COURSE_DIRECTORY_KEY = "shared-course-directory-v1";
const AUTH_USERS_KEY = "shared-course-auth-users-v1";
const AUTH_SESSION_KEY = "shared-course-auth-session-v1";

export function workspaceKey(userId: string) {
  return `${WORKSPACE_PREFIX}${userId}`;
}

export function readStateFromStorage(key: string): AppState {
  const raw = localStorage.getItem(key);
  if (!raw) return starterState;
  try {
    const parsed = JSON.parse(raw) as AppState;
    return {
      ...starterState,
      ...parsed,
      account: { ...starterState.account, ...parsed.account },
      trainer: { ...starterState.trainer, ...parsed.trainer },
      trainers: parsed.trainers ?? [],
      course: { ...starterState.course, ...parsed.course }
    };
  } catch {
    return starterState;
  }
}

export function readCourseDirectory(): CourseRecord[] {
  const raw = localStorage.getItem(COURSE_DIRECTORY_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as CourseRecord[];
  } catch {
    return [];
  }
}

export function saveCourseDirectory(records: CourseRecord[]) {
  localStorage.setItem(COURSE_DIRECTORY_KEY, JSON.stringify(records));
}

export function upsertCourseRecord(userId: string, appState: AppState) {
  if (!appState.course.code) return;
  const records = readCourseDirectory();
  const index = records.findIndex((record) => record.code === appState.course.code);
  const nextState = withCourseTrainer(userId, appState);
  const nextTrainer = nextState.trainers.find((trainer) => trainer.userId === userId) ?? trainerEntry(userId, appState.trainer);

  if (index >= 0) {
    const record = records[index];
    const trainers = mergeTrainer(record.trainers ?? [], nextTrainer);
    records[index] = { ...record, state: { ...nextState, trainers }, trainers, updatedAt: new Date().toISOString() };
  } else {
    records.push({
      code: nextState.course.code,
      state: nextState,
      trainers: nextState.trainers,
      updatedAt: new Date().toISOString()
    });
  }
  saveCourseDirectory(records);
}

export function readWorkspace(userId: string): AppState {
  const saved = localStorage.getItem(workspaceKey(userId));
  if (saved) return readStateFromStorage(workspaceKey(userId));
  const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
  return legacy ? readStateFromStorage(LEGACY_STORAGE_KEY) : starterState;
}

export function saveWorkspace(userId: string, appState: AppState) {
  localStorage.setItem(workspaceKey(userId), JSON.stringify(appState));
  upsertCourseRecord(userId, appState);
}

export function readAuthUsers(): AuthUser[] {
  const raw = localStorage.getItem(AUTH_USERS_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as AuthUser[];
  } catch {
    return [];
  }
}

export function saveAuthUsers(users: AuthUser[]) {
  localStorage.setItem(AUTH_USERS_KEY, JSON.stringify(users));
}

export function readCurrentUserId() {
  return localStorage.getItem(AUTH_SESSION_KEY);
}

export function saveCurrentUserId(userId: string | null) {
  if (userId) {
    localStorage.setItem(AUTH_SESSION_KEY, userId);
  } else {
    localStorage.removeItem(AUTH_SESSION_KEY);
  }
}

export function clearWorkspace(userId: string | null) {
  if (userId) {
    localStorage.removeItem(workspaceKey(userId));
  } else {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  }
}
