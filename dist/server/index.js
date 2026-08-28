const cacheHeaders = {
  "Cache-Control": "public, max-age=31536000, immutable"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

function error(message, status = 400) {
  return json({ message }, status);
}

function withHeaders(response, headers) {
  const nextHeaders = new Headers(response.headers);
  for (const [key, value] of Object.entries(headers)) nextHeaders.set(key, value);
  nextHeaders.set("X-Content-Type-Options", "nosniff");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: nextHeaders });
}

async function readBody(request) {
  if (request.method === "GET" || request.method === "HEAD") return {};
  return request.json().catch(() => ({}));
}

function requireConfig(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    throw new Error("إعدادات الخادم غير مكتملة.");
  }
}

function userFromSupabase(user) {
  return {
    id: user?.id ?? "",
    email: user?.email ?? "",
    fullName: user?.user_metadata?.full_name ?? ""
  };
}

function bearer(request) {
  const value = request.headers.get("Authorization") ?? "";
  return value.startsWith("Bearer ") ? value.slice(7) : "";
}

async function supabase(env, path, { method = "GET", token, body, headers = {} } = {}) {
  requireConfig(env);
  const response = await fetch(new URL(path, env.SUPABASE_URL), {
    method,
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: token ? "Bearer " + token : "Bearer " + env.SUPABASE_ANON_KEY,
      "Content-Type": "application/json",
      ...headers
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.msg || payload?.message || payload?.error_description || payload?.hint || "تعذّر تنفيذ الطلب.");
  }
  return payload;
}

async function authUser(env, token) {
  if (!token) throw new Error("سجّل الدخول أولًا.");
  const user = await supabase(env, "/auth/v1/user", { token });
  return user;
}

async function profileExists(env, token, userId) {
  const rows = await supabase(env, "/rest/v1/profiles?id=eq." + encodeURIComponent(userId) + "&select=id&limit=1", { token });
  return Array.isArray(rows) && rows.length > 0;
}

async function requireUser(env, request) {
  const token = bearer(request);
  const user = await authUser(env, token);
  return { token, user };
}

function sessionPayload(data, profile) {
  if (!data?.access_token || !data?.user) return { message: "تم تنفيذ الطلب." };
  return {
    session: {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      user: userFromSupabase(data.user)
    },
    user: userFromSupabase(data.user),
    profileExists: Boolean(profile)
  };
}

