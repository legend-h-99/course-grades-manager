import type { SessionUser } from "./types";

type StoredSession = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  user: SessionUser;
};

type ApiAuthResponse = {
  session?: {
    accessToken: string;
    refreshToken?: string;
    expiresIn?: number;
    user: SessionUser;
  };
  user?: SessionUser;
  profileExists?: boolean;
  message?: string;
};

const sessionKey = "sanad.session";

function oauthParamsFromLocation() {
  const hash = window.location.hash.replace(/^#/, "");
  const query = window.location.search.replace(/^\?/, "");
  const candidates = [
    hash,
    query,
    hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "",
    hash.includes("#") ? hash.slice(hash.lastIndexOf("#") + 1) : "",
  ].filter(Boolean);

  for (const candidate of candidates) {
    const params = new URLSearchParams(candidate);
    const accessToken = params.get("access_token");
    if (accessToken) {
      return {
        accessToken,
        refreshToken: params.get("refresh_token") ?? undefined,
        expiresIn: Number(params.get("expires_in") ?? "") || undefined,
      };
    }
  }

  return null;
}

function readStoredSession(): StoredSession | null {
  try {
    const raw = window.sessionStorage.getItem(sessionKey);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}

function writeStoredSession(session: ApiAuthResponse["session"]) {
  if (!session) return;
  const expiresAt = session.expiresIn ? Date.now() + session.expiresIn * 1000 : undefined;
  window.sessionStorage.setItem(
    sessionKey,
    JSON.stringify({
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      expiresAt,
      user: session.user,
    })
  );
}

async function request<T>(path: string, options: RequestInit = {}, authenticated = true): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type") && options.body) headers.set("Content-Type", "application/json");

  if (authenticated) {
    const session = readStoredSession();
    if (!session?.accessToken) throw new Error("سجّل الدخول أولًا.");
    headers.set("Authorization", `Bearer ${session.accessToken}`);
  }

  const response = await fetch(path, { ...options, headers });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.message || "تعذّر تنفيذ الطلب.");
  }
  return payload as T;
}

function body(value: unknown) {
  return { method: "POST", body: JSON.stringify(value) };
}

function normalizeSession(payload: ApiAuthResponse) {
  if (payload.session) writeStoredSession(payload.session);
  return payload;
}

export const authApi = {
  async completeOAuthCallback() {
    const tokens = oauthParamsFromLocation();
    if (!tokens?.accessToken) return { session: null, profileExists: false };

    const response = await fetch("/api/auth/me", {
      method: "GET",
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    const payload = await response.json().catch(() => null) as ApiAuthResponse | null;
    if (!response.ok || !payload?.user) throw new Error(payload?.message || "تعذّر إكمال تسجيل الدخول.");

    const session = {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
      user: payload.user,
    };
    writeStoredSession(session);
    window.history.replaceState(null, "", "/#/login");
    return { session: readStoredSession(), profileExists: Boolean(payload.profileExists) };
  },

  signInWithGoogle() {
    const redirectTo = `${window.location.origin}/auth/callback`;
    window.location.assign(`/api/auth/google?redirectTo=${encodeURIComponent(redirectTo)}`);
  },

  async getSession() {
    const session = readStoredSession();
    if (!session?.accessToken) return { session: null, profileExists: false };
    try {
      const payload = await request<ApiAuthResponse>("/api/auth/me", { method: "GET" });
      const nextSession = payload.user ? { ...session, user: payload.user } : session;
      window.sessionStorage.setItem(sessionKey, JSON.stringify(nextSession));
      return { session: nextSession, profileExists: Boolean(payload.profileExists) };
    } catch {
      window.sessionStorage.removeItem(sessionKey);
      return { session: null, profileExists: false };
    }
  },

  async signInWithPassword(email: string, password: string) {
    return normalizeSession(await request<ApiAuthResponse>("/api/auth/sign-in", body({ email, password }), false));
  },

  async signUp(email: string, password: string, redirectTo: string) {
    return normalizeSession(await request<ApiAuthResponse>("/api/auth/sign-up", body({ email, password, redirectTo }), false));
  },

  async resetPassword(email: string, redirectTo: string) {
    return request<ApiAuthResponse>("/api/auth/reset-password", body({ email, redirectTo }), false);
  },

  async updatePassword(password: string) {
    return normalizeSession(await request<ApiAuthResponse>("/api/auth/update-password", body({ password })));
  },

  async sendOtp(email: string) {
    return request<ApiAuthResponse>("/api/auth/send-otp", body({ email }), false);
  },

  async verifyOtp(email: string, token: string) {
    return normalizeSession(await request<ApiAuthResponse>("/api/auth/verify-otp", body({ email, token }), false));
  },

  async updateUserMetadata(data: Record<string, unknown>) {
    const payload = normalizeSession(await request<ApiAuthResponse>("/api/auth/update-user", body({ data })));
    return payload.user;
  },

  async signOut() {
    try {
      await request<ApiAuthResponse>("/api/auth/sign-out", { method: "POST" });
    } finally {
      window.sessionStorage.removeItem(sessionKey);
    }
  },
};

export async function apiGet<T>(path: string) {
  return request<T>(path, { method: "GET" });
}

export async function apiPost<T>(path: string, value?: unknown) {
  return request<T>(path, body(value ?? {}));
}
