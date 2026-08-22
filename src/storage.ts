import { supabase } from "./supabase";
import { starterState } from "./courseData";
import type { AppState, CourseTrainer, Grade } from "./types";

export type CoursePreview = {
  id: string;
  code: string;
  name: string;
  kind: "theory" | "practical";
  sectionNumber: string;
  savedAt: string;
  trainers: CourseTrainer[];
};

export async function loadWorkspace(userId: string): Promise<AppState> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();

  const account = profile
    ? { collegeName: profile.college_name, departmentName: profile.department_name, majorName: profile.major_name }
    : starterState.account;

  const trainer = profile
    ? { name: profile.trainer_name, employeeNumber: profile.employee_number }
    : starterState.trainer;

  // Most recently joined course for this user
  const { data: memberRows } = await supabase
    .from("course_trainers")
    .select("course_id, joined_at")
    .eq("user_id", userId)
    .order("joined_at", { ascending: false })
    .limit(1);

  const courseId = memberRows?.[0]?.course_id;
  if (!courseId) return { ...starterState, account, trainer };

  const { data: courseRow } = await supabase
    .from("courses")
    .select("*")
    .eq("id", courseId)
    .single();

  if (!courseRow) return { ...starterState, account, trainer };

  const course = {
    name: courseRow.name,
    kind: courseRow.kind as "theory" | "practical",
    sectionNumber: courseRow.section_number,
    savedAt: courseRow.saved_at,
    code: courseRow.code,
  };

  const [traineesRes, assessmentsRes, trainersRes] = await Promise.all([
    supabase.from("trainees").select("*").eq("course_id", courseId),
    supabase.from("assessments").select("*").eq("course_id", courseId),
    supabase.from("course_trainers").select("*").eq("course_id", courseId),
  ]);

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
    const { data: gradesData } = await supabase.from("grades").select("*").in("trainee_id", traineeIds);
    grades = (gradesData ?? []).map((g) => ({
      traineeId: g.trainee_id,
      assessmentId: g.assessment_id,
      score: g.score ?? "",
    }));
  }

  return { account, trainer, trainers, course, trainees, assessments, grades };
}

export async function saveWorkspace(userId: string, state: AppState): Promise<void> {
  if (!state.course.code) return;

  await supabase.from("profiles").upsert(
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

  const { data: courseRow, error: courseError } = await supabase
    .from("courses")
    .upsert(
      {
        code: state.course.code,
        name: state.course.name,
        kind: state.course.kind,
        section_number: state.course.sectionNumber,
        saved_at: state.course.savedAt,
        created_by: userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "code" }
    )
    .select("id")
    .single();

  if (courseError || !courseRow) return;
  const courseId = courseRow.id;

  await supabase
    .from("course_trainers")
    .upsert(
      { course_id: courseId, user_id: userId, trainer_name: state.trainer.name, employee_number: state.trainer.employeeNumber },
      { onConflict: "course_id,user_id" }
    );

  // Replace trainees (delete → re-insert so removed trainees disappear; grades cascade-delete with trainees)
  await supabase.from("trainees").delete().eq("course_id", courseId);
  if (state.trainees.length) {
    await supabase.from("trainees").insert(
      state.trainees.map((t) => ({
        id: t.id,
        course_id: courseId,
        training_number: t.trainingNumber,
        name: t.name,
        theory_section: t.theorySection,
        practical_section: t.practicalSection,
      }))
    );
  }

  // Replace assessments
  await supabase.from("assessments").delete().eq("course_id", courseId);
  if (state.assessments.length) {
    await supabase.from("assessments").insert(
      state.assessments.map((a) => ({
        id: a.id,
        course_id: courseId,
        name: a.name,
        kind: a.kind,
        max_score: a.maxScore,
        date: a.date,
      }))
    );
  }

  // Re-insert grades (cascade-deleted above with trainees)
  const scoredGrades = state.grades.filter((g) => g.score !== "");
  if (scoredGrades.length) {
    await supabase.from("grades").insert(
      scoredGrades.map((g) => ({
        trainee_id: g.traineeId,
        assessment_id: g.assessmentId,
        score: g.score as number,
      }))
    );
  }
}

export async function findCourseByCode(code: string): Promise<CoursePreview | null> {
  const { data, error } = await supabase.rpc("find_course_by_code", { p_code: code });
  if (error || !data) return null;
  return {
    id: data.id,
    code: data.code,
    name: data.name,
    kind: data.kind,
    sectionNumber: data.sectionNumber,
    savedAt: data.savedAt,
    trainers: data.trainers ?? [],
  };
}

export async function joinCourse(userId: string, coursePreview: CoursePreview, trainerName: string, employeeNumber: string): Promise<void> {
  await supabase
    .from("course_trainers")
    .upsert(
      { course_id: coursePreview.id, user_id: userId, trainer_name: trainerName, employee_number: employeeNumber },
      { onConflict: "course_id,user_id" }
    );
}

export async function clearWorkspace(userId: string): Promise<void> {
  // Find user's most recently joined course and remove their membership
  const { data: memberRows } = await supabase
    .from("course_trainers")
    .select("course_id")
    .eq("user_id", userId)
    .order("joined_at", { ascending: false })
    .limit(1);

  const courseId = memberRows?.[0]?.course_id;
  if (courseId) {
    await supabase.from("course_trainers").delete().eq("course_id", courseId).eq("user_id", userId);
  }
}