async function handleAuth(request, env, pathname) {
  const body = await readBody(request);
  const url = new URL(request.url);

  if (pathname === "/api/auth/me") {
    const token = bearer(request);
    const user = await authUser(env, token);
    return json({ user: userFromSupabase(user), profileExists: await profileExists(env, token, user.id) });
  }

  if (pathname === "/api/auth/google") {
    if (!env.GOOGLE_CLIENT_ID) throw new Error("إعدادات Google غير مكتملة.");
    const redirectUri = new URL("/auth/callback", url.origin).toString();
    const googleUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    googleUrl.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
    googleUrl.searchParams.set("redirect_uri", redirectUri);
    googleUrl.searchParams.set("response_type", "code");
    googleUrl.searchParams.set("scope", "openid email profile");
    googleUrl.searchParams.set("access_type", "offline");
    googleUrl.searchParams.set("prompt", "select_account");
    return Response.redirect(googleUrl.toString(), 302);
  }

  if (pathname === "/api/auth/google/exchange") {
    requireConfig(env);
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) throw new Error("إعدادات Google غير مكتملة.");
    const code = body.code;
    if (!code) return error("رمز التفويض مفقود.");
    const redirectUri = new URL("/auth/callback", url.origin).toString();
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: redirectUri, grant_type: "authorization_code" }).toString(),
    });
    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenData.id_token) throw new Error(tokenData.error_description || "فشل التحقق من Google.");
    const data = await supabase(env, "/auth/v1/token?grant_type=id_token", {
      method: "POST",
      body: { provider: "google", id_token: tokenData.id_token, access_token: tokenData.access_token },
    });
    return json(sessionPayload(data, await profileExists(env, data.access_token, data.user.id)));
  }

  if (pathname === "/api/auth/sign-in") {
    const data = await supabase(env, "/auth/v1/token?grant_type=password", {
      method: "POST",
      body: { email: body.email, password: body.password }
    });
    return json(sessionPayload(data, await profileExists(env, data.access_token, data.user.id)));
  }

  if (pathname === "/api/auth/sign-up") {
    const redirect = body.redirectTo ? "?redirect_to=" + encodeURIComponent(body.redirectTo) : "";
    const data = await supabase(env, "/auth/v1/signup" + redirect, {
      method: "POST",
      body: { email: body.email, password: body.password, data: {}, gotrue_meta_security: {} }
    });
    if (!data?.access_token) return json({ message: "تم إنشاء الحساب. تحقق من البريد الإلكتروني." });
    return json(sessionPayload(data, await profileExists(env, data.access_token, data.user.id)));
  }

  if (pathname === "/api/auth/reset-password") {
    const redirect = body.redirectTo ? "?redirect_to=" + encodeURIComponent(body.redirectTo) : "";
    await supabase(env, "/auth/v1/recover" + redirect, {
      method: "POST",
      body: { email: body.email, gotrue_meta_security: {} }
    });
    return json({ message: "تم إرسال رابط إعادة الضبط." });
  }

  if (pathname === "/api/auth/send-otp") {
    await supabase(env, "/auth/v1/otp", {
      method: "POST",
      body: { email: body.email, create_user: true, gotrue_meta_security: {} }
    });
    return json({ message: "تم إرسال رمز التحقق." });
  }

  if (pathname === "/api/auth/verify-otp") {
    const data = await supabase(env, "/auth/v1/verify", {
      method: "POST",
      body: { email: body.email, token: body.token, type: "email" }
    });
    return json(sessionPayload(data, await profileExists(env, data.access_token, data.user.id)));
  }

  if (pathname === "/api/auth/update-password") {
    const token = bearer(request);
    const user = await supabase(env, "/auth/v1/user", { method: "PUT", token, body: { password: body.password } });
    return json({ session: { accessToken: token, user: userFromSupabase(user) }, user: userFromSupabase(user), profileExists: await profileExists(env, token, user.id) });
  }

  if (pathname === "/api/auth/update-user") {
    const token = bearer(request);
    const user = await supabase(env, "/auth/v1/user", { method: "PUT", token, body: { data: body.data ?? {} } });
    return json({ session: { accessToken: token, user: userFromSupabase(user) }, user: userFromSupabase(user), profileExists: await profileExists(env, token, user.id) });
  }

  if (pathname === "/api/auth/sign-out") {
    const token = bearer(request);
    if (token) await supabase(env, "/auth/v1/logout", { method: "POST", token });
    return json({ message: "تم تسجيل الخروج." });
  }

  return error("Not found", 404);
}

