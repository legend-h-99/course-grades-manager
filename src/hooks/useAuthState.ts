import { useEffect, useState } from "react";
import {
  signInWithPassword as signInUC,
  signUp as signUpUC,
  sendOtp as sendOtpUC,
  verifyOtp as verifyOtpUC,
  resetPassword as resetPasswordUC,
  updateRecoveredPassword as updateRecoveredPasswordUC,
  signOut as signOutUC,
} from "../core/use-cases/auth";
import {
  loadWorkspace as loadWorkspaceUC,
  saveProfile as saveProfileUC,
} from "../core/use-cases/workspace";
import { starterState } from "../courseData";
import type { AuthPort, WorkspacePort } from "../core/ports";
import type { AppPage, AppState, SessionUser } from "../types";

interface UseAuthStateOptions {
  authPort: AuthPort;
  workspacePort: WorkspacePort;
  page: AppPage;
  isBusy: boolean;
  setIsBusy: (busy: boolean) => void;
  setCurrentUser: (user: SessionUser | null) => void;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  setLastSavedAt: (v: string) => void;
  goTo: (page: AppPage) => void;
  toast: (message: string, type: "success" | "error" | "info") => void;
}

const EMPTY_PROFILE_DRAFT = {
  fullName: "",
  collegeName: "",
  departmentName: "",
  majorName: "",
  employeeNumber: "",
};

