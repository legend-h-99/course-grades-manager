import { useCallback, useEffect, useRef } from "react";
import { withCourseTrainer } from "../courseData";
import { saveWorkspace as saveWorkspaceUC } from "../core/use-cases/workspace";
import type { SaveResult, WorkspacePort } from "../core/ports";
import type { AppState, SessionUser } from "../types";

const AUTO_SAVE_DELAY_MS = 3 * 60 * 1000;
const dataSnapshot = (state: AppState) => JSON.stringify([state.course.code, state.trainees, state.assessments, state.grades]);

interface UseAutoSaveOptions {
  state: AppState;
  currentUser: SessionUser | null;
  isBusy: boolean;
  workspacePort: WorkspacePort;
  onSaved: (saveResult: SaveResult | null) => void;
  onError: (error: Error) => void;
}

/** Saves only edits that differ from the last persisted snapshot. */
export function useAutoSave({ state, currentUser, isBusy, workspacePort, onSaved, onError }: UseAutoSaveOptions) {
  const initialized = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedData = useRef<string | null>(null);
  const identity = useRef("");
  const latest = useRef({ state, currentUser, isBusy, onSaved, onError });
  latest.current = { state, currentUser, isBusy, onSaved, onError };

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const schedule = useCallback(function scheduleSave() {
    cancel();
    const current = latest.current;
    if (!initialized.current || !current.currentUser || !current.state.course.code || dataSnapshot(current.state) === savedData.current) return;
    timer.current = setTimeout(async () => {
      timer.current = null;
      const current = latest.current;
      if (!current.currentUser || !current.state.course.code || dataSnapshot(current.state) === savedData.current) return;
      if (current.isBusy) { scheduleSave(); return; }
      const savedIdentity = identity.current;
      const snapshot = withCourseTrainer(current.currentUser.id, current.state);
      try {
        const result = await saveWorkspaceUC(workspacePort, snapshot);
        // A response for a course that the user has left must not update the new workspace.
        if (identity.current !== savedIdentity) return;
        savedData.current = dataSnapshot(snapshot);
        latest.current.onSaved(result);
        // Edits made during the request remain dirty and receive their own save.
        scheduleSave();
      } catch (error) {
        if (identity.current === savedIdentity) latest.current.onError(error as Error);
      }
    }, AUTO_SAVE_DELAY_MS);
  }, [cancel, workspacePort]);

  useEffect(() => {
    const key = `${currentUser?.id ?? ""}:${state.course.code}`;
    if (!initialized.current || identity.current !== key) {
      identity.current = key;
      savedData.current = dataSnapshot(state);
      cancel();
    } else schedule();
    return cancel;
  }, [state.trainees, state.assessments, state.grades, state.course.code, currentUser?.id, isBusy, cancel, schedule]);

  return {
    markInitialized: () => {
      setTimeout(() => {
        initialized.current = true;
        identity.current = `${latest.current.currentUser?.id ?? ""}:${latest.current.state.course.code}`;
        savedData.current = dataSnapshot(latest.current.state);
      }, 0);
    },
    markSaved: (snapshot: AppState) => {
      savedData.current = dataSnapshot(snapshot);
      schedule();
    },
  };
}