function first(rows) {
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

function inList(values) {
  return values.map((value) => encodeURIComponent(value)).join(",");
}

async function upsert(env, token, table, rows, conflict) {
  if (!rows.length) return [];
  return supabase(env, "/rest/v1/" + table + "?on_conflict=" + encodeURIComponent(conflict), {
    method: "POST",
    token,
    body: rows,
    headers: { Prefer: "resolution=merge-duplicates,return=representation" }
  });
}

async function saveProfile(env, token, userId, profile) {
  await upsert(env, token, "profiles", [{
    id: userId,
    college_name: profile.collegeName ?? "",
    department_name: profile.departmentName ?? "",
    major_name: profile.majorName ?? "",
    trainer_name: profile.trainerName ?? "",
    employee_number: profile.employeeNumber ?? ""
  }], "id");
}

async function loadWorkspace(env, token, userId) {
  const starterState = {
    account: { collegeName: "", departmentName: "", majorName: "" },
    trainer: { name: "", employeeNumber: "" },
    trainers: [],
    course: { name: "", kind: "theory", sectionNumber: "", savedAt: "", updatedAt: "", inviteCode: "", code: "" },
    trainees: [],
    assessments: [],
    grades: []
  };

  const profile = first(await supabase(env, "/rest/v1/profiles?id=eq." + encodeURIComponent(userId) + "&select=*&limit=1", { token }));
  const account = profile
    ? { collegeName: profile.college_name, departmentName: profile.department_name, majorName: profile.major_name }
    : starterState.account;
  const trainer = profile
    ? { name: profile.trainer_name, employeeNumber: profile.employee_number }
    : starterState.trainer;

  const member = first(await supabase(env, "/rest/v1/course_trainers?user_id=eq." + encodeURIComponent(userId) + "&select=course_id,joined_at&order=joined_at.desc&limit=1", { token }));
  if (!member?.course_id) return { ...starterState, account, trainer };

  const courseRow = first(await supabase(env, "/rest/v1/courses?id=eq." + encodeURIComponent(member.course_id) + "&select=*&limit=1", { token }));
  if (!courseRow) return { ...starterState, account, trainer };

  const inviteRow = first(await supabase(env, "/rest/v1/course_invites?course_id=eq." + encodeURIComponent(courseRow.id) + "&select=token&limit=1", { token }));
  const [traineeRows, assessmentRows, trainerRows] = await Promise.all([
    supabase(env, "/rest/v1/trainees?course_id=eq." + encodeURIComponent(courseRow.id) + "&select=*", { token }),
    supabase(env, "/rest/v1/assessments?course_id=eq." + encodeURIComponent(courseRow.id) + "&select=*", { token }),
    supabase(env, "/rest/v1/course_trainers?course_id=eq." + encodeURIComponent(courseRow.id) + "&select=*", { token })
  ]);

  const trainees = (traineeRows ?? []).map((t) => ({
    id: t.id,
    trainingNumber: t.training_number,
    name: t.name,
    theorySection: t.theory_section,
    practicalSection: t.practical_section
  }));
  const assessments = (assessmentRows ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    kind: a.kind,
    maxScore: a.max_score,
    date: a.date,
    weight: a.weight ?? 0
  }));
  const trainers = (trainerRows ?? []).map((ct) => ({
    userId: ct.user_id,
    name: ct.trainer_name,
    employeeNumber: ct.employee_number,
    joinedAt: ct.joined_at
  }));

  const traineeIds = trainees.map((t) => t.id);
  const gradeRows = traineeIds.length
    ? await supabase(env, "/rest/v1/grades?trainee_id=in.(" + inList(traineeIds) + ")&select=*", { token })
    : [];
  const grades = (gradeRows ?? []).map((g) => ({
    traineeId: g.trainee_id,
    assessmentId: g.assessment_id,
    score: g.score ?? ""
  }));

  return {
    account,
    trainer,
    trainers,
    course: {
      name: courseRow.name,
      kind: courseRow.kind,
      sectionNumber: courseRow.section_number,
      savedAt: courseRow.saved_at,
      updatedAt: courseRow.updated_at,
      inviteCode: inviteRow?.token ?? "",
      code: courseRow.code
    },
    trainees,
    assessments,
    grades
  };
}