export function useAuthState({
  authPort,
  workspacePort,
  page,
  isBusy,
  setIsBusy,
  setCurrentUser,
  setState,
  setLastSavedAt,
  goTo,
  toast,
}: UseAuthStateOptions) {
  const [authStep, setAuthStep] = useState<"start" | "otp-sent" | "password-reset" | "profile-setup">("start");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [otpCode, setOtpCode] = useState("");
  const [profileDraft, setProfileDraft] = useState(EMPTY_PROFILE_DRAFT);
  const [authMessage, setAuthMessage] = useState("");

  // Sync page → authMode so navigating to /register pre-selects the register tab.
  useEffect(() => {
    if (page === "login") setAuthMode("login");
    if (page === "register") setAuthMode("register");
  }, [page]);

  async function openAuthenticatedWorkspace(user: SessionUser, profileExists?: boolean) {
    setCurrentUser(user);
    const hasProfile = profileExists ?? (await authPort.getSession()).profileExists;
    if (!hasProfile) {
      setProfileDraft((d) => ({ ...d, fullName: user.fullName || "" }));
      setAuthStep("profile-setup");
      setAuthMessage("");
      return;
    }
    const workspace = await loadWorkspaceUC(workspacePort);
    setState(workspace);
    setLastSavedAt(workspace.course.savedAt);
    setAuthMessage("");
    goTo("app");
  }

  function signInWithGoogle() {
    setAuthMessage("جارٍ تحويلك إلى Google...");
    authPort.signInWithGoogle();
  }

  async function signInWithEmailPassword() {
    setAuthMessage("جارٍ تسجيل الدخول...");
    try {
      const data = await signInUC(authPort, authEmail, authPassword);
      if (!data.session?.user) throw new Error();
      await openAuthenticatedWorkspace(data.session.user, data.profileExists);
    } catch {
      setAuthMessage("تعذر تسجيل الدخول. تحقق من البريد وكلمة المرور.");
    }
  }

  async function signUpWithEmailPassword() {
    setAuthMessage("جارٍ إنشاء الحساب...");
    try {
      const data = await signUpUC(authPort, authEmail, authPassword, `${window.location.origin}/#/login`);
      if (data.session?.user) {
        await openAuthenticatedWorkspace(data.session.user, data.profileExists);
        return;
      }
      setAuthMessage("تم إنشاء الحساب. تحقق من بريدك الإلكتروني لتأكيد الحساب ثم سجّل الدخول.");
    } catch (err) {
      setAuthMessage((err as Error).message || "تعذّر إنشاء الحساب.");
    }
  }

  async function sendEmailOtp() {
    setAuthMessage("جارٍ إرسال رمز التحقق...");
    try {
      await sendOtpUC(authPort, authEmail);
      setAuthMessage("تم الإرسال! تحقق من بريدك الإلكتروني.");
      setAuthStep("otp-sent");
    } catch (err) {
      setAuthMessage((err as Error).message || "تعذّر إرسال رمز التحقق.");
    }
  }

  async function verifyEmailOtp() {
    setAuthMessage("جارٍ التحقق...");
    try {
      const data = await verifyOtpUC(authPort, authEmail, otpCode);
      if (!data.session?.user) throw new Error();
      await openAuthenticatedWorkspace(data.session.user, data.profileExists);
    } catch {
      setAuthMessage("الرمز غير صحيح أو انتهت صلاحيته.");
    }
  }

  async function resetPassword() {
    setAuthMessage("جارٍ إرسال رابط إعادة ضبط كلمة المرور...");
    try {
      await resetPasswordUC(authPort, authEmail, `${window.location.origin}/#/login`);
      setAuthMessage("تم إرسال رابط إعادة ضبط كلمة المرور إلى بريدك الإلكتروني.");
    } catch (err) {
      setAuthMessage((err as Error).message || "تعذّر إرسال رابط إعادة الضبط.");
    }
  }

  async function updateRecoveredPassword() {
    setAuthMessage("جارٍ تحديث كلمة المرور...");
    try {
      const data = await updateRecoveredPasswordUC(authPort, authPassword);
      if (!data.session?.user) throw new Error();
      setAuthMessage("تم تحديث كلمة المرور.");
      setAuthPassword("");
      await openAuthenticatedWorkspace(data.session.user, data.profileExists);
    } catch (err) {
      setAuthMessage((err as Error).message || "تعذر تحديث كلمة المرور.");
    }
  }

  async function completeProfileSetup(currentUser: SessionUser) {
    if (isBusy) return;
    const { fullName, collegeName, departmentName, majorName, employeeNumber } = profileDraft;
    if (!fullName.trim() || !collegeName.trim() || !departmentName.trim()) {
      setAuthMessage("أدخل الاسم الكامل والكلية والقسم على الأقل.");
      return;
    }
    setIsBusy(true);
    setAuthMessage("جارٍ حفظ البيانات...");
    try {
      let nextUser = currentUser;
      if (fullName.trim() !== currentUser.fullName) {
        const updatedUser = await authPort.updateUserMetadata({ full_name: fullName.trim() });
        nextUser = updatedUser
          ? { ...currentUser, ...updatedUser }
          : { ...currentUser, fullName: fullName.trim() };
        setCurrentUser(nextUser);
      }
      await saveProfileUC(workspacePort, {
        collegeName: collegeName.trim(),
        departmentName: departmentName.trim(),
        majorName: majorName.trim(),
        trainerName: fullName.trim(),
        employeeNumber: employeeNumber.trim(),
      });
      setState({
        ...starterState,
        account: {
          collegeName: collegeName.trim(),
          departmentName: departmentName.trim(),
          majorName: majorName.trim(),
        },
        trainer: { name: fullName.trim(), employeeNumber: employeeNumber.trim() },
      });
      setAuthStep("start");
      setAuthMessage("");
      goTo("app");
      toast("مرحباً! تم إعداد حسابك بنجاح.", "success");
    } catch (err) {
      setAuthMessage((err as Error).message || "حدث خطأ أثناء الحفظ.");
    } finally {
      setIsBusy(false);
    }
  }

  async function logoutUser() {
    await signOutUC(authPort);
    setCurrentUser(null);
    setState(starterState);
    setLastSavedAt("");
    setAuthStep("start");
    setAuthEmail("");
    setAuthPassword("");
    setAuthMode("login");
    setOtpCode("");
    setAuthMessage("");
    goTo("login");
  }

  return {
    // State
    authStep, setAuthStep,
    authEmail, setAuthEmail,
    authPassword, setAuthPassword,
    authMode, setAuthMode,
    otpCode, setOtpCode,
    profileDraft, setProfileDraft,
    authMessage, setAuthMessage,
    // Handlers
    openAuthenticatedWorkspace,
    signInWithGoogle,
    signInWithEmailPassword,
    signUpWithEmailPassword,
    sendEmailOtp,
    verifyEmailOtp,
    resetPassword,
    updateRecoveredPassword,
    completeProfileSetup,
    logoutUser,
  };
}
