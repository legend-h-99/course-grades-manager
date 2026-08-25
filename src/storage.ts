import { supabase } from "./supabase";
import { starterState } from "./courseData";
import type { AppState, CourseTrainer, Grade } from "./types";

function removedIds(existingIds: string[], nextIds: string[]) {
  const next = new Set(nextIds);
  return existingIds.filter((id) => !next.has(id));
}

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

export async function loadWorkspace(userId: string): Promise<AppState> {
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();

  if (profileError && profileError.code !== "PGRST116") {
    throw new Error("تعذّر تحميل بيانات الملف الشخصي.");
  }

  const account = profile
    ? { collegeName: profile.college_name, departmentName: profile.department_name, majorName: profile.major_name }
    : starterState.account;

  const trainer = profile
    ? { name: profile.trainer_name, employeeNumber: profile.employee_number }
    : starterState.trainer;

  const { data: memberRows, error: memberError } = await supabase
    .from("course_trainers")
    .select("course_id, joined_at")
    .eq("user_id", userId)
    .order("joined_at", { ascending: false })
    .limit(1);

  if (memberError) throw new Error("تعذّر تحميل بيانات المقرر.");

  const courseId = memberRows?.[0]?.course_id;
  if (!courseId) return { ...starterState, account, trainer };

  const { data: courseRow, error: courseError } = await supabase
    .from("courses")
    .select("*")
    .eq("id", courseId)
    .single();

  if (courseError) throw new Error("تعذّر تحميل بيانات المقرر.");
  if (!courseRow) return { ...starterState, account, trainer };

  const { data: inviteRow, error: inviteError } = await supabase
    .from("course_invites")
    .select("token")
    .eq("course_id", courseId)
    .maybeSingle();
  if (inviteError) throw new Error("تعذّر تحميل رمز دعوة المقرر.");

  const course = {
    name: courseRow.name,
    kind: courseRow.kind as "theory" | "practical",
    sectionNumber: courseRow.section_number,
    savedAt: courseRow.saved_at,
    updatedAt: courseRow.updated_at,
    inviteCode: inviteRow?.token ?? "",
    code: courseRow.code,
  };

  const [traineesRes, assessmentsRes, trainersRes] = await Promise.all([
    supabase.from("trainees").select("*").eq("course_id", courseId),
    supabase.from("assessments").select("*").eq("course_id", courseId),
    supabase.from("course_trainers").select("*").eq("course_id", courseId),
  ]);

  if (traineesRes.error) throw new Error("تعذّر تحميل قائمة المتدربين.");
  if (assessmentsRes.error) throw new Error("تعذّر تحميل الاختبارات.");
  if (trainersRes.error) throw new Error("تعذّر تحميل قائمة المدربين.");

  const trainees = (traineesRes.data ?? []).map((t) => ({
    id: t.id,
    trainingNumber: t.training_number,
    name: t.name,
    theorySection: t.theory_section,
    practicalSection: t.practical_section,
  }));

  const assessments = (assessmentsRes.data ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    kind: a.kind as "theory" | "practical",
    maxScore: a.max_score,
    date: a.date,
    weight: a.weight ?? 0,
  }));

  const trainers: CourseTrainer[] = (trainersRes.data ?? []).map((ct) => ({
    userId: ct.user_id,
    name: ct.trainer_name,
    employeeNumber: ct.employee_number,
    joinedAt: ct.joined_at,
  }));

  const traineeIds = trainees.map((t) => t.id);
  let grades: Grade[] = [];
  if (traineeIds.length) {
    const { data: gradesData, error: gradesError } = await supabase
      .from("grades")
      .select("*")
      .in("trainee_id", traineeIds);
    if (gradesError) throw new Error("تعذّر تحميل الدرجات.");
    grades = (gradesData ?? []).map((g) => ({
      traineeId: g.trainee_id,
      assessmentId: g.assessment_id,
      score: g.score ?? "",
    }));
  }

  return { account, trainer, trainers, course, trainees, assessments, grades };
}

