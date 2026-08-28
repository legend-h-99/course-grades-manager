import React, { ChangeEvent, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BarChart3,
  CheckCircle2,
  ClipboardList,
  Copy,
  Database,
  Download,
  FileUp,
  GraduationCap,
  IdCard,
  LogIn,
  LogOut,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  UserPlus,
  Users
} from "lucide-react";
import {
  applyCourseSection,
  generateCourseCode,
  getClassStats,
  getGradeValue,
  getMaxPossibleTotal,
  getTraineeTotals,
  getTraineeTotalsWeighted,
  isWeightedMode,
  kindLabel,
  mapRowsToTrainees,
  normalizeCourseCode,
  numberOrZero,
  starterState,
  today,
  trainerEntry,
  withCourseTrainer,
  type ClassStats,
} from "./courseData";
import "./styles.css";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authApi } from "./api";
import {
  clearWorkspace,
  findCourseByCode as dbFindCourseByCode,
  joinCourse,
  loadWorkspace,
  saveProfile,
  saveWorkspace,
  type CoursePreview
} from "./storage";
import { exportGradesWorkbook, readTraineeRows } from "./excel";
import { buildTraineeReportHtml } from "./reporting";
import type { AccountProfile, AppPage, AppState, Assessment, AssessmentKind, CourseSetup, Grade, SessionUser, Trainee, TrainerProfile } from "./types";

const AUTO_SAVE_DELAY_MS = 3 * 60 * 1000;

type ToastItem = { id: string; message: string; type: "success" | "error" | "info" };

