/**
 * Port interfaces — the contracts that Core Use Cases depend on.
 * Nothing in this file may import from infrastructure, UI, or databases.
 * Infrastructure layers implement these; the core never knows how.
 */

import type { AppState, AssessmentKind, CourseTrainer, Trainee } from "../types";

// ── Workspace ──────────────────────────────────────────────────────────────

export type ProfilePayload = {
  collegeName: string;
  departmentName: string;
  majorName: string;
  trainerName: string;
  employeeNumber: string;
};

export type SaveResult = {
  updatedAt: string;
  inviteCode: string;
};

export type CoursePreview = {
  id: string;
  code: string;
  name: string;
  kind: AssessmentKind;
  sectionNumber: string;
  savedAt: string;
  trainers: CourseTrainer[];
};

/** Persistence contract for workspace data. */
export interface WorkspacePort {
  /** Load the authenticated user's full workspace state. */
  load(): Promise<AppState>;
  /** Persist the workspace; returns updated timestamps and invite code. */
  save(state: AppState): Promise<SaveResult>;
  /** Upsert the user's profile (account info + trainer details). */
  saveProfile(profile: ProfilePayload): Promise<void>;
  /** Resolve a course invite code to a preview, or null if not found. */
  findCourse(code: string): Promise<CoursePreview | null>;
  /** Join a course by its invite code. */
  joinCourse(code: string, trainerName: string, employeeNumber: string): Promise<void>;
  /** Leave the current course and reset the server-side workspace. */
  clear(): Promise<void>;
}

// ── Auth ───────────────────────────────────────────────────────────────────

export type AuthUser = {
  id: string;
  email: string;
  fullName: string;
};

export type StoredSession = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  user: AuthUser;
};

export type AuthResult = {
  session?: {
    accessToken: string;
    refreshToken?: string;
    expiresIn?: number;
    user: AuthUser;
  };
  user?: AuthUser;
  profileExists?: boolean;
  message?: string;
};

/** Authentication contract — browser-level session management. */
export interface AuthPort {
  /** Restore a stored session and verify it is still valid server-side. */
  getSession(): Promise<{ session: StoredSession | null; profileExists: boolean }>;
  /** Handle the OAuth callback URL (reads URL params, exchanges code). */
  completeOAuthCallback(): Promise<{ session: StoredSession | null; profileExists: boolean }>;
  /** Redirect the browser to the Google OAuth consent page. */
  signInWithGoogle(): void;
  /** Authenticate with email + password. */
  signInWithPassword(email: string, password: string): Promise<AuthResult>;
  /** Register a new account. */
  signUp(email: string, password: string, redirectTo: string): Promise<AuthResult>;
  /** Send a password-reset email. */
  resetPassword(email: string, redirectTo: string): Promise<void>;
  /** Update the authenticated user's password (recovery flow). */
  updatePassword(password: string): Promise<AuthResult>;
  /** Send a one-time passcode to the given email. */
  sendOtp(email: string): Promise<void>;
  /** Verify a one-time passcode. */
  verifyOtp(email: string, token: string): Promise<AuthResult>;
  /** Update arbitrary user metadata fields (e.g. full_name). */
  updateUserMetadata(data: Record<string, unknown>): Promise<AuthUser | undefined>;
  /** Sign out and clear the local session. */
  signOut(): Promise<void>;
}

// ── File parsing ───────────────────────────────────────────────────────────

/** Contract for reading a spreadsheet or CSV file into raw row objects. */
export interface FileParserPort {
  readFile(file: File): Promise<Record<string, unknown>[]>;
}

// ── Reporting ──────────────────────────────────────────────────────────────

/** Contract for generating and delivering reports. */
export interface ReportPort {
  /** Open a printable trainee card in a new browser window. */
  printTrainee(trainee: Trainee, state: AppState, trainers: CourseTrainer[]): void;
  /** Download an xlsx workbook of all grades. */
  exportGrades(params: {
    state: AppState;
    trainees: Trainee[];
    courseTrainers: CourseTrainer[];
    sectionKind: "all" | AssessmentKind;
    sectionNumber: string;
  }): Promise<void>;
}
