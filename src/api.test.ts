import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";

const user = { id: "test-user", email: "user@example.test", fullName: "Test" };
const session = { accessToken: "access-one", refreshToken: "refresh-one", expiresIn: 3600, user };
let storage: Map<string, string>;
let location: { search: string; hash: string; origin: string; assign: ReturnType<typeof vi.fn> };
let fetchMock: ReturnType<typeof vi.fn>;
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

beforeEach(() => {
  vi.resetModules();
  storage = new Map();
  location = { search: "", hash: "#/login", origin: "https://sanadapp.pro", assign: vi.fn() };
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("window", {
    location,
    sessionStorage: { getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key) },
    history: { replaceState: vi.fn() },
  });
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("browser authentication regressions", () => {
  it("opens login without a false OAuth error or consuming pending state", async () => {
    storage.set("sanad.oauth_state", "pending");
    const { authApi } = await import("./api");
    expect(await authApi.completeOAuthCallback()).toEqual({ session: null, profileExists: false });
    expect(storage.get("sanad.oauth_state")).toBe("pending");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a Google callback with mismatched state before exchanging the code", async () => {
    storage.set("sanad.oauth_state", "expected");
    location.search = "?code=abc&state=wrong";
    const { authApi } = await import("./api");
    await expect(authApi.completeOAuthCallback()).rejects.toThrow("فشل التحقق");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts matching Google state and stores the resulting session", async () => {
    storage.set("sanad.oauth_state", "expected");
    location.search = "?code=abc&state=expected";
    fetchMock.mockResolvedValueOnce(response({ session, profileExists: true }));
    const { authApi } = await import("./api");
    expect((await authApi.completeOAuthCallback()).session?.user.id).toBe(user.id);
    expect(storage.has("sanad.oauth_state")).toBe(false);
  });

  it("restores encrypted session after a fresh module load using a non-extractable key", async () => {
    fetchMock.mockResolvedValueOnce(response({ session }));
    const { authApi } = await import("./api");
    await authApi.signInWithPassword(user.email, "test-password");
    expect(storage.get("sanad.session")).not.toContain(session.accessToken);
    vi.resetModules(); // Simulate reload while preserving IndexedDB and sessionStorage.
    const key = await (await import("./sessionKey")).getSessionKey();
    expect(key.extractable).toBe(false);
    fetchMock.mockResolvedValueOnce(response({ user, profileExists: true }));
    const restored = await (await import("./api")).authApi.getSession();
    expect(restored.session?.accessToken).toBe(session.accessToken);
    expect(restored.profileExists).toBe(true);
  });

  it("refreshes an expired session only once for concurrent requests", async () => {
    fetchMock.mockResolvedValueOnce(response({ session: { ...session, expiresIn: -1 } }));
    const { authApi, apiGet } = await import("./api");
    await authApi.signInWithPassword(user.email, "test-password");
    fetchMock.mockImplementation(async (path: string, options: RequestInit) => {
      if (path === "/api/auth/refresh") return response({ session: { ...session, accessToken: "access-two", refreshToken: "refresh-two" } });
      expect(new Headers(options.headers).get("Authorization")).toBe("Bearer access-two");
      return response({ ok: true });
    });
    await Promise.all([apiGet("/api/workspace"), apiGet("/api/workspace")]);
    expect(fetchMock.mock.calls.filter(([path]) => path === "/api/auth/refresh")).toHaveLength(1);
  });

  it("preserves refresh credentials when updating user metadata", async () => {
    fetchMock.mockResolvedValueOnce(response({ session }));
    const { authApi } = await import("./api");
    await authApi.signInWithPassword(user.email, "test-password");
    fetchMock.mockResolvedValueOnce(response({ session: { accessToken: session.accessToken, user }, user }));
    await authApi.updateUserMetadata({ full_name: "Updated" });
    fetchMock.mockResolvedValueOnce(response({ user, profileExists: true }));
    expect((await authApi.getSession()).session?.refreshToken).toBe(session.refreshToken);
  });

  it("discards unreadable sessions from the old ephemeral-key version", async () => {
    storage.set("sanad.session", "old-ciphertext");
    const { authApi } = await import("./api");
    expect((await authApi.getSession()).session).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