function readInitialPage(): AppPage {
  const hashPath = window.location.hash.replace(/^#\/?/, "");
  const baseHash = hashPath.split("?")[0].split("#")[0];
  if (baseHash === "register") return "register";
  if (baseHash === "login") return "login";
  if (baseHash === "app") return "app";
  const pathname = window.location.pathname.replace(/\/+$/, "");
  if (pathname === "/auth/callback") return "login";
  if (pathname === "/register") return "register";
  if (pathname === "/login") return "login";
  if (pathname === "/app") return "app";
  return "home";
}

function pagePath(page: AppPage) {
  return page === "home" ? "/" : `/#/${page}`;
}

function formatSavedAt(value: string) {
  if (!value) return "لم يتم الحفظ بعد";
  return new Intl.DateTimeFormat("ar-SA", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function ToastList({ items, onDismiss }: { items: ToastItem[]; onDismiss: (id: string) => void }) {
  if (!items.length) return null;
  return (
    <div className="toast-container" aria-live="polite" aria-atomic="false">
      {items.map((t) => (
        <div key={t.id} className={`toast toast-${t.type}`} role="status">
          <span className="toast-msg">{t.message}</span>
          <button className="toast-close" onClick={() => onDismiss(t.id)} aria-label="إغلاق">✕</button>
        </div>
      ))}
    </div>
  );
}

function App() {
  const [state, setState] = useState<AppState>(starterState);
  const [currentUser, setCurrentUser] = useState<SessionUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [page, setPage] = useState<AppPage>(readInitialPage);
  const [authStep, setAuthStep] = useState<"start" | "otp-sent" | "password-reset" | "profile-setup">("start");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [otpCode, setOtpCode] = useState("");
  const [profileDraft, setProfileDraft] = useState({ fullName: "", collegeName: "", departmentName: "", majorName: "", employeeNumber: "" });
  const [authMessage, setAuthMessage] = useState("");
  const [lastSavedAt, setLastSavedAt] = useState("");
  const [courseCodeQuery, setCourseCodeQuery] = useState("");
  const [courseLookupMessage, setCourseLookupMessage] = useState("");
  const [courseLookup, setCourseLookup] = useState<CoursePreview | null>(null);
  const [query, setQuery] = useState("");
  const [exportSectionKind, setExportSectionKind] = useState<"all" | AssessmentKind>("all");
  const [exportSectionNumber, setExportSectionNumber] = useState("");
  const [manageSectionKind, setManageSectionKind] = useState<"all" | AssessmentKind>("all");
  const [manageSectionNumber, setManageSectionNumber] = useState("");
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [manualNames, setManualNames] = useState("");
  const [isTraineeSheetOpen, setIsTraineeSheetOpen] = useState(false);
  const [importMessage, setImportMessage] = useState("");
  const [confirmDialog, setConfirmDialog] = useState<{ message: string; onConfirm: () => void } | null>(null);
  const [assessmentDraft, setAssessmentDraft] = useState({
    name: "",
    kind: "theory" as AssessmentKind,
    maxScore: 10,
    date: today(),
    weight: 0,
  });

  const isInitializedRef = useRef(false);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentUserRef = useRef<SessionUser | null>(null);
  const stateRef = useRef<AppState>(starterState);
  const isBusyRef = useRef(false);

  useEffect(() => { currentUserRef.current = currentUser; }, [currentUser]);
  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { isBusyRef.current = isBusy; }, [isBusy]);

  useEffect(() => {
    if (!isInitializedRef.current) return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(async () => {
      const user = currentUserRef.current;
      const s = stateRef.current;
      if (!user || !s.course.code || isBusyRef.current) return;
      try {
        const nextState = withCourseTrainer(user.id, s);
        const saveResult = await saveWorkspace(nextState);
        if (saveResult) {
          setState((current) => ({ ...current, course: { ...current.course, ...saveResult } }));
        }
        setLastSavedAt(new Date().toISOString());
        toast("تم الحفظ التلقائي.", "success");
      } catch {
        // silent — manual save still available
      }
    }, AUTO_SAVE_DELAY_MS);
    return () => { if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.trainees, state.assessments, state.grades]);

  // Bootstrap the app session through the local API boundary.
  useEffect(() => {
    async function init() {
      try {
        const oauth = await authApi.completeOAuthCallback();
        if (oauth.session?.user) {
          await openAuthenticatedWorkspace(oauth.session.user, oauth.profileExists);
          setIsLoading(false);
          setTimeout(() => { isInitializedRef.current = true; }, 0);
          return;
        }
      } catch (err) {
        setAuthMessage((err as Error).message || "تعذّر إكمال تسجيل الدخول بجوجل.");
        goTo("login");
      }

      const { session, profileExists } = await authApi.getSession();
      if (session?.user) {
        const sessionUser = session.user;
        setCurrentUser(sessionUser);
        if (!profileExists) {
          setProfileDraft(d => ({ ...d, fullName: sessionUser.fullName || "" }));
          setAuthStep("profile-setup");
          goTo("login");
        } else {
          const workspace = await loadWorkspace();
          setState(workspace);
          setLastSavedAt(workspace.course.savedAt);
          goTo("app");
        }
      }
      setIsLoading(false);
      setTimeout(() => { isInitializedRef.current = true; }, 0);
    }
    init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setAssessmentDraft((draft) => ({ ...draft, kind: state.course.kind }));
  }, [state.course.kind]);

  useEffect(() => {
    const handleLocationChange = () => {
      const nextPage = readInitialPage();
      setPage(nextPage);
    };
    window.addEventListener("popstate", handleLocationChange);
    window.addEventListener("hashchange", handleLocationChange);
    return () => {
      window.removeEventListener("popstate", handleLocationChange);
      window.removeEventListener("hashchange", handleLocationChange);
    };
  }, []);

  useEffect(() => {
    if (currentUser && authStep !== "profile-setup" && authStep !== "password-reset" && page !== "app") {
      goTo("app");
    }
  }, [currentUser, page, authStep]);

  useEffect(() => {
    if (page === "login") setAuthMode("login");
    if (page === "register") setAuthMode("register");
  }, [page]);

  function toast(message: string, type: ToastItem["type"] = "info") {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4500);
  }
  function dismissToast(id: string) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  function goTo(nextPage: AppPage) {
    setPage(nextPage);
    window.history.pushState(null, "", pagePath(nextPage));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const deferredQuery = useDeferredValue(query);
  const filteredTrainees = useMemo(() => {
    const needle = deferredQuery.trim().toLowerCase();
    if (!needle) return state.trainees;
    return state.trainees.filter((trainee) => {
      return (
        trainee.name.toLowerCase().includes(needle) ||
        trainee.trainingNumber.toLowerCase().includes(needle)
      );
    });
  }, [deferredQuery, state.trainees]);

  const activeCard = useMemo(() => {
    if (!activeCardId) return filteredTrainees[0] ?? null;
    return state.trainees.find((trainee) => trainee.id === activeCardId) ?? filteredTrainees[0] ?? null;
  }, [activeCardId, filteredTrainees, state.trainees]);

  useEffect(() => {
    if (!query.trim()) return;
    setActiveCardId(filteredTrainees[0]?.id ?? null);
  }, [filteredTrainees, query]);

  const weighted = useMemo(() => isWeightedMode(state.assessments), [state.assessments]);

  const totals = useMemo(() => {
    return state.trainees.map((trainee) =>
      weighted
        ? getTraineeTotalsWeighted(trainee.id, state.assessments, state.grades)
        : getTraineeTotals(trainee.id, state.assessments, state.grades)
    );
  }, [state.assessments, state.grades, state.trainees, weighted]);

  const classStats = useMemo(
    () => getClassStats(state.trainees, state.assessments, state.grades),
    [state.trainees, state.assessments, state.grades]
  );

  const maxPossibleTotal = useMemo(() => getMaxPossibleTotal(state.assessments), [state.assessments]);

  const average = useMemo(
    () => (totals.length ? totals.reduce((sum, item) => sum + item.total, 0) / totals.length : 0),
    [totals]
  );

  const courseTrainers = useMemo(
    () =>
      state.trainers.length
        ? state.trainers
        : currentUser && state.trainer.name
          ? [trainerEntry(currentUser.id, state.trainer)]
          : [],
    [state.trainers, currentUser, state.trainer]
  );

  const exportSectionOptions = useMemo(() => {
    if (exportSectionKind === "all") return [];
    const sections = state.trainees
      .map((trainee) =>
        exportSectionKind === "theory" ? trainee.theorySection : trainee.practicalSection
      )
      .map((section) => section.trim())
      .filter(Boolean);
    return Array.from(new Set(sections)).sort((a, b) => a.localeCompare(b, "ar"));
  }, [exportSectionKind, state.trainees]);

  useEffect(() => {
    if (exportSectionKind === "all") {
      setExportSectionNumber("");
      return;
    }
    if (exportSectionNumber && !exportSectionOptions.includes(exportSectionNumber)) {
      setExportSectionNumber("");
    }
  }, [exportSectionKind, exportSectionNumber, exportSectionOptions]);

  const manageSectionOptions = useMemo(() => {
    if (manageSectionKind === "all") return [];
    const sections = state.trainees
      .map((trainee) =>
        manageSectionKind === "theory" ? trainee.theorySection : trainee.practicalSection
      )
      .map((section) => section.trim())
      .filter(Boolean);
    return Array.from(new Set(sections)).sort((a, b) => a.localeCompare(b, "ar"));
  }, [manageSectionKind, state.trainees]);

  useEffect(() => {
    if (manageSectionKind === "all") {
      setManageSectionNumber("");
    }
  }, [manageSectionKind]);

  const managedTrainees = useMemo(() => {
    if (manageSectionKind === "all" || !manageSectionNumber.trim()) return state.trainees;
    const selectedSection = manageSectionNumber.trim();
    return state.trainees.filter((trainee) => {
      const traineeSection =
        manageSectionKind === "theory" ? trainee.theorySection : trainee.practicalSection;
      return traineeSection.trim() === selectedSection;
    });
  }, [manageSectionKind, manageSectionNumber, state.trainees]);

  const setupReady = useMemo(
    () =>
      Boolean(
        state.account.collegeName.trim() &&
          state.account.departmentName.trim() &&
          state.trainer.name.trim() &&
          state.course.name.trim() &&
          state.course.sectionNumber.trim()
      ),
    [state.account, state.trainer, state.course]
  );

  const setAccount = useCallback(
    (key: keyof AccountProfile, value: string) =>
      setState((c) => ({ ...c, account: { ...c.account, [key]: value } })),
    []
  );

  const setTrainer = useCallback(
    (key: keyof TrainerProfile, value: string) =>
      setState((c) => ({ ...c, trainer: { ...c.trainer, [key]: value } })),
    []
  );

  const setCourse = useCallback(
    (key: keyof CourseSetup, value: string) =>
      setState((c) => ({ ...c, course: { ...c.course, [key]: value as never } })),
    []
  );

  async function saveSetup() {
    if (!setupReady || !currentUser || isBusy) return;
    setIsBusy(true);
    try {
      const courseCode = state.course.code || generateCourseCode([]);
      const course = { ...state.course, code: courseCode, savedAt: new Date().toISOString() };
      const nextStateBase = {
        ...state,
        course,
        trainees: state.trainees.map((trainee) => applyCourseSection(trainee, course))
      };
      const nextState = withCourseTrainer(currentUser.id, nextStateBase);
      setState(nextState);
      const saveResult = await saveWorkspace(nextState);
      if (saveResult) {
        setState((current) => ({ ...current, course: { ...current.course, ...saveResult } }));
      }
      setLastSavedAt(new Date().toISOString());
      toast(`تم إنشاء رمز المقرر: ${courseCode}`, "success");
    } catch (err) {
      toast((err as Error).message || "تعذّر حفظ الإعدادات.", "error");
    } finally {
      setIsBusy(false);
    }
  }

  async function signInWithGoogle() {
    setAuthMessage("جارٍ تحويلك إلى Google...");
    authApi.signInWithGoogle();
  }

  async function openAuthenticatedWorkspace(user: SessionUser, profileExists?: boolean) {
    const sessionUser = user;
    setCurrentUser(sessionUser);
    const hasProfile = profileExists ?? (await authApi.getSession()).profileExists;
    if (!hasProfile) {
      setProfileDraft(d => ({ ...d, fullName: sessionUser.fullName || "" }));
      setAuthStep("profile-setup");
      setAuthMessage("");
      return;
    }
    const workspace = await loadWorkspace();
    setState(workspace);
    setLastSavedAt(workspace.course.savedAt);
    setAuthMessage("");
    goTo("app");
  }

  async function signInWithEmailPassword() {
    const email = authEmail.trim().toLowerCase();
    if (!email || !authPassword) {
      setAuthMessage("أدخل البريد الإلكتروني وكلمة المرور.");
      return;
    }
    setAuthMessage("جارٍ تسجيل الدخول...");
    try {
      const data = await authApi.signInWithPassword(email, authPassword);
      if (!data.session?.user) throw new Error();
      await openAuthenticatedWorkspace(data.session.user, data.profileExists);
    } catch {
      setAuthMessage("تعذر تسجيل الدخول. تحقق من البريد وكلمة المرور.");
    }
  }

  async function signUpWithEmailPassword() {
    const email = authEmail.trim().toLowerCase();
    if (!email || authPassword.length < 6) {
      setAuthMessage("أدخل بريدًا صحيحًا وكلمة مرور من 6 أحرف على الأقل.");
      return;
    }
    setAuthMessage("جارٍ إنشاء الحساب...");
    try {
      const data = await authApi.signUp(email, authPassword, `${window.location.origin}/#/login`);
      if (data.session?.user) {
        await openAuthenticatedWorkspace(data.session.user, data.profileExists);
        return;
      }
      setAuthMessage("تم إنشاء الحساب. تحقق من بريدك الإلكتروني لتأكيد الحساب ثم سجّل الدخول.");
    } catch (err) {
      setAuthMessage((err as Error).message || "تعذّر إنشاء الحساب.");
    }
  }

  async function resetPassword() {
    const email = authEmail.trim().toLowerCase();
    if (!email) {
      setAuthMessage("أدخل البريد الإلكتروني أولًا لإرسال رابط إعادة الضبط.");
      return;
    }
    setAuthMessage("جارٍ إرسال رابط إعادة ضبط كلمة المرور...");
    try {
      await authApi.resetPassword(email, `${window.location.origin}/#/login`);
      setAuthMessage("تم إرسال رابط إعادة ضبط كلمة المرور إلى بريدك الإلكتروني.");
    } catch (err) {
      setAuthMessage((err as Error).message || "تعذّر إرسال رابط إعادة الضبط.");
    }
  }

  async function updateRecoveredPassword() {
    if (authPassword.length < 6) {
      setAuthMessage("أدخل كلمة مرور جديدة من 6 أحرف على الأقل.");
      return;
    }
    setAuthMessage("جارٍ تحديث كلمة المرور...");
    try {
      const data = await authApi.updatePassword(authPassword);
      if (!data.session?.user) throw new Error();
      setAuthMessage("تم تحديث كلمة المرور.");
      setAuthPassword("");
      await openAuthenticatedWorkspace(data.session.user, data.profileExists);
    } catch (err) {
      setAuthMessage((err as Error).message || "تعذر تحديث كلمة المرور.");
    }
  }

  async function sendEmailOtp() {
    const email = authEmail.trim().toLowerCase();
    if (!email) { setAuthMessage("أدخل البريد الإلكتروني أولاً."); return; }
    setAuthMessage("جارٍ إرسال رمز التحقق...");
    try {
      await authApi.sendOtp(email);
      setAuthMessage("تم الإرسال! تحقق من بريدك الإلكتروني.");
      setAuthStep("otp-sent");
    } catch (err) {
      setAuthMessage((err as Error).message || "تعذّر إرسال رمز التحقق.");
    }
  }

  async function verifyEmailOtp() {
    const email = authEmail.trim().toLowerCase();
    const token = otpCode.trim();
    if (!token || token.length < 6) { setAuthMessage("أدخل رمز التحقق المكون من 6 أرقام."); return; }
    setAuthMessage("جارٍ التحقق...");
    try {
      const data = await authApi.verifyOtp(email, token);
      if (!data.session?.user) throw new Error();
      await openAuthenticatedWorkspace(data.session.user, data.profileExists);
    } catch {
      setAuthMessage("الرمز غير صحيح أو انتهت صلاحيته.");
    }
  }

  async function completeProfileSetup() {
    if (!currentUser || isBusy) return;
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
        const updatedUser = await authApi.updateUserMetadata({ full_name: fullName.trim() });
        nextUser = updatedUser ? { ...currentUser, ...updatedUser } : { ...currentUser, fullName: fullName.trim() };
        setCurrentUser(nextUser);
      }
      await saveProfile({
        collegeName: collegeName.trim(),
        departmentName: departmentName.trim(),
        majorName: majorName.trim(),
        trainerName: fullName.trim(),
        employeeNumber: employeeNumber.trim()
      });
      setState({
        ...starterState,
        account: { collegeName: collegeName.trim(), departmentName: departmentName.trim(), majorName: majorName.trim() },
        trainer: { name: fullName.trim(), employeeNumber: employeeNumber.trim() }
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
    await authApi.signOut();
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

  async function saveNow() {
    if (!currentUser || isBusy) return;
    setIsBusy(true);
    try {
      const nextState = withCourseTrainer(currentUser.id, state);
      setState(nextState);
      const saveResult = await saveWorkspace(nextState);
      if (saveResult) {
        setState((current) => ({ ...current, course: { ...current.course, ...saveResult } }));
      }
      setLastSavedAt(new Date().toISOString());
      toast("تم حفظ البيانات بنجاح.", "success");
    } catch (err) {
      toast((err as Error).message || "تعذّر حفظ البيانات.", "error");
    } finally {
      setIsBusy(false);
    }
  }

  async function restoreWorkspace() {
    if (!currentUser || isBusy) return;
    setIsBusy(true);
    try {
      const workspace = await loadWorkspace();
      setState(workspace);
      setLastSavedAt(workspace.course.savedAt);
      toast("تم استدعاء آخر نسخة محفوظة.", "success");
    } catch (err) {
      toast((err as Error).message || "تعذّر استدعاء البيانات.", "error");
    } finally {
      setIsBusy(false);
    }
  }

  async function findCourseByCode() {
    const code = normalizeCourseCode(courseCodeQuery);
    if (!code) {
      setCourseLookup(null);
      setCourseLookupMessage("أدخل رمز المقرر أولًا.");
      return;
    }
    setCourseLookupMessage("جارٍ البحث...");
    const record = await dbFindCourseByCode(code);
    setCourseLookup(record);
    setCourseLookupMessage(record ? "تم العثور على رمز المقرر. يمكنك الانضمام ثم ستظهر بياناته كاملة." : "لم يتم العثور على مقرر بهذا الرمز.");
  }

  async function joinCourseByCode() {
    if (!currentUser || !courseLookup || isBusy) return;
    const alreadyJoined =
      (state.course.inviteCode || state.course.code) === courseLookup.code &&
      courseTrainers.some((trainer) => trainer.userId === currentUser.id);
    if (alreadyJoined) {
      setCourseLookupMessage("أنت مرتبط بهذا المقرر بالفعل.");
      return;
    }
    setIsBusy(true);
    try {
      await joinCourse(courseLookup, state.trainer.name || currentUser.fullName, state.trainer.employeeNumber);
      const workspace = await loadWorkspace();
      setState(workspace);
      setLastSavedAt(workspace.course.savedAt);
      setCourseLookupMessage("تم الانضمام للمقرر.");
      setCourseLookup(null);
      setCourseCodeQuery("");
      toast(`تم الانضمام للمقرر برمز ${courseLookup.code}.`, "success");
    } catch (err) {
      toast((err as Error).message || "تعذّر الانضمام للمقرر.", "error");
    } finally {
      setIsBusy(false);
    }
  }

  async function copyCourseCode() {
    const inviteCode = state.course.inviteCode || state.course.code;
    if (!inviteCode) return;
    await navigator.clipboard.writeText(inviteCode);
    toast("تم نسخ رمز المقرر.", "info");
  }

  async function importTrainees(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast("حجم الملف أكبر من 10MB. يُرجى تقليص الملف.", "error");
      event.target.value = "";
      return;
    }
    setImportMessage("");

    try {
      const rows = await readTraineeRows(file);
      const trainees = mapRowsToTrainees(rows, state.course);

      setState((current) => ({ ...current, trainees, grades: [] }));
      setActiveCardId(trainees[0]?.id ?? null);
      setImportMessage(`تم استيراد ${trainees.length} متدرب.`);
    } catch {
      setImportMessage("تعذر قراءة الملف. استخدم ملف Excel بصيغة xlsx أو ملف CSV.");
    } finally {
      event.target.value = "";
    }
  }

  function addManualNames() {
    const rows = manualNames
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line, index) => {
        const parts = line.split(/[,،\t]/).map((part) => part.trim()).filter(Boolean);
        if (parts.length >= 2) return { "الرقم التدريبي": parts[0], "اسم المتدرب": parts.slice(1).join(" ") };
        return { "الرقم التدريبي": String(state.trainees.length + index + 1), "اسم المتدرب": parts[0] };
      });
    const trainees = mapRowsToTrainees(rows, state.course).map((trainee) => {
      if (manageSectionKind === "all" || !manageSectionNumber.trim()) return trainee;
      const sectionNumber = manageSectionNumber.trim();
      return manageSectionKind === "theory"
        ? { ...trainee, theorySection: sectionNumber }
        : { ...trainee, practicalSection: sectionNumber };
    });
    if (!trainees.length) return;

    setState((current) => ({ ...current, trainees: [...current.trainees, ...trainees] }));
    setManualNames("");
    setIsTraineeSheetOpen(false);
    setActiveCardId(trainees[0].id);
  }

  function updateTrainee(id: string, field: keyof Trainee, value: string) {
    setState((current) => ({
      ...current,
      trainees: current.trainees.map((trainee) =>
        trainee.id === id ? { ...trainee, [field]: value } : trainee
      )
    }));
  }

  function addAssessment() {
    if (!assessmentDraft.name.trim() || assessmentDraft.maxScore <= 0) return;
    setState((current) => ({
      ...current,
      assessments: [
        ...current.assessments,
        {
          id: crypto.randomUUID(),
          name: assessmentDraft.name.trim(),
          kind: assessmentDraft.kind,
          maxScore: assessmentDraft.maxScore,
          date: assessmentDraft.date,
          weight: assessmentDraft.weight,
        }
      ]
    }));
    setAssessmentDraft({ name: "", kind: state.course.kind, maxScore: 10, date: today(), weight: 0 });
  }

  function updateGrade(traineeId: string, assessmentId: string, score: string) {
    const assessment = state.assessments.find((item) => item.id === assessmentId);
    const nextScore = score === "" ? "" : Math.min(Math.max(Number(score), 0), assessment?.maxScore ?? 100);

    setState((current) => {
      const existing = current.grades.find(
        (grade) => grade.traineeId === traineeId && grade.assessmentId === assessmentId
      );
      if (existing) {
        return {
          ...current,
          grades: current.grades.map((grade) =>
            grade === existing ? { ...grade, score: nextScore } : grade
          )
        };
      }
      return {
        ...current,
        grades: [...current.grades, { traineeId, assessmentId, score: nextScore }]
      };
    });
  }

  async function exportWorkbook() {
    const traineesForExport = state.trainees.filter((trainee) => {
      if (exportSectionKind === "all" || !exportSectionNumber) return true;
      const traineeSection =
        exportSectionKind === "theory" ? trainee.theorySection : trainee.practicalSection;
      return traineeSection.trim() === exportSectionNumber;
    });
    if (!traineesForExport.length) return;
    setIsBusy(true);
    try {
      await exportGradesWorkbook({
        state,
        trainees: traineesForExport,
        courseTrainers,
        sectionKind: exportSectionKind,
        sectionNumber: exportSectionNumber,
      });
      toast(`تم تصدير ${traineesForExport.length} متدرب بنجاح.`, "success");
    } catch (err) {
      toast((err as Error).message || "تعذّر تصدير الملف.", "error");
    } finally {
      setIsBusy(false);
    }
  }

  function resetAll() {
    if (!currentUser || isBusy) return;
    setConfirmDialog({
      message: "سيتم مسح بيانات المقرر الحالي ومغادرة المقرر. هل تريد المتابعة؟",
      onConfirm: async () => {
        setConfirmDialog(null);
        setIsBusy(true);
        try {
          await clearWorkspace();
          setState(starterState);
          setActiveCardId(null);
          setManualNames("");
          setImportMessage("");
          toast("تم مسح بيانات المقرر.", "info");
        } catch (err) {
          toast((err as Error).message || "تعذّر مسح البيانات.", "error");
        } finally {
          setIsBusy(false);
        }
      }
    });
  }

  function printTraineeReport(trainee: Trainee) {
    const win = window.open("", "_blank", "width=680,height=900");
    if (!win) { toast("لم يتمكن المتصفح من فتح نافذة الطباعة.", "error"); return; }
    win.document.write(buildTraineeReportHtml(trainee, state, courseTrainers));
    win.document.close();
  }

  if (isLoading) {
    return (
      <main className="app-shell" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
        <p style={{ opacity: 0.5 }}>جارٍ التحميل...</p>
      </main>
    );
  }

  return (
    <main className={`app-shell ${currentUser ? "is-authenticated" : "is-guest"} page-${page}`}>
      <header className="topbar">
        <div className="brand-block">
          <span className="brand-mark">
            <SanadLogoMark />
          </span>
          <div className="brand-lockup">
            <h1>Sanad</h1>
            <p className="brand-ar">سند</p>
            <p className="eyebrow">إدارة الدرجات</p>
          </div>
        </div>
        <nav className="main-nav" aria-label="روابط الصفحة">
          {!currentUser && (
            <button type="button" className={page === "home" ? "active" : ""} onClick={() => goTo("home")}>
              الرئيسية
            </button>
          )}
          {currentUser && (
            <button type="button" className={page === "app" ? "active" : ""} onClick={() => goTo("app")}>
              لوحة الدرجات
            </button>
          )}
        </nav>
        <div className="top-actions">
          {currentUser && <span className="session-chip">مرحبًا، {currentUser.fullName}</span>}
          {currentUser && (
            <Button variant="outline" onClick={logoutUser}>
              <LogOut size={18} />
              خروج
            </Button>
          )}
          {currentUser && (
            <>
              <Button variant="outline" onClick={saveNow} disabled={isBusy}>
                <Save size={18} />
                حفظ
              </Button>
              <Button variant="outline" onClick={restoreWorkspace} disabled={isBusy}>
                <RefreshCw size={18} />
                استدعاء
              </Button>
            </>
          )}
          {currentUser && (
            <div className="export-controls" aria-label="تصدير الدرجات حسب الشعبة">
              <select
                value={exportSectionKind}
                onChange={(event) => {
                  setExportSectionKind(event.target.value as "all" | AssessmentKind);
                  setExportSectionNumber("");
                }}
                disabled={!state.trainees.length}
                aria-label="نوع شعبة التصدير"
              >
                <option value="all">كل الشعب</option>
                <option value="theory">شعبة نظري</option>
                <option value="practical">شعبة عملي</option>
              </select>
              {exportSectionKind !== "all" && (
                <select
                  value={exportSectionNumber}
                  onChange={(event) => setExportSectionNumber(event.target.value)}
                  disabled={!exportSectionOptions.length}
                  aria-label="رقم شعبة التصدير"
                >
                  <option value="">كل الشعب</option>
                  {exportSectionOptions.map((section) => (
                    <option key={section} value={section}>
                      {section}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}
          {currentUser && (
            <>
              <Button variant="outline" className="btn-export" onClick={exportWorkbook} disabled={!state.trainees.length}>
                <Download size={18} />
                تصدير Excel
              </Button>
              <Button variant="ghost" size="icon" onClick={resetAll} title="إعادة ضبط البيانات" aria-label="إعادة ضبط البيانات">
                <RotateCcw size={18} />
              </Button>
            </>
          )}
        </div>
      </header>

      {page === "home" && (
        <section className="landing-section" id="home">
          <div className="landing-hero">
            <p className="landing-eyebrow">Sanad / سند</p>
            <h2>إدارة درجات المقررات بثقة</h2>
            <p className="landing-lead">
              منصة عملية للمدربين لإنشاء مساحة مقرر مشتركة، استيراد المتدربين، رصد الدرجات النظرية والعملية، وتصدير النتائج بسرعة.
            </p>
            <div className="landing-cta">
              {currentUser ? (
                <Button onClick={() => goTo("app")}>
                  فتح لوحة الدرجات
                </Button>
              ) : (
                <>
                  <Button onClick={() => goTo("login")}>
                    <LogIn size={18} />
                    دخول
                  </Button>
                  <Button variant="outline" onClick={signInWithGoogle}>
                    <GoogleIcon />
                    دخول بجوجل
                  </Button>
                  <Button variant="outline" onClick={() => goTo("register")}>
                    <UserPlus size={18} />
                    إنشاء حساب
                  </Button>
                </>
              )}
            </div>
          </div>
          <div className="landing-features">
            <div className="landing-feature-card">
              <div className="metric-icon">
                <Users size={22} />
              </div>
              <h3>إدارة المتدربين</h3>
              <p>استورد قوائم المتدربين من Excel أو CSV</p>
            </div>
            <div className="landing-feature-card">
              <div className="metric-icon">
                <BarChart3 size={22} />
              </div>
              <h3>رصد الدرجات</h3>
              <p>رصد النظري والعملي مع حساب المجموع تلقائيًا</p>
            </div>
            <div className="landing-feature-card">
              <div className="metric-icon">
                <Download size={22} />
              </div>
              <h3>تصدير Excel</h3>
              <p>تصدير الدرجات بتنسيق Excel جاهز للرفع</p>
            </div>
            <div className="landing-feature-card">
              <div className="metric-icon">
                <ShieldCheck size={22} />
              </div>
              <h3>طبقة ثقة</h3>
              <p>صلاحيات واضحة وتجهيز لمسار تدقيق آمن</p>
            </div>
          </div>
        </section>
      )}

      {(authStep === "profile-setup" || authStep === "password-reset" || (!currentUser && (page === "register" || page === "login"))) && (
        <AuthPanel
          step={authStep}
          mode={authMode}
          email={authEmail}
          password={authPassword}
          otpCode={otpCode}
          profileDraft={profileDraft}
          message={authMessage}
          onEmailChange={setAuthEmail}
          onPasswordChange={setAuthPassword}
          onModeChange={setAuthMode}
          onOtpChange={setOtpCode}
          onProfileDraftChange={setProfileDraft}
          onGoogleSignIn={signInWithGoogle}
          onEmailPasswordSignIn={signInWithEmailPassword}
          onEmailPasswordSignUp={signUpWithEmailPassword}
          onResetPassword={resetPassword}
          onUpdateRecoveredPassword={updateRecoveredPassword}
          onSendOtp={sendEmailOtp}
          onVerifyOtp={verifyEmailOtp}
          onCompleteProfile={completeProfileSetup}
          onBackToStart={() => { setAuthStep("start"); setAuthMessage(""); setOtpCode(""); }}
        />
      )}

      {currentUser && page === "app" ? (
        <>
      <section className="storage-panel" aria-label="حفظ واستدعاء البيانات">
        <div>
          <p className="section-kicker">حفظ واستدعاء</p>
          <h2>بيانات هذا الحساب محفوظة في مساحة آمنة</h2>
          <span>آخر حفظ: {formatSavedAt(lastSavedAt || state.course.savedAt)}</span>
        </div>
        <div className="storage-actions">
          <Button onClick={saveNow} disabled={isBusy}>
            <Database size={18} />
            حفظ البيانات
          </Button>
          <Button variant="outline" onClick={restoreWorkspace} disabled={isBusy}>
            <RefreshCw size={18} />
            استدعاء آخر حفظ
          </Button>
        </div>
      </section>
      <section className="mobile-workspace-actions" aria-label="إجراءات مساحة العمل">
        <Button variant="outline" onClick={logoutUser}>
          <LogOut size={18} />
          خروج
        </Button>
        <div className="export-controls" aria-label="تصدير الدرجات حسب الشعبة">
          <select
            value={exportSectionKind}
            onChange={(event) => {
              setExportSectionKind(event.target.value as "all" | AssessmentKind);
              setExportSectionNumber("");
            }}
            disabled={!state.trainees.length}
            aria-label="نوع شعبة التصدير"
          >
            <option value="all">كل الشعب</option>
            <option value="theory">شعبة نظري</option>
            <option value="practical">شعبة عملي</option>
          </select>
          {exportSectionKind !== "all" && (
            <select
              value={exportSectionNumber}
              onChange={(event) => setExportSectionNumber(event.target.value)}
              disabled={!exportSectionOptions.length}
              aria-label="رقم شعبة التصدير"
            >
              <option value="">كل الشعب</option>
              {exportSectionOptions.map((section) => (
                <option key={section} value={section}>
                  {section}
                </option>
              ))}
            </select>
          )}
        </div>
        <Button variant="outline" className="btn-export" onClick={exportWorkbook} disabled={!state.trainees.length}>
          <Download size={18} />
          تصدير Excel
        </Button>
        <Button variant="outline" onClick={resetAll}>
          <RotateCcw size={18} />
          إعادة ضبط
        </Button>
      </section>
      <section className="course-code-panel" aria-label="رمز المقرر والانضمام">
        <div className="code-card">
          <div>
            <p className="section-kicker">رمز المقرر</p>
            <h2>{state.course.inviteCode || state.course.code || "سيتم توليده بعد إنشاء المقرر"}</h2>
            <span>الرمز فريد ويتكون من حروف وأرقام. شاركه مع المدرب الآخر للبحث والانضمام لنفس المقرر.</span>
          </div>
          <Button variant="outline" onClick={copyCourseCode} disabled={!(state.course.inviteCode || state.course.code)}>
            <Copy size={18} />
            نسخ الرمز
          </Button>
          <div className="trainer-stack">
            <span>مدربو المقرر</span>
            {courseTrainers.map((trainer) => (
              <strong key={trainer.userId}>
                {trainer.name || "مدرب بدون اسم"}
                {trainer.employeeNumber ? ` - ${trainer.employeeNumber}` : ""}
              </strong>
            ))}
            {!courseTrainers.length && <strong>لم يتم ربط مدربين بعد</strong>}
          </div>
        </div>
        <div className="join-card">
          <div className="panel-head">
            <h2>البحث والانضمام برمز مقرر</h2>
            <span>أدخل رمز المقرر، ثم انضم للمقرر لعرض بياناته ومدربيه.</span>
          </div>
          <div className="join-form">
            <Input
              value={courseCodeQuery}
              placeholder="مثال: A7K2M9Q4"
              onChange={(event) => setCourseCodeQuery(normalizeCourseCode(event.target.value))}
            />
            <Button onClick={findCourseByCode}>
              <Search size={18} />
              بحث
            </Button>
          </div>
          {courseLookupMessage && <p className="helper-text">{courseLookupMessage}</p>}
          {courseLookup && (
            <div className="course-result">
              <div>
                <span>رمز المقرر</span>
                <strong>{courseLookup.code}</strong>
              </div>
              <Button onClick={joinCourseByCode}>
                الانضمام لهذا المقرر
              </Button>
            </div>
          )}
        </div>
      </section>
      <section className="panel settings-panel" id="onboarding">
        <div className="panel-head horizontal">
          <div>
            <p className="section-kicker">إعدادات المقرر</p>
            <h2>بيانات الكلية والمقرر</h2>
          </div>
          <span className={`status-badge ${state.course.savedAt ? "saved" : ""}`}>
            {state.course.savedAt ? "تم الحفظ" : "حساب جديد"}
          </span>
        </div>
        <div className="setup-grid">
          <label>
            اسم الكلية
            <Input
              value={state.account.collegeName}
              placeholder="مثال: الكلية التقنية"
              onChange={(event) =>
                setState((current) => ({
                  ...current,
                  account: { ...current.account, collegeName: event.target.value }
                }))
              }
            />
          </label>
          <label>
            القسم
            <Input
              value={state.account.departmentName}
              placeholder="مثال: تقنية الحاسب"
              onChange={(event) =>
                setState((current) => ({
                  ...current,
                  account: { ...current.account, departmentName: event.target.value }
                }))
              }
            />
          </label>
          <label>
            التخصص
            <Input
              value={state.account.majorName}
              placeholder="اختياري"
              onChange={(event) =>
                setState((current) => ({
                  ...current,
                  account: { ...current.account, majorName: event.target.value }
                }))
              }
            />
          </label>
          <label>
            اسم المدرب
            <Input
              value={state.trainer.name}
              placeholder="مثال: أحمد محمد"
              onChange={(event) =>
                setState((current) => ({ ...current, trainer: { ...current.trainer, name: event.target.value } }))
              }
            />
          </label>
          <label>
            الرقم الوظيفي
            <Input
              value={state.trainer.employeeNumber}
              placeholder="اختياري"
              onChange={(event) =>
                setState((current) => ({
                  ...current,
                  trainer: { ...current.trainer, employeeNumber: event.target.value }
                }))
              }
            />
          </label>
          <label>
            اسم المقرر
            <Input
              value={state.course.name}
              placeholder="مثال: أساسيات الحاسب"
              onChange={(event) =>
                setState((current) => ({ ...current, course: { ...current.course, name: event.target.value } }))
              }
            />
          </label>
          <label>
            نوع الشعبة
            <select
              value={state.course.kind}
              onChange={(event) =>
                setState((current) => ({
                  ...current,
                  course: { ...current.course, kind: event.target.value as AssessmentKind }
                }))
              }
            >
              <option value="theory">نظري</option>
              <option value="practical">عملي</option>
            </select>
          </label>
          <label>
            رقم الشعبة
            <Input
              value={state.course.sectionNumber}
              placeholder="مثال: 101"
              onChange={(event) =>
                setState((current) => ({
                  ...current,
                  course: { ...current.course, sectionNumber: event.target.value }
                }))
              }
            />
          </label>
          <Button className="setup-save" onClick={saveSetup} disabled={!setupReady}>
            <Save size={18} />
            إنشاء الحساب
          </Button>
        </div>
        <div className="linked-trainers" aria-label="مدربو المقرر">
          <span>مدربو هذا المقرر</span>
          <div>
            {courseTrainers.map((trainer) => (
              <strong key={trainer.userId}>
                {trainer.name || "مدرب بدون اسم"}
                {trainer.employeeNumber ? ` - ${trainer.employeeNumber}` : ""}
              </strong>
            ))}
            {!courseTrainers.length && <strong>احفظ بيانات المقرر لإضافة المدرب الحالي.</strong>}
          </div>
        </div>
      </section>

      <section className="metrics-grid" aria-label="ملخص الدرجات">
        <Metric icon={<Users />} label="المتدربون" value={state.trainees.length} />
        <Metric icon={<ClipboardList />} label="الاختبارات" value={state.assessments.length} />
        <Metric icon={<GraduationCap />} label="متوسط المجموع" value={average.toFixed(1)} />
        <Metric icon={<IdCard />} label="الشعبة" value={state.course.sectionNumber || "-"} />
      </section>

      <section className="workflow">
        <div className="panel import-panel">
          <div className="panel-head">
            <h2>1. إضافة أسماء المتدربين</h2>
            <span>أضف الأسماء يدويًا أو استورد ملفًا، ثم أدر الأسماء والأرقام التدريبية حسب الشعبة النظرية أو العملية.</span>
          </div>
          <div className="section-management" aria-label="إدارة المتدربين حسب الشعبة">
            <label>
              نوع الإدارة
              <select
                value={manageSectionKind}
                onChange={(event) => {
                  setManageSectionKind(event.target.value as "all" | AssessmentKind);
                  setManageSectionNumber("");
                }}
              >
                <option value="all">كل المتدربين</option>
                <option value="theory">حسب الشعبة النظرية</option>
                <option value="practical">حسب الشعبة العملية</option>
              </select>
            </label>
            {manageSectionKind !== "all" && (
              <label>
                رقم الشعبة
                <Input
                  list="manage-section-options"
                  value={manageSectionNumber}
                  placeholder="اكتب أو اختر رقم الشعبة"
                  onChange={(event) => setManageSectionNumber(event.target.value)}
                />
                <datalist id="manage-section-options">
                  {manageSectionOptions.map((section) => (
                    <option key={section} value={section} />
                  ))}
                </datalist>
              </label>
            )}
            <div className="section-summary">
              <span>المعروض</span>
              <strong>{managedTrainees.length} من {state.trainees.length}</strong>
            </div>
          </div>
          {manageSectionKind !== "all" && manageSectionNumber.trim() && (
            <p className="helper-text">
              أي أسماء تضيفها يدويًا الآن ستُربط بـ {kindLabel(manageSectionKind)} شعبة {manageSectionNumber.trim()}.
            </p>
          )}
          <div className="names-tools">
            <textarea
              className="desktop-manual-entry"
              value={manualNames}
              placeholder={"اكتب كل متدرب في سطر مستقل\nمثال: 4455، محمد عبدالله\nأو: محمد عبدالله"}
              onChange={(event) => setManualNames(event.target.value)}
            />
            <div className="names-actions">
              <Button className="desktop-manual-entry" onClick={addManualNames} disabled={!manualNames.trim()}>
                <Plus size={18} />
                إضافة الأسماء
              </Button>
              <Button className="mobile-add-trigger" onClick={() => setIsTraineeSheetOpen(true)}>
                <Plus size={18} />
                إضافة متدربين
              </Button>
              <Button variant="outline" asChild>
                <label>
                  <FileUp size={18} />
                  استيراد ملف
                  <input hidden type="file" accept=".xlsx,.xls,.csv" onChange={importTrainees} />
                </label>
              </Button>
              {importMessage && <p className="helper-text">{importMessage}</p>}
            </div>
          </div>
          {isTraineeSheetOpen && (
            <div className="trainee-sheet-backdrop" role="presentation">
              <section className="trainee-sheet" role="dialog" aria-modal="true" aria-labelledby="trainee-sheet-title">
                <span className="sheet-handle" aria-hidden="true" />
                <div className="sheet-head">
                  <h2 id="trainee-sheet-title">إضافة متدربين</h2>
                  <p>أدخل رقم التدريب والاسم، كل متدرب في سطر</p>
                </div>
                <textarea
                  className="sheet-textarea"
                  value={manualNames}
                  placeholder={"1001، محمد عبدالله\n1002، سارة أحمد\n1003، خالد محمد"}
                  autoFocus
                  onChange={(event) => setManualNames(event.target.value)}
                />
                <div className="sheet-actions">
                  <Button variant="outline" className="sheet-cancel" onClick={() => setIsTraineeSheetOpen(false)}>
                    إلغاء
                  </Button>
                  <Button className="sheet-submit" onClick={addManualNames} disabled={!manualNames.trim()}>
                    إضافة الأسماء
                  </Button>
                </div>
              </section>
            </div>
          )}
          <div className="table-wrap compact">
            <table>
              <thead>
                <tr>
                  <th>الرقم التدريبي</th>
                  <th>اسم المتدرب</th>
                  <th>شعبة نظري</th>
                  <th>شعبة عملي</th>
                </tr>
              </thead>
              <tbody>
                {managedTrainees.map((trainee) => (
                  <tr key={trainee.id}>
                    <td data-label="الرقم التدريبي">
                      <Input
                        value={trainee.trainingNumber}
                        onChange={(event) => updateTrainee(trainee.id, "trainingNumber", event.target.value)}
                      />
                    </td>
                    <td data-label="اسم المتدرب">
                      <Input
                        value={trainee.name}
                        onChange={(event) => updateTrainee(trainee.id, "name", event.target.value)}
                      />
                    </td>
                    <td data-label="شعبة نظري">
                      <Input
                        value={trainee.theorySection}
                        placeholder="مثال: ن-1"
                        onChange={(event) => updateTrainee(trainee.id, "theorySection", event.target.value)}
                      />
                    </td>
                    <td data-label="شعبة عملي">
                      <Input
                        value={trainee.practicalSection}
                        placeholder="مثال: ع-2"
                        onChange={(event) => updateTrainee(trainee.id, "practicalSection", event.target.value)}
                      />
                    </td>
                  </tr>
                ))}
                {!managedTrainees.length && (
                  <tr>
                    <td colSpan={4} className="empty">
                      {manageSectionKind === "all"
                        ? "لا توجد أسماء بعد. استخدم الإدخال اليدوي أو استيراد ملف Excel/CSV."
                        : "لا توجد أسماء في هذه الشعبة بعد. استخدم الإدخال اليدوي أو استيراد ملف Excel/CSV."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h2>2. الاختبارات والدرجات</h2>
            <span>أضف اختبارًا للمقرر ثم ارصد درجاته في الجدول.</span>
          </div>
          <div className="assessment-form">
            <Input
              placeholder="اسم الاختبار"
              value={assessmentDraft.name}
              onChange={(event) => setAssessmentDraft((draft) => ({ ...draft, name: event.target.value }))}
            />
            <select
              value={assessmentDraft.kind}
              onChange={(event) =>
                setAssessmentDraft((draft) => ({ ...draft, kind: event.target.value as AssessmentKind }))
              }
            >
              <option value="theory">نظري</option>
              <option value="practical">عملي</option>
            </select>
            <Input
              type="number"
              min="1"
              placeholder="الدرجة القصوى"
              value={assessmentDraft.maxScore}
              onChange={(event) =>
                setAssessmentDraft((draft) => ({ ...draft, maxScore: numberOrZero(event.target.value) }))
              }
            />
            <Input
              type="number"
              min="0"
              max="100"
              placeholder="الوزن %"
              title="وزن الاختبار من 100 (اتركه 0 لعدم استخدام الأوزان)"
              value={assessmentDraft.weight || ""}
              onChange={(event) =>
                setAssessmentDraft((draft) => ({ ...draft, weight: numberOrZero(event.target.value) }))
              }
            />
            <Input
              type="date"
              value={assessmentDraft.date}
              onChange={(event) => setAssessmentDraft((draft) => ({ ...draft, date: event.target.value }))}
            />
            <Button onClick={addAssessment}>
              <Plus size={18} />
              إضافة
            </Button>
          </div>
          {weighted && (
            <p className="helper-text weight-notice">
              وضع الأوزان مفعّل — المجموع يُحسب كنسبة مئوية موزونة. مجموع الأوزان الحالي: {state.assessments.reduce((s, a) => s + (a.weight ?? 0), 0)}%
            </p>
          )}
          <div className="assessment-list">
            {state.assessments.map((assessment) => (
              <span key={assessment.id} className={`pill ${assessment.kind}`}>
                {assessment.name} / {assessment.maxScore}
                {assessment.weight ? ` / ${assessment.weight}%` : ""} / {kindLabel(assessment.kind)}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="panel" id="grades">
        <div className="panel-head horizontal">
          <div>
            <h2>3. رصد الدرجات والاستعلام</h2>
            <span>ابحث بالاسم أو الرقم التدريبي ثم أدخل الدرجات مباشرة.</span>
          </div>
          <div className="search-box">
            <Search size={18} />
            <Input
              value={query}
              placeholder="استعلام عن متدرب..."
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </div>

        <div className="grades-layout">
          <div className="table-wrap">
            <table className="grades-table">
              <thead>
                <tr>
                  <th>المتدرب</th>
                  <th>نظري</th>
                  <th>عملي</th>
                  {state.assessments.map((assessment) => (
                    <th key={assessment.id}>
                      {assessment.name}
                      {assessment.weight ? <small className="weight-badge">{assessment.weight}%</small> : null}
                    </th>
                  ))}
                  <th>{weighted ? "الموزون" : "المجموع"}</th>
                </tr>
              </thead>
              <tbody>
                {filteredTrainees.map((trainee) => {
                  const t = weighted
                    ? getTraineeTotalsWeighted(trainee.id, state.assessments, state.grades)
                    : getTraineeTotals(trainee.id, state.assessments, state.grades);
                  return (
                    <tr
                      key={trainee.id}
                      className={activeCard?.id === trainee.id ? "selected-row" : ""}
                      onClick={() => setActiveCardId(trainee.id)}
                    >
                      <td data-label="المتدرب">
                        <strong>{trainee.name}</strong>
                        <small>{trainee.trainingNumber}</small>
                      </td>
                      <td data-label="نظري">{trainee.theorySection || "-"}</td>
                      <td data-label="عملي">{trainee.practicalSection || "-"}</td>
                      {state.assessments.map((assessment) => (
                        <td key={assessment.id} data-label={assessment.name}>
                          <Input
                            className="grade-input"
                            type="number"
                            min="0"
                            max={assessment.maxScore}
                            value={getGradeValue(trainee.id, assessment.id, state.grades)}
                            onChange={(event) =>
                              updateGrade(trainee.id, assessment.id, event.target.value)
                            }
                            onClick={(event) => event.stopPropagation()}
                          />
                        </td>
                      ))}
                      <td data-label={weighted ? "الموزون" : "المجموع"}>
                        <strong>{t.total}</strong>
                      </td>
                    </tr>
                  );
                })}
                {!filteredTrainees.length && (
                  <tr>
                    <td colSpan={state.assessments.length + 4} className="empty">
                      لا توجد نتائج مطابقة للاستعلام.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <TraineeCard
            trainee={activeCard}
            assessments={state.assessments}
            grades={state.grades}
            weighted={weighted}
            onPrint={printTraineeReport}
          />
        </div>
      </section>

      {classStats && (
        <StatsPanel stats={classStats} maxTotal={maxPossibleTotal} weighted={weighted} />
      )}
        </>
      ) : page === "app" ? (
        <section className="locked-panel">
          <IdCard size={32} />
          <h2>سجل الدخول للمتابعة</h2>
          <p>بعد إنشاء الحساب أو تسجيل الدخول ستظهر لك خطوات إنشاء المقرر، إضافة المتدربين، ورصد الدرجات.</p>
          <div className="home-actions center">
            <Button onClick={() => goTo("login")}>
              تسجيل الدخول
            </Button>
            <Button variant="outline" onClick={() => goTo("register")}>
              إنشاء حساب
            </Button>
          </div>
        </section>
      ) : null}
      <ToastList items={toasts} onDismiss={dismissToast} />
      {confirmDialog && (
        <ConfirmDialog
          message={confirmDialog.message}
          onConfirm={confirmDialog.onConfirm}
          onCancel={() => setConfirmDialog(null)}
        />
      )}
    </main>
  );
}

function ConfirmDialog({ message, onConfirm, onCancel }: { message: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="confirm-overlay" onClick={onCancel} role="presentation">
      <div className="confirm-dialog" onClick={(e) => e.stopPropagation()} role="alertdialog" aria-modal="true">
        <p>{message}</p>
        <div className="confirm-actions">
          <Button variant="outline" onClick={onCancel}>إلغاء</Button>
          <Button onClick={onConfirm}>تأكيد</Button>
        </div>
      </div>
    </div>
  );
}

function SanadLogoMark() {
  return (
    <svg className="sanad-logo-mark" viewBox="0 0 64 64" role="img" aria-label="Sanad">
      <defs>
        <linearGradient id="sanadLogoPrimary" x1="10" y1="8" x2="54" y2="56" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#74d6ff" />
          <stop offset="0.48" stopColor="#2563eb" />
          <stop offset="1" stopColor="#1e3a8a" />
        </linearGradient>
        <linearGradient id="sanadLogoAccent" x1="52" y1="8" x2="12" y2="56" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#38bdf8" />
          <stop offset="1" stopColor="#0ea5e9" />
        </linearGradient>
      </defs>
      <path
        d="M21 8h20c3.1 0 5.9 1.7 7.4 4.4l7.5 13.1c1.7 3 .7 6.8-2.3 8.5l-4.8 2.7-9.4-16.4H24.8l-6.1 10.6 24.8 14.3-5.8 10.1-25.1-14.5c-6.2-3.6-8.3-11.4-4.7-17.6l5.7-9.9C15.1 10 17.9 8 21 8Z"
        fill="url(#sanadLogoPrimary)"
      />
      <path
        d="M43 56H23c-3.1 0-5.9-1.7-7.4-4.4L8.1 38.5c-1.7-3-.7-6.8 2.3-8.5l4.8-2.7 9.4 16.4h14.6l6.1-10.6L20.5 18.8l5.8-10.1 25.1 14.5c6.2 3.6 8.3 11.4 4.7 17.6l-5.7 9.9C48.9 54 46.1 56 43 56Z"
        fill="url(#sanadLogoAccent)"
      />
      <path
        d="M23.5 21.2 40.8 31.2 35.4 40.5 18.1 30.5 23.5 21.2Z"
        fill="#0b1638"
        opacity="0.28"
      />
    </svg>
  );
}

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
  </svg>
);

type ProfileDraft = { fullName: string; collegeName: string; departmentName: string; majorName: string; employeeNumber: string };

function AuthPanel({
  step,
  mode,
  email,
  password,
  otpCode,
  profileDraft,
  message,
  onEmailChange,
  onPasswordChange,
  onModeChange,
  onOtpChange,
  onProfileDraftChange,
  onGoogleSignIn,
  onEmailPasswordSignIn,
  onEmailPasswordSignUp,
  onResetPassword,
  onUpdateRecoveredPassword,
  onSendOtp,
  onVerifyOtp,
  onCompleteProfile,
  onBackToStart
}: {
  step: "start" | "otp-sent" | "password-reset" | "profile-setup";
  mode: "login" | "register";
  email: string;
  password: string;
  otpCode: string;
  profileDraft: ProfileDraft;
  message: string;
  onEmailChange: (v: string) => void;
  onPasswordChange: (v: string) => void;
  onModeChange: (v: "login" | "register") => void;
  onOtpChange: (v: string) => void;
  onProfileDraftChange: (d: ProfileDraft) => void;
  onGoogleSignIn: () => void;
  onEmailPasswordSignIn: () => void;
  onEmailPasswordSignUp: () => void;
  onResetPassword: () => void;
  onUpdateRecoveredPassword: () => void;
  onSendOtp: () => void;
  onVerifyOtp: () => void;
  onCompleteProfile: () => void;
  onBackToStart: () => void;
}) {
  const copyMap = {
    "start": {
      kicker: "البدء",
      title: mode === "login" ? "تسجيل الدخول" : "إنشاء حساب جديد",
      desc: mode === "login"
        ? "سجّل الدخول بحساب جوجل أو بالبريد الإلكتروني وكلمة المرور."
        : "أنشئ حسابًا بحساب جوجل أو بالبريد الإلكتروني وكلمة المرور."
    },
    "otp-sent": {
      kicker: "التحقق",
      title: "أدخل رمز التحقق",
      desc: `تم إرسال رمز مكوّن من 6 أرقام إلى ${email}. تحقق من صندوق الوارد.`
    },
    "password-reset": {
      kicker: "إعادة الضبط",
      title: "تعيين كلمة مرور جديدة",
      desc: "اكتب كلمة مرور جديدة لحسابك، وبعد الحفظ سيتم إدخالك للنظام."
    },
    "profile-setup": {
      kicker: "إعداد الحساب",
      title: "أكمل بيانات حسابك",
      desc: "أدخل بياناتك حتى تُجهّز مساحتك الخاصة، ثم يمكنك إضافة المقرر والمتدربين."
    }
  };
  const { kicker, title, desc } = copyMap[step];

  return (
    <section className="auth-panel" id="auth">
      <div className="auth-copy">
        <p className="section-kicker">{kicker}</p>
        <h2>{title}</h2>
        <p>{desc}</p>
      </div>
      <div className="auth-form">
        {step === "start" && (
          <>
            <div className="auth-tabs" role="tablist" aria-label="اختيار نوع المصادقة">
              <button type="button" className={mode === "login" ? "active" : ""} onClick={() => onModeChange("login")}>
                دخول
              </button>
              <button type="button" className={mode === "register" ? "active" : ""} onClick={() => onModeChange("register")}>
                إنشاء حساب
              </button>
            </div>
            <button type="button" className="auth-google-btn" onClick={onGoogleSignIn}>
              <GoogleIcon />
              {mode === "login" ? "الدخول بحساب جوجل" : "إنشاء حساب بجوجل"}
            </button>
            <div className="auth-divider"><span>أو</span></div>
            <label>
              البريد الإلكتروني
              <Input
                type="email"
                value={email}
                placeholder="name@example.com"
                autoComplete="email"
                onChange={(e) => onEmailChange(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && onSendOtp()}
              />
            </label>
            <label>
              كلمة المرور
              <Input
                type="password"
                value={password}
                placeholder="••••••••"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                onChange={(e) => onPasswordChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    mode === "login" ? onEmailPasswordSignIn() : onEmailPasswordSignUp();
                  }
                }}
              />
            </label>
            {message && <p className="auth-message">{message}</p>}
            <Button onClick={mode === "login" ? onEmailPasswordSignIn : onEmailPasswordSignUp}>
              {mode === "login" ? <LogIn size={18} /> : <UserPlus size={18} />}
              {mode === "login" ? "تسجيل الدخول" : "إنشاء الحساب"}
            </Button>
            {mode === "login" && (
              <div className="auth-secondary-actions">
                <button type="button" className="auth-switch" onClick={onResetPassword}>
                  نسيت كلمة المرور؟
                </button>
                <button type="button" className="auth-switch" onClick={onSendOtp}>
                  الدخول برمز تحقق بدل كلمة المرور
                </button>
              </div>
            )}
          </>
        )}
        {step === "otp-sent" && (
          <>
            <label>
              رمز التحقق
              <Input
                className="otp-input"
                value={otpCode}
                placeholder="000000"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                autoFocus
                onChange={(e) => onOtpChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
                onKeyDown={(e) => e.key === "Enter" && onVerifyOtp()}
              />
            </label>
            {message && <p className="auth-message">{message}</p>}
            <Button onClick={onVerifyOtp}>
              <ShieldCheck size={18} />
              تحقق من الرمز
            </Button>
            <button type="button" className="auth-switch" onClick={onBackToStart}>
              تغيير البريد أو إعادة الإرسال
            </button>
          </>
        )}
        {step === "password-reset" && (
          <>
            <label>
              كلمة المرور الجديدة
              <Input
                type="password"
                value={password}
                placeholder="••••••••"
                autoComplete="new-password"
                autoFocus
                onChange={(e) => onPasswordChange(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && onUpdateRecoveredPassword()}
              />
            </label>
            {message && <p className="auth-message">{message}</p>}
            <Button onClick={onUpdateRecoveredPassword}>
              <ShieldCheck size={18} />
              حفظ كلمة المرور الجديدة
            </Button>
          </>
        )}
        {step === "profile-setup" && (
          <>
            <label>
              الاسم الكامل
              <Input
                value={profileDraft.fullName}
                placeholder="اسم المدرب"
                autoComplete="name"
                onChange={(e) => onProfileDraftChange({ ...profileDraft, fullName: e.target.value })}
              />
            </label>
            <label>
              الكلية أو الجهة
              <Input
                value={profileDraft.collegeName}
                placeholder="كلية التقنية"
                onChange={(e) => onProfileDraftChange({ ...profileDraft, collegeName: e.target.value })}
              />
            </label>
            <label>
              القسم
              <Input
                value={profileDraft.departmentName}
                placeholder="قسم تقنية المعلومات"
                onChange={(e) => onProfileDraftChange({ ...profileDraft, departmentName: e.target.value })}
              />
            </label>
            <label>
              التخصص <span className="label-optional">(اختياري)</span>
              <Input
                value={profileDraft.majorName}
                placeholder="التخصص"
                onChange={(e) => onProfileDraftChange({ ...profileDraft, majorName: e.target.value })}
              />
            </label>
            <label>
              الرقم الوظيفي <span className="label-optional">(اختياري)</span>
              <Input
                value={profileDraft.employeeNumber}
                placeholder="الرقم الوظيفي"
                onChange={(e) => onProfileDraftChange({ ...profileDraft, employeeNumber: e.target.value })}
              />
            </label>
            {message && <p className="auth-message">{message}</p>}
            <Button onClick={onCompleteProfile}>
              <CheckCircle2 size={18} />
              حفظ والمتابعة
            </Button>
          </>
        )}
      </div>
    </section>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | number }) {
  return (
    <div className="metric">
      <div className="metric-icon">{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function TraineeCard({
  trainee,
  assessments,
  grades,
  weighted,
  onPrint,
}: {
  trainee: Trainee | null;
  assessments: Assessment[];
  grades: Grade[];
  weighted: boolean;
  onPrint: (trainee: Trainee) => void;
}) {
  if (!trainee) {
    return (
      <aside className="student-card empty-card">
        <IdCard size={34} />
        <p>تظهر هنا بطاقة المتدرب بعد الاستيراد أو البحث.</p>
      </aside>
    );
  }

  const theoryAssessments = assessments.filter((a) => a.kind === "theory");
  const practicalAssessments = assessments.filter((a) => a.kind === "practical");
  const totals = weighted
    ? getTraineeTotalsWeighted(trainee.id, assessments, grades)
    : getTraineeTotals(trainee.id, assessments, grades);

  return (
    <aside className="student-card">
      <div className="card-title">
        <span>نتيجة الاستعلام</span>
        <strong>{trainee.name}</strong>
      </div>
      <div className="trainee-info">
        <div className="info-row">
          <span>الاسم</span>
          <strong>{trainee.name}</strong>
        </div>
        <div className="info-row">
          <span>الرقم التدريبي</span>
          <strong>{trainee.trainingNumber || "-"}</strong>
        </div>
      </div>
      <div className="card-sections">
        <div>
          <span>الشعبة النظرية</span>
          <strong>{trainee.theorySection || "-"}</strong>
        </div>
        <div>
          <span>الشعبة العملية</span>
          <strong>{trainee.practicalSection || "-"}</strong>
        </div>
      </div>
      <ScoreGroup
        title="درجات النظري"
        traineeId={trainee.id}
        assessments={theoryAssessments}
        grades={grades}
        total={totals.theory}
        weighted={weighted}
      />
      <ScoreGroup
        title="درجات العملي"
        traineeId={trainee.id}
        assessments={practicalAssessments}
        grades={grades}
        total={totals.practical}
        weighted={weighted}
      />
      <div className="grand-total">
        <span>{weighted ? "المجموع الموزون" : "المجموع الكامل"}</span>
        <strong>{totals.total}</strong>
      </div>
      <Button variant="outline" className="card-print-btn" onClick={() => onPrint(trainee)}>
        طباعة / PDF
      </Button>
    </aside>
  );
}

function ScoreGroup({
  title,
  traineeId,
  assessments,
  grades,
  total,
  weighted,
}: {
  title: string;
  traineeId: string;
  assessments: Assessment[];
  grades: Grade[];
  total: number;
  weighted: boolean;
}) {
  return (
    <div className="score-group">
      <div className="score-head">
        <strong>{title}</strong>
        <span>{total}</span>
      </div>
      {assessments.map((assessment) => (
        <div className="score-row" key={assessment.id}>
          <span>
            {assessment.name}
            {weighted && assessment.weight ? <em className="weight-tag"> {assessment.weight}%</em> : null}
          </span>
          <strong>
            {getGradeValue(traineeId, assessment.id, grades) || 0} / {assessment.maxScore}
          </strong>
        </div>
      ))}
      {!assessments.length && <p className="muted">لم تضاف اختبارات لهذا النوع.</p>}
    </div>
  );
}

function StatsPanel({ stats, maxTotal, weighted }: { stats: ClassStats; maxTotal: number; weighted: boolean }) {
  return (
    <section className="panel stats-panel" aria-label="إحصائيات الصف">
      <div className="panel-head horizontal">
        <div>
          <p className="section-kicker">إحصائيات</p>
          <h2>توزيع الدرجات وإحصائيات الصف</h2>
          <span>{stats.passCount} ناجح ({stats.passRate}%) من أصل {stats.passCount + (stats.distribution.reduce((s, d) => s + d.count, 0) - stats.passCount)} متدرب — عتبة النجاح 60% من {maxTotal}</span>
        </div>
      </div>
      <div className="stats-metrics">
        <div className="stat-item"><span>المتوسط</span><strong>{stats.avg}</strong></div>
        <div className="stat-item"><span>الوسيط</span><strong>{stats.median}</strong></div>
        <div className="stat-item"><span>الانحراف المعياري</span><strong>{stats.stdDev}</strong></div>
        <div className="stat-item"><span>الأعلى</span><strong>{stats.max}</strong></div>
        <div className="stat-item"><span>الأدنى</span><strong>{stats.min}</strong></div>
        {weighted && <div className="stat-item stat-note"><span>الأوزان مفعّلة</span><strong>من 100</strong></div>}
      </div>
      <div className="grade-distribution">
        {stats.distribution.map((d) => (
          <div key={d.label} className="dist-row">
            <span className="dist-label">{d.label}</span>
            <div className="dist-track">
              <div
                className="dist-bar"
                style={{ width: `${Math.max(d.pct, d.count ? 2 : 0)}%`, background: d.color }}
                title={`${d.count} متدرب`}
              />
            </div>
            <span className="dist-count">{d.count}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
