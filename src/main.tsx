import React, { ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";
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
import { readSheet } from "read-excel-file/browser";
import writeXlsxFile from "write-excel-file/browser";
import type { SheetData } from "write-excel-file/browser";
import {
  applyCourseSection,
  generateCourseCode,
  getGradeValue,
  getTraineeTotals,
  kindLabel,
  mapRowsToTrainees,
  normalizeCourseCode,
  numberOrZero,
  parseCsv,
  rowsToObjects,
  starterState,
  today,
  trainerEntry,
  withCourseTrainer
} from "./courseData";
import "./styles.css";
import { supabase } from "./supabase";
import {
  clearWorkspace,
  findCourseByCode as dbFindCourseByCode,
  joinCourse,
  loadWorkspace,
  saveWorkspace,
  type CoursePreview
} from "./storage";
import type { AccountProfile, AppPage, AppState, Assessment, AssessmentKind, CourseSetup, Grade, SessionUser, Trainee, TrainerProfile } from "./types";

function makeSessionUser(user: { id: string; email?: string; user_metadata?: Record<string, unknown> }): SessionUser {
  return {
    id: user.id,
    email: user.email ?? "",
    fullName: (user.user_metadata?.full_name as string) ?? ""
  };
}

function readInitialPage(): AppPage {
  const hashPath = window.location.hash.replace(/^#\/?/, "");
  if (hashPath === "register") return "register";
  if (hashPath === "login") return "login";
  if (hashPath === "app") return "app";
  const pathname = window.location.pathname.replace(/\/+$/, "");
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

function App() {
  const [state, setState] = useState<AppState>(starterState);
  const [currentUser, setCurrentUser] = useState<SessionUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState<AppPage>(readInitialPage);
  const [authMode, setAuthMode] = useState<"register" | "login">(
    readInitialPage() === "login" ? "login" : "register"
  );
  const [authDraft, setAuthDraft] = useState({ fullName: "", email: "", password: "" });
  const [authMessage, setAuthMessage] = useState("");
  const [storageMessage, setStorageMessage] = useState("");
  const [lastSavedAt, setLastSavedAt] = useState("");
  const [courseCodeQuery, setCourseCodeQuery] = useState("");
  const [courseLookupMessage, setCourseLookupMessage] = useState("");
  const [courseLookup, setCourseLookup] = useState<CoursePreview | null>(null);
  const [query, setQuery] = useState("");
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [manualNames, setManualNames] = useState("");
  const [importMessage, setImportMessage] = useState("");
  const [assessmentDraft, setAssessmentDraft] = useState({
    name: "",
    kind: "theory" as AssessmentKind,
    maxScore: 10,
    date: today()
  });

  // Bootstrap Supabase auth session on mount
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        const sessionUser = makeSessionUser(session.user);
        setCurrentUser(sessionUser);
        const workspace = await loadWorkspace(session.user.id);
        setState(workspace);
        setLastSavedAt(workspace.course.savedAt);
        goTo("app");
      }
      setIsLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === "SIGNED_IN" && session?.user) {
        setCurrentUser(makeSessionUser(session.user));
      } else if (event === "SIGNED_OUT") {
        setCurrentUser(null);
        setState(starterState);
      }
    });

    return () => subscription.unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setAssessmentDraft((draft) => ({ ...draft, kind: state.course.kind }));
  }, [state.course.kind]);

  useEffect(() => {
    const handleLocationChange = () => {
      const nextPage = readInitialPage();
      setPage(nextPage);
      if (nextPage === "login" || nextPage === "register") setAuthMode(nextPage);
    };
    window.addEventListener("popstate", handleLocationChange);
    window.addEventListener("hashchange", handleLocationChange);
    return () => {
      window.removeEventListener("popstate", handleLocationChange);
      window.removeEventListener("hashchange", handleLocationChange);
    };
  }, []);

  useEffect(() => {
    if (currentUser && (page === "login" || page === "register")) {
      goTo("app");
    }
  }, [currentUser, page]);

  function goTo(nextPage: AppPage) {
    setPage(nextPage);
    if (nextPage === "login" || nextPage === "register") setAuthMode(nextPage);
    window.history.pushState(null, "", pagePath(nextPage));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const filteredTrainees = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return state.trainees;
    return state.trainees.filter((trainee) => {
      return (
        trainee.name.toLowerCase().includes(needle) ||
        trainee.trainingNumber.toLowerCase().includes(needle)
      );
    });
  }, [query, state.trainees]);

  const activeCard = useMemo(() => {
    if (!activeCardId) return filteredTrainees[0] ?? null;
    return state.trainees.find((trainee) => trainee.id === activeCardId) ?? filteredTrainees[0] ?? null;
  }, [activeCardId, filteredTrainees, state.trainees]);

  useEffect(() => {
    if (!query.trim()) return;
    setActiveCardId(filteredTrainees[0]?.id ?? null);
  }, [filteredTrainees, query]);

  const totals = useMemo(() => {
    return state.trainees.map((trainee) => getTraineeTotals(trainee.id, state.assessments, state.grades));
  }, [state.assessments, state.grades, state.trainees]);

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
    if (!setupReady || !currentUser) return;
    const courseCode = state.course.code || generateCourseCode([]);
    const course = { ...state.course, code: courseCode, savedAt: new Date().toISOString() };
    const nextStateBase = {
      ...state,
      course,
      trainees: state.trainees.map((trainee) => applyCourseSection(trainee, course))
    };
    const nextState = withCourseTrainer(currentUser.id, nextStateBase);
    setState(nextState);
    await saveWorkspace(currentUser.id, nextState);
    setLastSavedAt(new Date().toISOString());
    setStorageMessage(`تم إنشاء رمز المقرر: ${courseCode}`);
  }

  async function registerUser() {
    const fullName = authDraft.fullName.trim();
    const email = authDraft.email.trim().toLowerCase();
    const password = authDraft.password.trim();
    if (!fullName || !email || password.length < 6) {
      setAuthMessage("أدخل الاسم والبريد وكلمة مرور من 6 أحرف على الأقل.");
      return;
    }
    setAuthMessage("جارٍ إنشاء الحساب...");
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } }
    });
    if (error) {
      setAuthMessage(error.message);
      return;
    }
    if (!data.user) {
      setAuthMessage("تحقق من بريدك الإلكتروني لتفعيل الحساب.");
      return;
    }
    const sessionUser: SessionUser = { id: data.user.id, email, fullName };
    const nextState = withCourseTrainer(data.user.id, { ...starterState, trainer: { ...starterState.trainer, name: fullName } });
    setCurrentUser(sessionUser);
    setState(nextState);
    setAuthMessage("تم إنشاء الحساب وتسجيل الدخول.");
    setStorageMessage("تم إنشاء مساحة بيانات جديدة لهذا الحساب.");
    goTo("app");
  }

  async function loginUser() {
    const email = authDraft.email.trim().toLowerCase();
    const password = authDraft.password.trim();
    setAuthMessage("جارٍ تسجيل الدخول...");
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.user) {
      setAuthMessage("بيانات الدخول غير صحيحة.");
      return;
    }
    setCurrentUser(makeSessionUser(data.user));
    const workspace = await loadWorkspace(data.user.id);
    setState(workspace);
    setLastSavedAt(workspace.course.savedAt);
    setAuthMessage("تم تسجيل الدخول.");
    setStorageMessage("تم استدعاء بيانات الحساب المحفوظة.");
    goTo("app");
  }

  async function logoutUser() {
    await supabase.auth.signOut();
    setCurrentUser(null);
    setState(starterState);
    setLastSavedAt("");
    setAuthMessage("تم تسجيل الخروج.");
    setStorageMessage("");
    goTo("login");
  }

  async function saveNow() {
    if (!currentUser) return;
    const nextState = withCourseTrainer(currentUser.id, state);
    setState(nextState);
    await saveWorkspace(currentUser.id, nextState);
    setLastSavedAt(new Date().toISOString());
    setStorageMessage("تم حفظ البيانات الحالية.");
  }

  async function restoreWorkspace() {
    if (!currentUser) return;
    const workspace = await loadWorkspace(currentUser.id);
    setState(workspace);
    setLastSavedAt(workspace.course.savedAt);
    setStorageMessage("تم استدعاء آخر نسخة محفوظة لهذا الحساب.");
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
    setCourseLookupMessage(record ? "تم العثور على المقرر." : "لم يتم العثور على مقرر بهذا الرمز.");
  }

  async function joinCourseByCode() {
    if (!currentUser || !courseLookup) return;
    const alreadyJoined =
      state.course.code === courseLookup.code &&
      courseTrainers.some((trainer) => trainer.userId === currentUser.id);
    if (alreadyJoined) {
      setCourseLookupMessage("أنت مرتبط بهذا المقرر بالفعل.");
      return;
    }
    await joinCourse(currentUser.id, courseLookup, state.trainer.name || currentUser.fullName, state.trainer.employeeNumber);
    const workspace = await loadWorkspace(currentUser.id);
    setState(workspace);
    setLastSavedAt(workspace.course.savedAt);
    setCourseLookupMessage("تم الانضمام للمقرر واستدعاء بياناته.");
    setStorageMessage(`تم الانضمام للمقرر برمز ${courseLookup.code}.`);
    setCourseLookup(null);
    setCourseCodeQuery("");
  }

  async function copyCourseCode() {
    if (!state.course.code) return;
    await navigator.clipboard.writeText(state.course.code);
    setStorageMessage("تم نسخ رمز المقرر.");
  }

  async function importTrainees(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setImportMessage("");

    try {
      const rows =
        file.name.toLowerCase().endsWith(".csv")
          ? parseCsv(await file.text())
          : rowsToObjects((await readSheet(file)) as unknown[][]);
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
    const trainees = mapRowsToTrainees(rows, state.course);
    if (!trainees.length) return;

    setState((current) => ({ ...current, trainees: [...current.trainees, ...trainees] }));
    setManualNames("");
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
          date: assessmentDraft.date
        }
      ]
    }));
    setAssessmentDraft({ name: "", kind: state.course.kind, maxScore: 10, date: today() });
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
    const headers = [
      "اسم الكلية",
      "القسم",
      "التخصص",
      "اسم المدرب",
      "الرقم الوظيفي",
      "مدربو المقرر",
      "اسم المقرر",
      "رمز المقرر",
      "نوع الشعبة",
      "رقم الشعبة",
      "الرقم التدريبي",
      "اسم المتدرب",
      "الشعبة النظرية",
      "الشعبة العملية",
      "مجموع النظري",
      "مجموع العملي",
      "المجموع الكامل",
      ...state.assessments.map((assessment) => assessment.name)
    ];
    const rows = state.trainees.map((trainee) => {
      const totals = getTraineeTotals(trainee.id, state.assessments, state.grades);
      return [
        state.account.collegeName,
        state.account.departmentName,
        state.account.majorName,
        state.trainer.name,
        state.trainer.employeeNumber,
        courseTrainers.map((trainer) => trainer.name || "مدرب بدون اسم").join("، "),
        state.course.name,
        state.course.code,
        kindLabel(state.course.kind),
        state.course.sectionNumber,
        trainee.trainingNumber,
        trainee.name,
        trainee.theorySection,
        trainee.practicalSection,
        totals.theory,
        totals.practical,
        totals.total,
        ...state.assessments.map((assessment) => getGradeValue(trainee.id, assessment.id, state.grades) || 0)
      ];
    });
    const sheetData: SheetData = [
      headers.map((value) => ({ value, fontWeight: "bold" })),
      ...rows.map((row) => row.map((value) => ({ value })))
    ];
    await writeXlsxFile(sheetData).toFile(`درجات-${state.course.name || "المقرر"}-${today()}.xlsx`);
  }

  async function resetAll() {
    const confirmed = window.confirm("سيتم مسح بيانات المقرر الحالي. هل تريد المتابعة؟");
    if (confirmed && currentUser) {
      await clearWorkspace(currentUser.id);
      setState(starterState);
      setActiveCardId(null);
      setManualNames("");
      setImportMessage("");
      setStorageMessage("تم مسح بيانات مساحة العمل الحالية.");
    }
  }

  if (isLoading) {
    return (
      <main className="app-shell" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
        <p style={{ opacity: 0.5 }}>جارٍ التحميل...</p>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <span className="brand-mark">
            <GraduationCap size={22} />
          </span>
          <div>
            <p className="eyebrow">مقرر مشترك</p>
            <h1>نظام إدارة درجات المقرر</h1>
          </div>
        </div>
        <nav className="main-nav" aria-label="روابط الصفحة">
          <button className={page === "home" ? "active" : ""} onClick={() => goTo("home")}>
            الرئيسية
          </button>
          <button className={page === "register" ? "active" : ""} onClick={() => goTo("register")}>
            التسجيل
          </button>
          <button className={page === "login" ? "active" : ""} onClick={() => goTo("login")}>
            الدخول
          </button>
          <button className={page === "app" ? "active" : ""} onClick={() => goTo(currentUser ? "app" : "login")}>
            لوحة الدرجات
          </button>
        </nav>
        <div className="top-actions">
          {currentUser && <span className="session-chip">مرحبًا، {currentUser.fullName}</span>}
          {currentUser ? (
            <button className="button" onClick={logoutUser}>
              <LogOut size={18} />
              خروج
            </button>
          ) : (
            <>
              <button className="button" onClick={() => goTo("login")}>
                <LogIn size={18} />
                دخول
              </button>
              <button className="button primary" onClick={() => goTo("register")}>
                <UserPlus size={18} />
                حساب جديد
              </button>
            </>
          )}
          {currentUser && (
            <>
              <button className="button" onClick={saveNow}>
                <Save size={18} />
                حفظ
              </button>
              <button className="button" onClick={restoreWorkspace}>
                <RefreshCw size={18} />
                استدعاء
              </button>
            </>
          )}
          <button className="button" onClick={exportWorkbook} disabled={!currentUser || !state.trainees.length}>
            <Download size={18} />
            تصدير Excel
          </button>
          <button className="icon-button" onClick={resetAll} title="إعادة ضبط البيانات">
            <RotateCcw size={18} />
          </button>
        </div>
      </header>

      {page === "home" && <section className="home-panel" id="home">
        <div className="home-copy">
          <span className="home-kicker">منصة درجات المقرر المشترك</span>
          <h2>صفحة واحدة لتجهيز المقرر، توزيع الشعب، ورصد الدرجات بسرعة</h2>
          <p>
            صفحة عملية للمدربين تساعدك على إنشاء حساب المقرر، إضافة الشعب النظرية والعملية، استيراد المتدربين، رصد الدرجات، والاستعلام عن بطاقة أي متدرب بسرعة.
          </p>
          <div className="feature-strip" aria-label="خصائص النظام">
            <span>
              <ShieldCheck size={16} />
              تسجيل ودخول
            </span>
            <span>
              <FileUp size={16} />
              استيراد Excel وCSV
            </span>
            <span>
              <IdCard size={16} />
              بطاقة متدرب
            </span>
            <span>
              <Download size={16} />
              تصدير الدرجات
            </span>
          </div>
          <div className="home-actions">
            <button className="button primary" onClick={() => goTo(currentUser ? "app" : "register")}>
              ابدأ الإعداد
            </button>
            <button className="button" onClick={() => goTo(currentUser ? "app" : "login")}>
              {currentUser ? "فتح لوحة الدرجات" : "تسجيل الدخول"}
            </button>
          </div>
        </div>
        <div className="hero-dashboard" aria-label="معاينة سير العمل">
          <div className="hero-card hero-card-main">
            <div>
              <span>جاهزية البيانات</span>
              <strong>{setupReady ? "مكتمل" : "بانتظار الإعداد"}</strong>
            </div>
            <CheckCircle2 size={24} />
          </div>
          <div className="hero-mini-grid">
            <div>
              <Users size={18} />
              <span>{state.trainees.length}</span>
              <small>متدرب</small>
            </div>
            <div>
              <ClipboardList size={18} />
              <span>{state.assessments.length}</span>
              <small>اختبار</small>
            </div>
            <div>
              <BarChart3 size={18} />
              <span>{average.toFixed(1)}</span>
              <small>متوسط</small>
            </div>
          </div>
          <div className="home-steps" aria-label="خطوات استخدام النظام">
            <div>
              <strong>1</strong>
              <span>سجل الكلية والقسم والمدرب</span>
            </div>
            <div>
              <strong>2</strong>
              <span>أنشئ المقرر والشعبة</span>
            </div>
            <div>
              <strong>3</strong>
              <span>أضف المتدربين وارصد الدرجات</span>
            </div>
          </div>
        </div>
      </section>}

      {!currentUser && (page === "register" || page === "login") && (
        <AuthPanel
          mode={authMode}
          draft={authDraft}
          message={authMessage}
          onModeChange={setAuthMode}
          onDraftChange={setAuthDraft}
          onRegister={registerUser}
          onLogin={loginUser}
        />
      )}

      {currentUser && page === "app" ? (
        <>
      <section className="storage-panel" aria-label="حفظ واستدعاء البيانات">
        <div>
          <p className="section-kicker">حفظ واستدعاء</p>
          <h2>بيانات هذا الحساب محفوظة في قاعدة بيانات سحابية</h2>
          <span>آخر حفظ: {formatSavedAt(lastSavedAt || state.course.savedAt)}</span>
          {storageMessage && <strong>{storageMessage}</strong>}
        </div>
        <div className="storage-actions">
          <button className="button primary" onClick={saveNow}>
            <Database size={18} />
            حفظ البيانات
          </button>
          <button className="button" onClick={restoreWorkspace}>
            <RefreshCw size={18} />
            استدعاء آخر حفظ
          </button>
        </div>
      </section>
      <section className="course-code-panel" aria-label="رمز المقرر والانضمام">
        <div className="code-card">
          <div>
            <p className="section-kicker">رمز المقرر</p>
            <h2>{state.course.code || "سيتم توليده بعد إنشاء المقرر"}</h2>
            <span>الرمز فريد ويتكون من حروف وأرقام. شاركه مع المدرب الآخر للبحث والانضمام لنفس المقرر.</span>
          </div>
          <button className="button" onClick={copyCourseCode} disabled={!state.course.code}>
            <Copy size={18} />
            نسخ الرمز
          </button>
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
            <span>أدخل رمز المقرر، ثم راجع بيانات المقرر والمدربين قبل الانضمام.</span>
          </div>
          <div className="join-form">
            <input
              value={courseCodeQuery}
              placeholder="مثال: A7K2M9Q4"
              onChange={(event) => setCourseCodeQuery(normalizeCourseCode(event.target.value))}
            />
            <button className="button primary" onClick={findCourseByCode}>
              <Search size={18} />
              بحث
            </button>
          </div>
          {courseLookupMessage && <p className="helper-text">{courseLookupMessage}</p>}
          {courseLookup && (
            <div className="course-result">
              <div>
                <span>المقرر</span>
                <strong>{courseLookup.name || "-"}</strong>
              </div>
              <div>
                <span>النوع</span>
                <strong>{kindLabel(courseLookup.kind)}</strong>
              </div>
              <div>
                <span>الشعبة</span>
                <strong>{courseLookup.sectionNumber || "-"}</strong>
              </div>
              <div className="trainers-list">
                <span>المدربون</span>
                <strong>
                  {courseLookup.trainers.map((trainer) => trainer.name || "مدرب بدون اسم").join("، ")}
                </strong>
              </div>
              <button className="button primary" onClick={joinCourseByCode}>
                الانضمام لهذا المقرر
              </button>
            </div>
          )}
        </div>
      </section>
      <section className="setup-panel" id="onboarding">
        <div className="setup-heading">
          <div>
            <p className="section-kicker">Onboarding</p>
            <h2>إنشاء حساب المقرر</h2>
            <span>أدخل بيانات الكلية والقسم، ثم اسم المدرب والمقرر لإنشاء مساحة العمل.</span>
          </div>
          <span className={`status-badge ${state.course.savedAt ? "saved" : ""}`}>
            {state.course.savedAt ? "تم إنشاء الحساب" : "حساب جديد"}
          </span>
        </div>
        <div className="setup-grid">
          <label>
            اسم الكلية
            <input
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
            <input
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
            <input
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
            <input
              value={state.trainer.name}
              placeholder="مثال: أحمد محمد"
              onChange={(event) =>
                setState((current) => ({ ...current, trainer: { ...current.trainer, name: event.target.value } }))
              }
            />
          </label>
          <label>
            الرقم الوظيفي
            <input
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
            <input
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
            <input
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
          <button className="button primary setup-save" onClick={saveSetup} disabled={!setupReady}>
            <Save size={18} />
            إنشاء الحساب
          </button>
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
            <span>أضف الأسماء يدويًا أو استورد ملفًا، وسيتم ربطهم بشعبة المقرر الحالية.</span>
          </div>
          <div className="names-tools">
            <textarea
              value={manualNames}
              placeholder={"اكتب كل متدرب في سطر مستقل\nمثال: 4455، محمد عبدالله\nأو: محمد عبدالله"}
              onChange={(event) => setManualNames(event.target.value)}
            />
            <div className="names-actions">
              <button className="button primary" onClick={addManualNames} disabled={!manualNames.trim()}>
                <Plus size={18} />
                إضافة الأسماء
              </button>
              <label className="button">
                <FileUp size={18} />
                استيراد ملف
                <input hidden type="file" accept=".xlsx,.xls,.csv" onChange={importTrainees} />
              </label>
              {importMessage && <p className="helper-text">{importMessage}</p>}
            </div>
          </div>
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
                {state.trainees.map((trainee) => (
                  <tr key={trainee.id}>
                    <td>
                      <input
                        value={trainee.trainingNumber}
                        onChange={(event) => updateTrainee(trainee.id, "trainingNumber", event.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        value={trainee.name}
                        onChange={(event) => updateTrainee(trainee.id, "name", event.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        value={trainee.theorySection}
                        placeholder="مثال: ن-1"
                        onChange={(event) => updateTrainee(trainee.id, "theorySection", event.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        value={trainee.practicalSection}
                        placeholder="مثال: ع-2"
                        onChange={(event) => updateTrainee(trainee.id, "practicalSection", event.target.value)}
                      />
                    </td>
                  </tr>
                ))}
                {!state.trainees.length && (
                  <tr>
                    <td colSpan={4} className="empty">
                      لا توجد أسماء بعد. استخدم الإدخال اليدوي أو استيراد ملف Excel/CSV.
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
            <input
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
            <input
              type="number"
              min="1"
              value={assessmentDraft.maxScore}
              onChange={(event) =>
                setAssessmentDraft((draft) => ({ ...draft, maxScore: numberOrZero(event.target.value) }))
              }
            />
            <input
              type="date"
              value={assessmentDraft.date}
              onChange={(event) => setAssessmentDraft((draft) => ({ ...draft, date: event.target.value }))}
            />
            <button className="button primary" onClick={addAssessment}>
              <Plus size={18} />
              إضافة
            </button>
          </div>
          <div className="assessment-list">
            {state.assessments.map((assessment) => (
              <span key={assessment.id} className={`pill ${assessment.kind}`}>
                {assessment.name} / {assessment.maxScore} / {kindLabel(assessment.kind)}
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
            <input
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
                    <th key={assessment.id}>{assessment.name}</th>
                  ))}
                  <th>المجموع</th>
                </tr>
              </thead>
              <tbody>
                {filteredTrainees.map((trainee) => {
                  const totals = getTraineeTotals(trainee.id, state.assessments, state.grades);
                  return (
                    <tr
                      key={trainee.id}
                      className={activeCard?.id === trainee.id ? "selected-row" : ""}
                      onClick={() => setActiveCardId(trainee.id)}
                    >
                      <td>
                        <strong>{trainee.name}</strong>
                        <small>{trainee.trainingNumber}</small>
                      </td>
                      <td>{trainee.theorySection || "-"}</td>
                      <td>{trainee.practicalSection || "-"}</td>
                      {state.assessments.map((assessment) => (
                        <td key={assessment.id}>
                          <input
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
                      <td>
                        <strong>{totals.total}</strong>
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

          <TraineeCard trainee={activeCard} assessments={state.assessments} grades={state.grades} />
        </div>
      </section>
        </>
      ) : page === "app" ? (
        <section className="locked-panel">
          <IdCard size={32} />
          <h2>سجل الدخول للمتابعة</h2>
          <p>بعد إنشاء الحساب أو تسجيل الدخول ستظهر لك خطوات إنشاء المقرر، إضافة المتدربين، ورصد الدرجات.</p>
          <div className="home-actions center">
            <button className="button primary" onClick={() => goTo("login")}>
              تسجيل الدخول
            </button>
            <button className="button" onClick={() => goTo("register")}>
              إنشاء حساب
            </button>
          </div>
        </section>
      ) : null}
    </main>
  );
}

function AuthPanel({
  mode,
  draft,
  message,
  onModeChange,
  onDraftChange,
  onRegister,
  onLogin
}: {
  mode: "register" | "login";
  draft: { fullName: string; email: string; password: string };
  message: string;
  onModeChange: (mode: "register" | "login") => void;
  onDraftChange: (draft: { fullName: string; email: string; password: string }) => void;
  onRegister: () => void;
  onLogin: () => void;
}) {
  const isRegister = mode === "register";
  return (
    <section className="auth-panel" id="auth">
      <div className="auth-copy">
        <p className="section-kicker">Onboarding</p>
        <h2>{isRegister ? "إنشاء حساب جديد" : "تسجيل الدخول"}</h2>
        <p>ابدأ بحساب المدرب حتى يتم حفظ مساحة العمل على السحابة، ثم أكمل بيانات المقرر والمتدربين.</p>
      </div>
      <div className="auth-form">
        <div className="auth-tabs" role="tablist" aria-label="التسجيل والدخول">
          <button className={isRegister ? "active" : ""} onClick={() => onModeChange("register")}>
            إنشاء حساب
          </button>
          <button className={!isRegister ? "active" : ""} onClick={() => onModeChange("login")}>
            دخول
          </button>
        </div>
        {isRegister && (
          <label>
            اسم المستخدم
            <input
              value={draft.fullName}
              placeholder="اسم المدرب"
              onChange={(event) => onDraftChange({ ...draft, fullName: event.target.value })}
            />
          </label>
        )}
        <label>
          البريد الإلكتروني
          <input
            type="email"
            value={draft.email}
            placeholder="name@example.com"
            onChange={(event) => onDraftChange({ ...draft, email: event.target.value })}
          />
        </label>
        <label>
          كلمة المرور
          <input
            type="password"
            value={draft.password}
            placeholder="6 أحرف على الأقل"
            onChange={(event) => onDraftChange({ ...draft, password: event.target.value })}
          />
        </label>
        {message && <p className="auth-message">{message}</p>}
        <button className="button primary" onClick={isRegister ? onRegister : onLogin}>
          {isRegister ? <UserPlus size={18} /> : <LogIn size={18} />}
          {isRegister ? "إنشاء الحساب" : "تسجيل الدخول"}
        </button>
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
  grades
}: {
  trainee: Trainee | null;
  assessments: Assessment[];
  grades: Grade[];
}) {
  if (!trainee) {
    return (
      <aside className="student-card empty-card">
        <IdCard size={34} />
        <p>تظهر هنا بطاقة المتدرب بعد الاستيراد أو البحث.</p>
      </aside>
    );
  }

  const theoryAssessments = assessments.filter((assessment) => assessment.kind === "theory");
  const practicalAssessments = assessments.filter((assessment) => assessment.kind === "practical");
  const totals = getTraineeTotals(trainee.id, assessments, grades);

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
      />
      <ScoreGroup
        title="درجات العملي"
        traineeId={trainee.id}
        assessments={practicalAssessments}
        grades={grades}
        total={totals.practical}
      />
      <div className="grand-total">
        <span>المجموع الكامل</span>
        <strong>{totals.total}</strong>
      </div>
    </aside>
  );
}

function ScoreGroup({
  title,
  traineeId,
  assessments,
  grades,
  total
}: {
  title: string;
  traineeId: string;
  assessments: Assessment[];
  grades: Grade[];
  total: number;
}) {
  return (
    <div className="score-group">
      <div className="score-head">
        <strong>{title}</strong>
        <span>{total}</span>
      </div>
      {assessments.map((assessment) => (
        <div className="score-row" key={assessment.id}>
          <span>{assessment.name}</span>
          <strong>
            {getGradeValue(traineeId, assessment.id, grades) || 0} / {assessment.maxScore}
          </strong>
        </div>
      ))}
      {!assessments.length && <p className="muted">لم تضاف اختبارات لهذا النوع.</p>}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