export async function saveWorkspace(userId: string, state: AppState): Promise<SaveWorkspaceResult | undefined> {
  if (!state.course.code) return;

  const { error: profileError } = await supabase.from("profiles").upsert(
    {
      id: userId,
      college_name: state.account.collegeName,
      department_name: state.account.departmentName,
      major_name: state.account.majorName,
      trainer_name: state.trainer.name,
      employee_number: state.trainer.employeeNumber,
    },
    { onConflict: "id" }
  );
  if (profileError) throw new Error("تعذّر حفظ بيانات الملف الشخصي.");

  const { data: existingCourse, error: existingCourseError } = await supabase
    .from("courses")
    .select("id, updated_at, created_by")
    .eq("code", state.course.code)
    .maybeSingle();

  if (existingCourseError) throw new Error("تعذّر التحقق من بيانات المقرر.");

  const nextUpdatedAt = new Date().toISOString();
  const coursePayload = {
    name: state.course.name,
    kind: state.course.kind,
    section_number: state.course.sectionNumber,
    saved_at: state.course.savedAt,
    updated_at: nextUpdatedAt,
  };

  const isCourseOwner = existingCourse?.created_by === userId;
  const courseMutation = !existingCourse
    ? supabase
        .from("courses")
        .insert({ code: state.course.code, ...coursePayload, created_by: userId })
        .select("id, updated_at")
        .single()
    : isCourseOwner
      ? supabase
          .from("courses")
          .update(coursePayload)
          .eq("id", existingCourse.id)
          .eq("updated_at", state.course.updatedAt || existingCourse.updated_at)
          .select("id, updated_at")
          .maybeSingle()
      : supabase
          .rpc("touch_course_revision", {
            p_course_id: existingCourse.id,
            p_expected_updated_at: state.course.updatedAt || existingCourse.updated_at,
          })
          .then(({ data, error }) => ({
            data: data ? { id: existingCourse.id, updated_at: data as string } : null,
            error,
          }));

  const { data: courseRow, error: courseError } = await courseMutation;
  if (courseError) throw new Error("تعذّر حفظ بيانات المقرر.");
  if (!courseRow) throw new Error("تم تعديل المقرر من مدرب آخر. استدعِ آخر نسخة ثم أعد تطبيق تغييراتك.");
  const courseId = courseRow.id;

  const { data: inviteRow, error: inviteError } = await supabase
    .from("course_invites")
    .select("token")
    .eq("course_id", courseId)
    .maybeSingle();
  if (inviteError) throw new Error("تعذّر تحميل رمز دعوة المقرر.");

  const { error: trainerError } = await supabase
    .from("course_trainers")
    .upsert(
      { course_id: courseId, user_id: userId, trainer_name: state.trainer.name, employee_number: state.trainer.employeeNumber },
      { onConflict: "course_id,user_id" }
    );
  if (trainerError) throw new Error("تعذّر حفظ بيانات المدرب.");

  const { data: existingTrainees, error: existingTraineesError } = await supabase
    .from("trainees")
    .select("id")
    .eq("course_id", courseId);
  if (existingTraineesError) throw new Error("تعذّر تحديث قائمة المتدربين.");

  const traineeIds = state.trainees.map((trainee) => trainee.id);
  const traineesToDelete = removedIds((existingTrainees ?? []).map((row) => row.id), traineeIds);
  if (traineesToDelete.length) {
    const { error: deleteTraineesError } = await supabase
      .from("trainees")
      .delete()
      .in("id", traineesToDelete);
    if (deleteTraineesError) throw new Error("تعذّر تحديث قائمة المتدربين.");
  }

  if (state.trainees.length) {
    const { error: upsertTraineesError } = await supabase.from("trainees").upsert(
      state.trainees.map((t) => ({
        id: t.id,
        course_id: courseId,
        training_number: t.trainingNumber,
        name: t.name,
        theory_section: t.theorySection,
        practical_section: t.practicalSection,
      })),
      { onConflict: "id" }
    );
    if (upsertTraineesError) throw new Error("تعذّر حفظ بيانات المتدربين.");
  }

  const { data: existingAssessments, error: existingAssessmentsError } = await supabase
    .from("assessments")
    .select("id")
    .eq("course_id", courseId);
  if (existingAssessmentsError) throw new Error("تعذّر تحديث الاختبارات.");

  const assessmentIds = state.assessments.map((assessment) => assessment.id);
  const assessmentsToDelete = removedIds((existingAssessments ?? []).map((row) => row.id), assessmentIds);
  if (assessmentsToDelete.length) {
    const { error: deleteAssessmentsError } = await supabase
      .from("assessments")
      .delete()
      .in("id", assessmentsToDelete);
    if (deleteAssessmentsError) throw new Error("تعذّر تحديث الاختبارات.");
  }

  if (state.assessments.length) {
    const { error: upsertAssessmentsError } = await supabase.from("assessments").upsert(
      state.assessments.map((a) => ({
        id: a.id,
        course_id: courseId,
        name: a.name,
        kind: a.kind,
        max_score: a.maxScore,
        date: a.date,
        weight: a.weight ?? 0,
      })),
      { onConflict: "id" }
    );
    if (upsertAssessmentsError) throw new Error("تعذّر حفظ بيانات الاختبارات.");
  }

  const scoredGrades = state.grades.filter((g) => g.score !== "");
  const blankGrades = state.grades.filter((g) => g.score === "");
  if (blankGrades.length) {
    const deleteBlankResults = await Promise.all(
      blankGrades.map((grade) =>
        supabase
          .from("grades")
          .delete()
          .eq("trainee_id", grade.traineeId)
          .eq("assessment_id", grade.assessmentId)
      )
    );
    if (deleteBlankResults.some((result) => result.error)) throw new Error("تعذّر تحديث الدرجات.");
  }

  if (scoredGrades.length) {
    const { error: gradesError } = await supabase.from("grades").upsert(
      scoredGrades.map((g) => ({
        trainee_id: g.traineeId,
        assessment_id: g.assessmentId,
        score: g.score as number,
      })),
      { onConflict: "trainee_id,assessment_id" }
    );
    if (gradesError) throw new Error("تعذّر حفظ الدرجات.");
  }

  return {
    updatedAt: courseRow.updated_at ?? nextUpdatedAt,
    inviteCode: inviteRow?.token ?? state.course.inviteCode,
  };
}

