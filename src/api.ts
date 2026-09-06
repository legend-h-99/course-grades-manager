import { getSessionKey } from "./sessionKey";
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

async function encryptSession(plaintext: string): Promise<string> {
  const key = await getSessionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  const combined = new Uint8Array(12 + cipher.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(cipher), 12);
  return btoa(String.fromCharCode(...combined));
}

async function decryptSession(value: string): Promise<string | null> {
  try {
    const key = await getSessionKey();
    const combined = Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const data = combined.slice(12);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

// ── OAuth CSRF state ─────────────────────────────────────────────────────
// Stored in sessionStorage so it survives the Google redirect round-trip
// (a full page navigation destroys JS heap but keeps sessionStorage).
// One-time use: consumed and removed on callback.
const oauthStateKey = "sanad.oauth_state";

function generateOAuthState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const state = btoa(String.fromCharCode(...bytes));
  window.sessionStorage.setItem(oauthStateKey, state);
  return state;
}

function consumeOAuthState(returned: string | null): boolean {
  const stored = window.sessionStorage.getItem(oauthStateKey);
  window.sessionStorage.removeItem(oauthStateKey);
  if (!returned || !stored) return false;
  return returned === stored;
}

// ── Session persistence ───────────────────────────────────────────────────

async function readStoredSession(): Promise<StoredSession | null> {
  try {
    const raw = window.sessionStorage.getItem(sessionKey);
    if (!raw) return null;
    const decrypted = await decryptSession(raw);
    if (!decrypted) {
      window.sessionStorage.removeItem(sessionKey);
      return null;
    }
    const session = JSON.parse(decrypted) as StoredSession;
    if (!session.accessToken || !session.user?.id) {
      window.sessionStorage.removeItem(sessionKey);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

async function writeStoredSession(session: ApiAuthResponse["session"] | StoredSession): Promise<void> {
  if (!session) return;
  const previous = await readStoredSession();
  const sameToken = previous?.accessToken === session.accessToken;
  const expiresAt = "expiresIn" in session && session.expiresIn
    ? Date.now() + (session.expiresIn as number) * 1000
    : (session as StoredSession).expiresAt ?? (sameToken ? previous?.expiresAt : undefined);
  const payload: StoredSession = {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken ?? (sameToken ? previous?.refreshToken : undefined),
    expiresAt,
    user: session.user,
  };
  const encrypted = await encryptSession(JSON.stringify(payload));
  window.sessionStorage.setItem(sessionKey, encrypted);
}

function clearStoredSession() {
  sessionGeneration += 1;
  window.sessionStorage.removeItem(sessionKey);
}

// ── OAuth URL params ──────────────────────────────────────────────────────

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

class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

let refreshing: Promise<StoredSession | null> | undefined;
let sessionGeneration = 0;

async function validSession(): Promise<StoredSession | null> {
  const session = await readStoredSession();
  if (!session?.expiresAt || session.expiresAt > Date.now() + 30_000) return session;
  if (!session.refreshToken) { clearStoredSession(); return null; }
  if (!refreshing) {
    const generation = sessionGeneration;
    refreshing = (async () => {
      const response = await fetch("/api/auth/refresh", body({ refreshToken: session.refreshToken }));
      const payload = await response.json() as ApiAuthResponse;
      if (!response.ok || !payload.session) {
        if (response.status === 400 || response.status === 401) clearStoredSession();
        throw new ApiError(payload.message || "تعذّر تجديد الجلسة.", response.status);
      }
      if (generation !== sessionGeneration) return null;
      await writeStoredSession(payload.session);
      return readStoredSession();
    })().finally(() => { refreshing = undefined; });
  }
  return refreshing;
}

// ── HTTP helper ───────────────────────────────────────────────────────────

async function request<T>(path: string, options: RequestInit = {}, authenticated = true): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type") && options.body) headers.set("Content-Type", "application/json");

  if (authenticated) {
    const session = await validSession();
    if (!session?.accessToken) throw new Error("سجّل الدخول أولًا.");
    headers.set("Authorization", `Bearer ${session.accessToken}`);
  }

  const response = await fetch(path, { ...options, headers });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(payload?.message || "تعذّر تنفيذ الطلب.", response.status);
  }
  return payload as T;
}

function body(value: unknown) {
  return { method: "POST", body: JSON.stringify(value) };
}

async function normalizeSession(payload: ApiAuthResponse): Promise<ApiAuthResponse> {
  if (payload.session) await writeStoredSession(payload.session);
  return payload;
}

// ── Public API ────────────────────────────────────────────────────────────

export const authApi = {
  async completeOAuthCallback() {
    const searchParams = new URLSearchParams(window.location.search);
    // Ordinary navigation is not an OAuth callback and must not consume state.
    if (!searchParams.has("code") && !searchParams.has("error") && !oauthParamsFromLocation()) {
      return { session: null, profileExists: false };
    }

    // Map provider error codes to safe Arabic messages (never echo raw error_description)
    const errorCode = searchParams.get("error");
    if (errorCode) {
      window.history.replaceState(null, "", "/#/login");
      const safeMessages: Record<string, string> = {
        access_denied: "تم رفض الدخول. يرجى المحاولة مجدداً.",
        server_error: "حدث خطأ في الخادم. يرجى المحاولة لاحقاً.",
        temporarily_unavailable: "الخدمة غير متاحة مؤقتاً.",
      };
      throw new Error(safeMessages[errorCode] ?? "تعذّر إكمال تسجيل الدخول.");
    }

    // Validate CSRF state before exchanging the code
    const returnedState = searchParams.get("state");
    if (!consumeOAuthState(returnedState)) {
      window.history.replaceState(null, "", "/#/login");
      throw new Error("فشل التحقق من الجلسة. يرجى المحاولة مجدداً.");
    }

    // Code-based flow: Worker handles Google OAuth exchange
    const code = searchParams.get("code");
    if (code) {
      const payload = await request<ApiAuthResponse>("/api/auth/google/exchange", body({ code }), false);
      if (!payload.session) throw new Error("تعذّر إكمال تسجيل الدخول.");
      await writeStoredSession(payload.session);
      window.history.replaceState(null, "", "/#/login");
      return { session: await readStoredSession(), profileExists: Boolean(payload.profileExists) };
    }

    // Legacy: access_token in URL hash (fallback)
    const tokens = oauthParamsFromLocation();
    if (!tokens?.accessToken) return { session: null, profileExists: false };

    const response = await fetch("/api/auth/me", {
      method: "GET",
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    const payload = await response.json().catch(() => null) as ApiAuthResponse | null;
    if (!response.ok || !payload?.user) throw new Error(payload?.message || "تعذّر إكمال تسجيل الدخول.");

    await writeStoredSession({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
      user: payload.user,
    });
    window.history.replaceState(null, "", "/#/login");
    return { session: await readStoredSession(), profileExists: Boolean(payload.profileExists) };
  },

  signInWithGoogle() {
    const state = generateOAuthState();
    const redirectTo = `${window.location.origin}/auth/callback`;
    window.location.assign(
      `/api/auth/google?redirectTo=${encodeURIComponent(redirectTo)}&state=${encodeURIComponent(state)}`,
    );
  },

  async getSession() {
    try {
      const session = await validSession();
      if (!session?.accessToken) return { session: null, profileExists: false };
      const payload = await request<ApiAuthResponse>("/api/auth/me", { method: "GET" });
      const nextSession: StoredSession = payload.user
        ? { ...session, user: payload.user }
        : session;
      await writeStoredSession(nextSession);
      return { session: nextSession, profileExists: Boolean(payload.profileExists) };
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        clearStoredSession();
        return { session: null, profileExists: false };
      }
      throw error;
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
    const payload = await normalizeSession(await request<ApiAuthResponse>("/api/auth/update-user", body({ data })));
    return payload.user;
  },

  async signOut() {
    try {
      await request<ApiAuthResponse>("/api/auth/sign-out", { method: "POST" });
    } finally {
      clearStoredSession();
    }
  },
};

export async function apiGet<T>(path: string) {
  return request<T>(path, { method: "GET" });
}

export async function apiPost<T>(path: string, value?: unknown) {
  return request<T>(path, body(value ?? {}));
}
