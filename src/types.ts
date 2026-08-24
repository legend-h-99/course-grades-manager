export type AssessmentKind = "theory" | "practical";

export type TrainerProfile = {
  name: string;
  employeeNumber: string;
};

export type AccountProfile = {
  collegeName: string;
  departmentName: string;
  majorName: string;
};

export type CourseSetup = {
  name: string;
  kind: AssessmentKind;
  sectionNumber: string;
  savedAt: string;
  code: string;
};

export type Trainee = {
  id: string;
  trainingNumber: string;
  name: string;
  theorySection: string;
  practicalSection: string;
};

export type Assessment = {
  id: string;
  name: string;
  kind: AssessmentKind;
  maxScore: number;
  date: string;
  weight: number; // 0 = unweighted (raw sum), >0 = contributes weight% to final score
};

export type Grade = {
  traineeId: string;
  assessmentId: string;
  score: number | "";
};

export type CourseTrainer = TrainerProfile & {
  userId: string;
  joinedAt: string;
};

export type AppState = {
  account: AccountProfile;
  trainer: TrainerProfile;
  trainers: CourseTrainer[];
  course: CourseSetup;
  trainees: Trainee[];
  assessments: Assessment[];
  grades: Grade[];
};

export type CourseRecord = {
  code: string;
  state: AppState;
  trainers: CourseTrainer[];
  updatedAt: string;
};

export type AuthUser = {
  id: string;
  fullName: string;
  email: string;
  createdAt: string;
};

export type AppPage = "home" | "register" | "login" | "app";

export type SessionUser = { id: string; fullName: string; email: string };