async function saveWorkspace(env, token, userId, state) {
  await saveProfile(env, token, userId, {
    collegeName: state.account.collegeName,
    departmentName: state.account.departmentName,
    majorName: state.account.majorName,
    trainerName: state.trainer.name,
    employeeNumber: state.trainer.employeeNumber
  });

  const existingCourse = first(await supabase(env, "/rest/v1/courses?code=eq." + encodeURIComponent(state.course.code) + "&select=id,updated_at,created_by&limit=1", { token }));
  const nextUpdatedAt = new Date().toISOString();
  const coursePayload = {
    name: state.course.name,
    kind: state.course.kind,
    section_number: state.course.sectionNumber,
    saved_at: state.course.savedAt,
    updated_at: nextUpdatedAt
  };

  let courseRow;
  if (!existingCourse) {
    courseRow = first(await supabase(env, "/rest/v1/courses", {
      method: "POST",
      token,
      body: [{ code: state.course.code, ...coursePayload, created_by: userId }],
      headers: { Prefer: "return=representation" }
    }));
  } else if (existingCourse.created_by === userId) {
    courseRow = first(await supabase(env, "/rest/v1/courses?id=eq." + encodeURIComponent(existingCourse.id) + "&updated_at=eq." + encodeURIComponent(state.course.updatedAt || existingCourse.updated_at) + "&select=id,updated_at", {
      method: "PATCH",
      token,
      body: coursePayload,
      headers: { Prefer: "return=representation" }
    }));
  } else {
    const updatedAt = await supabase(env, "/rest/v1/rpc/touch_course_revision", {
      method: "POST",
      token,
      body: { p_course_id: existingCourse.id, p_expected_updated_at: state.course.updatedAt || existingCourse.updated_at }
    });
    courseRow = { id: existingCourse.id, updated_at: updatedAt };
  }
  if (!courseRow) throw new Error("تم تعديل المقرر من مدرب آخر. استدعِ آخر نسخة ثم أعد تطبيق تغييراتك.");
  const courseId = courseRow.id;

  await upsert(env, token, "course_trainers", [{
    course_id: courseId,
    user_id: userId,
    trainer_name: state.trainer.name,
    employee_number: state.trainer.employeeNumber
  }], "course_id,user_id");

  const existingTrainees = await supabase(env, "/rest/v1/trainees?course_id=eq." + encodeURIComponent(courseId) + "&select=id", { token });
  const traineeIds = state.trainees.map((trainee) => trainee.id);
  const traineesToDelete = (existingTrainees ?? []).map((row) => row.id).filter((id) => !traineeIds.includes(id));
  if (traineesToDelete.length) {
    await supabase(env, "/rest/v1/trainees?id=in.(" + inList(traineesToDelete) + ")", { method: "DELETE", token });
  }
  await upsert(env, token, "trainees", state.trainees.map((t) => ({
    id: t.id,
    course_id: courseId,
    training_number: t.trainingNumber,
    name: t.name,
    theory_section: t.theorySection,
    practical_section: t.practicalSection
  })), "id");

  const existingAssessments = await supabase(env, "/rest/v1/assessments?course_id=eq." + encodeURIComponent(courseId) + "&select=id", { token });
  const assessmentIds = state.assessments.map((assessment) => assessment.id);
  const assessmentsToDelete = (existingAssessments ?? []).map((row) => row.id).filter((id) => !assessmentIds.includes(id));
  if (assessmentsToDelete.length) {
    await supabase(env, "/rest/v1/assessments?id=in.(" + inList(assessmentsToDelete) + ")", { method: "DELETE", token });
  }
  await upsert(env, token, "assessments", state.assessments.map((a) => ({
    id: a.id,
    course_id: courseId,
    name: a.name,
    kind: a.kind,
    max_score: a.maxScore,
    date: a.date,
    weight: a.weight ?? 0
  })), "id");

  const scoredGrades = state.grades.filter((g) => g.score !== "");
  const blankGrades = state.grades.filter((g) => g.score === "");
  await Promise.all(blankGrades.map((grade) =>
    supabase(env, "/rest/v1/grades?trainee_id=eq." + encodeURIComponent(grade.traineeId) + "&assessment_id=eq." + encodeURIComponent(grade.assessmentId), { method: "DELETE", token })
  ));
  await upsert(env, token, "grades", scoredGrades.map((g) => ({
    trainee_id: g.traineeId,
    assessment_id: g.assessmentId,
    score: g.score
  })), "trainee_id,assessment_id");

  const inviteRow = first(await supabase(env, "/rest/v1/course_invites?course_id=eq." + encodeURIComponent(courseId) + "&select=token&limit=1", { token }));
  return { updatedAt: courseRow.updated_at ?? nextUpdatedAt, inviteCode: inviteRow?.token ?? state.course.inviteCode };
}