export async function findCourseByCode(code: string): Promise<CoursePreview | null> {
  const { data, error } = await supabase
    .rpc("find_course_invite_by_code", { p_code: code })
    .maybeSingle();
  if (error || !data) return null;
  const invite = data as { code: string };
  return {
    id: "",
    code: invite.code,
    name: "",
    kind: "theory",
    sectionNumber: "",
    savedAt: "",
    trainers: [],
  };
}

export async function joinCourse(userId: string, coursePreview: CoursePreview, trainerName: string, employeeNumber: string): Promise<void> {
  const { error } = await supabase.rpc("join_course_by_code", {
    p_code: coursePreview.code,
    p_trainer_name: trainerName,
    p_employee_number: employeeNumber,
  });
  if (error) throw new Error("تعذّر الانضمام للمقرر.");
}

export async function clearWorkspace(userId: string): Promise<void> {
  const { data: memberRows, error: memberError } = await supabase
    .from("course_trainers")
    .select("course_id")
    .eq("user_id", userId)
    .order("joined_at", { ascending: false })
    .limit(1);

  if (memberError) throw new Error("تعذّر تحديد المقرر الحالي.");

  const courseId = memberRows?.[0]?.course_id;
  if (courseId) {
    const { error } = await supabase.from("course_trainers").delete().eq("course_id", courseId).eq("user_id", userId);
    if (error) throw new Error("تعذّر مسح بيانات المقرر.");
  }
}
