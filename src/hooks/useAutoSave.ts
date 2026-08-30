import { useEffect, useRef } from "react";
import { withCourseTrainer } from "../courseData";
import { saveWorkspace as saveWorkspaceUC } from "../core/use-cases/workspace";
import type { SaveResult, WorkspacePort } from "../core/ports";
import type { AppState, SessionUser } from "../types";

const AUTO_SAVE_DELAY_MS = 3 * 60 * 1000;

interface UseAutoSaveOptions {
  state: AppState;
  currentUser: SessionUser | null;
  isBusy: boolean;
  workspacePort: WorkspacePort;
  onSaved: (saveResult: SaveResult | null) => void;
}

/**
 * Schedules a debounced auto-save whenever trainees, assessments, or grades
 * change. Only fires after markInitialized() has been called (prevents saving
 * during the initial data load).
 */
export function useAutoSave({
  state,
  currentUser,
  isBusy,
  workspacePort,
  onSaved,
}: UseAutoSaveOptions): { markInitialized: () => void } {
  const isInitializedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep latest values accessible inside the timer callback without re-triggering the effect.
  const currentUserRef = useRef(currentUser);
  const stateRef = useRef(state);
  const isBusyRef = useRef(isBusy);
  const onSavedRef = useRef(onSaved);

  useEffect(() => { currentUserRef.current = currentUser; }, [currentUser]);
  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { isBusyRef.current = isBusy; }, [isBusy]);
  useEffect(() => { onSavedRef.current = onSaved; }, [onSaved]);

  useEffect(() => {
    if (!isInitializedRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(async () => {
      const user = currentUserRef.current;
      const s = stateRef.current;
      if (!user || !s.course.code || isBusyRef.current) return;
      try {
        const nextState = withCourseTrainer(user.id, s);
        const saveResult = await saveWorkspaceUC(workspacePort, nextState);
        onSavedRef.current(saveResult);
      } catch {
        // Silent — manual save still available to the user.
      }
    }, AUTO_SAVE_DELAY_MS);

    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
    // Intentional: only the data that should trigger a save is listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.trainees, state.assessments, state.grades]);

  return {
    markInitialized: () => {
      // Deferred so React state updates from init flush before the watcher activates.
      setTimeout(() => { isInitializedRef.current = true; }, 0);
    },
  };
}