async function handleWorkspace(request, env, pathname) {
  const body = await readBody(request);

  if (pathname === "/api/workspace" && request.method === "GET") {
    const { token, user } = await requireUser(env, request);
    return json(await loadWorkspace(env, token, user.id));
  }

  if (pathname === "/api/workspace/profile") {
    const { token, user } = await requireUser(env, request);
    await saveProfile(env, token, user.id, body.profile ?? {});
    return json({ message: "تم حفظ الملف الشخصي." });
  }

  if (pathname === "/api/workspace/save") {
    const { token, user } = await requireUser(env, request);
    if (!body.state?.course?.code) return error("أنشئ رمز المقرر أولًا.");
    return json(await saveWorkspace(env, token, user.id, body.state));
  }

  if (pathname === "/api/workspace/find-course") {
    const { token } = await requireUser(env, request);
    const data = await supabase(env, "/rest/v1/rpc/find_course_invite_by_code", { method: "POST", token, body: { p_code: body.code } }).catch(() => null);
    if (!data?.code) return json(null);
    return json({ id: "", code: data.code, name: "", kind: "theory", sectionNumber: "", savedAt: "", trainers: [] });
  }

  if (pathname === "/api/workspace/join-course") {
    const { token } = await requireUser(env, request);
    await supabase(env, "/rest/v1/rpc/join_course_by_code", {
      method: "POST",
      token,
      body: { p_code: body.code, p_trainer_name: body.trainerName, p_employee_number: body.employeeNumber }
    });
    return json({ message: "تم الانضمام للمقرر." });
  }

  if (pathname === "/api/workspace/clear") {
    const { token, user } = await requireUser(env, request);
    const member = first(await supabase(env, "/rest/v1/course_trainers?user_id=eq." + encodeURIComponent(user.id) + "&select=course_id&order=joined_at.desc&limit=1", { token }));
    if (member?.course_id) {
      await supabase(env, "/rest/v1/course_trainers?course_id=eq." + encodeURIComponent(member.course_id) + "&user_id=eq." + encodeURIComponent(user.id), { method: "DELETE", token });
    }
    return json({ message: "تم مسح بيانات المقرر." });
  }

  return error("Not found", 404);
}

async function fetchAsset(env, request, path) {
  const url = new URL(request.url);
  url.pathname = path;
  url.search = "";
  return env.ASSETS.fetch(new Request(url, request));
}

function checkOrigin(request, url) {
  if (request.method === "GET" || request.method === "HEAD") return;
  const origin = request.headers.get("Origin");
  if (!origin) return;
  if (new URL(origin).origin !== url.origin) throw new Error("طلب غير مصرح به.");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/auth/callback") {
      const indexResponse = await fetchAsset(env, request, "/");
      return withHeaders(indexResponse, { "Cache-Control": "no-store" });
    }

    if (url.pathname.startsWith("/api/auth/")) {
      try {
        checkOrigin(request, url);
        return await handleAuth(request, env, url.pathname);
      } catch (err) {
        return error(err.message || "تعذّر تنفيذ الطلب.", err.message === "سجّل الدخول أولًا." ? 401 : 400);
      }
    }

    if (url.pathname.startsWith("/api/workspace")) {
      try {
        checkOrigin(request, url);
        return await handleWorkspace(request, env, url.pathname);
      } catch (err) {
        return error(err.message || "تعذّر تنفيذ الطلب.", err.message === "سجّل الدخول أولًا." ? 401 : 400);
      }
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Not found", { status: 404 });
    }

    const assetResponse = await fetchAsset(env, request, url.pathname);
    if (assetResponse.ok) {
      return url.pathname.startsWith("/assets/")
        ? withHeaders(assetResponse, cacheHeaders)
        : withHeaders(assetResponse, { "Cache-Control": "no-store" });
    }

    const indexResponse = await fetchAsset(env, request, "/");
    return withHeaders(indexResponse, { "Cache-Control": "no-store" });
  }
};
