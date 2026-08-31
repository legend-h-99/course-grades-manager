/**
 * Tests for authentication use cases in auth.ts.
 * All port interactions are mocked; only business-rule validation is tested here.
 */
import { describe, expect, it, vi } from "vitest";
import {
  signInWithPassword,
  signUp,
  sendOtp,
  verifyOtp,
  resetPassword,
  updateRecoveredPassword,
  signOut,
} from "./auth";
import type { AuthPort, AuthResult } from "../ports";

// ── Helpers ──────────────────────────────────────────────────────────────────

const successResult: AuthResult = {
  session: {
    accessToken: "tok",
    user: { id: "u1", email: "test@example.com", fullName: "Test" },
  },
};

function makeAuthPort(overrides: Partial<AuthPort> = {}): AuthPort {
  return {
    getSession: vi.fn().mockResolvedValue({ session: null, profileExists: false }),
    completeOAuthCallback: vi.fn().mockResolvedValue({ session: null, profileExists: false }),
    signInWithGoogle: vi.fn(),
    signInWithPassword: vi.fn().mockResolvedValue(successResult),
    signUp: vi.fn().mockResolvedValue(successResult),
    resetPassword: vi.fn().mockResolvedValue(undefined),
    updatePassword: vi.fn().mockResolvedValue(successResult),
    sendOtp: vi.fn().mockResolvedValue(undefined),
    verifyOtp: vi.fn().mockResolvedValue(successResult),
    updateUserMetadata: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ── signInWithPassword ────────────────────────────────────────────────────────

describe("signInWithPassword", () => {
  it("throws when email is empty", async () => {
    const port = makeAuthPort();
    await expect(signInWithPassword(port, "", "password1")).rejects.toThrow(
      "البريد الإلكتروني مطلوب",
    );
    expect(port.signInWithPassword).not.toHaveBeenCalled();
  });

  it("throws when email is whitespace only", async () => {
    const port = makeAuthPort();
    await expect(signInWithPassword(port, "   ", "password1")).rejects.toThrow(
      "البريد الإلكتروني مطلوب",
    );
    expect(port.signInWithPassword).not.toHaveBeenCalled();
  });

  it("throws when password is empty", async () => {
    const port = makeAuthPort();
    await expect(signInWithPassword(port, "user@example.com", "")).rejects.toThrow(
      "كلمة المرور مطلوبة",
    );
    expect(port.signInWithPassword).not.toHaveBeenCalled();
  });

  it("passes trimmed, lowercased email to port", async () => {
    const port = makeAuthPort();
    await signInWithPassword(port, "  USER@Example.COM  ", "pass@word1");
    expect(port.signInWithPassword).toHaveBeenCalledWith("user@example.com", "pass@word1");
  });

  it("returns the AuthResult from the port", async () => {
    const port = makeAuthPort();
    const result = await signInWithPassword(port, "user@example.com", "pass@word1");
    expect(result).toEqual(successResult);
  });

  it("propagates port errors", async () => {
    const port = makeAuthPort({
      signInWithPassword: vi.fn().mockRejectedValue(new Error("invalid credentials")),
    });
    await expect(signInWithPassword(port, "user@example.com", "pass@word1")).rejects.toThrow(
      "invalid credentials",
    );
  });
});

// ── signUp ────────────────────────────────────────────────────────────────────

describe("signUp", () => {
  it("throws when email is empty", async () => {
    const port = makeAuthPort();
    await expect(signUp(port, "", "Password1!", "https://example.com")).rejects.toThrow(
      "أدخل بريدًا إلكترونيًا",
    );
    expect(port.signUp).not.toHaveBeenCalled();
  });

  it("throws when password is fewer than 8 characters", async () => {
    const port = makeAuthPort();
    await expect(signUp(port, "u@e.com", "Ab1!", "https://example.com")).rejects.toThrow(
      "8 أحرف",
    );
    expect(port.signUp).not.toHaveBeenCalled();
  });

  it("throws when password has no digit or special character", async () => {
    const port = makeAuthPort();
    await expect(signUp(port, "u@e.com", "AbCdEfGh", "https://example.com")).rejects.toThrow(
      "رقم أو رمز خاص",
    );
    expect(port.signUp).not.toHaveBeenCalled();
  });

  it("accepts a password with a digit", async () => {
    const port = makeAuthPort();
    await signUp(port, "u@e.com", "AbCdEfG1", "https://example.com");
    expect(port.signUp).toHaveBeenCalledOnce();
  });

  it("accepts a password with a special character", async () => {
    const port = makeAuthPort();
    await signUp(port, "u@e.com", "AbCdEfG@", "https://example.com");
    expect(port.signUp).toHaveBeenCalledOnce();
  });

  it("passes trimmed, lowercased email and redirectTo to port", async () => {
    const port = makeAuthPort();
    await signUp(port, "  USER@Example.COM  ", "Password1!", "https://app.com/auth");
    expect(port.signUp).toHaveBeenCalledWith(
      "user@example.com",
      "Password1!",
      "https://app.com/auth",
    );
  });

  it("propagates port errors", async () => {
    const port = makeAuthPort({
      signUp: vi.fn().mockRejectedValue(new Error("email already registered")),
    });
    await expect(signUp(port, "u@e.com", "Password1!", "https://example.com")).rejects.toThrow(
      "email already registered",
    );
  });
});

// ── sendOtp ───────────────────────────────────────────────────────────────────

describe("sendOtp", () => {
  it("throws when email is empty", async () => {
    const port = makeAuthPort();
    await expect(sendOtp(port, "")).rejects.toThrow("أدخل البريد الإلكتروني");
    expect(port.sendOtp).not.toHaveBeenCalled();
  });

  it("throws when email is whitespace only", async () => {
    const port = makeAuthPort();
    await expect(sendOtp(port, "   ")).rejects.toThrow("أدخل البريد الإلكتروني");
    expect(port.sendOtp).not.toHaveBeenCalled();
  });

  it("passes trimmed, lowercased email to port", async () => {
    const port = makeAuthPort();
    await sendOtp(port, "  Test@EXAMPLE.com  ");
    expect(port.sendOtp).toHaveBeenCalledWith("test@example.com");
  });

  it("propagates port errors", async () => {
    const port = makeAuthPort({
      sendOtp: vi.fn().mockRejectedValue(new Error("rate limited")),
    });
    await expect(sendOtp(port, "u@e.com")).rejects.toThrow("rate limited");
  });
});

// ── verifyOtp ─────────────────────────────────────────────────────────────────

describe("verifyOtp", () => {
  it("throws when token is fewer than 6 characters", async () => {
    const port = makeAuthPort();
    await expect(verifyOtp(port, "u@e.com", "12345")).rejects.toThrow("6 أرقام");
    expect(port.verifyOtp).not.toHaveBeenCalled();
  });

  it("throws when token is all whitespace", async () => {
    const port = makeAuthPort();
    await expect(verifyOtp(port, "u@e.com", "   ")).rejects.toThrow("6 أرقام");
    expect(port.verifyOtp).not.toHaveBeenCalled();
  });

  it("trims the token before validation", async () => {
    const port = makeAuthPort();
    await verifyOtp(port, "u@e.com", "  123456  ");
    expect(port.verifyOtp).toHaveBeenCalledWith("u@e.com", "123456");
  });

  it("passes trimmed, lowercased email and token to port", async () => {
    const port = makeAuthPort();
    await verifyOtp(port, "  USER@E.COM  ", "654321");
    expect(port.verifyOtp).toHaveBeenCalledWith("user@e.com", "654321");
  });

  it("returns the AuthResult from the port", async () => {
    const port = makeAuthPort();
    const result = await verifyOtp(port, "u@e.com", "123456");
    expect(result).toEqual(successResult);
  });

  it("propagates port errors", async () => {
    const port = makeAuthPort({
      verifyOtp: vi.fn().mockRejectedValue(new Error("expired token")),
    });
    await expect(verifyOtp(port, "u@e.com", "123456")).rejects.toThrow("expired token");
  });
});

// ── resetPassword ─────────────────────────────────────────────────────────────

describe("resetPassword", () => {
  it("throws when email is empty", async () => {
    const port = makeAuthPort();
    await expect(resetPassword(port, "", "https://example.com")).rejects.toThrow(
      "أدخل البريد الإلكتروني",
    );
    expect(port.resetPassword).not.toHaveBeenCalled();
  });

  it("throws when email is whitespace only", async () => {
    const port = makeAuthPort();
    await expect(resetPassword(port, "   ", "https://example.com")).rejects.toThrow(
      "أدخل البريد الإلكتروني",
    );
    expect(port.resetPassword).not.toHaveBeenCalled();
  });

  it("passes trimmed, lowercased email and redirectTo to port", async () => {
    const port = makeAuthPort();
    await resetPassword(port, "  ADMIN@Example.com  ", "https://app.com/reset");
    expect(port.resetPassword).toHaveBeenCalledWith(
      "admin@example.com",
      "https://app.com/reset",
    );
  });

  it("propagates port errors", async () => {
    const port = makeAuthPort({
      resetPassword: vi.fn().mockRejectedValue(new Error("not found")),
    });
    await expect(resetPassword(port, "u@e.com", "https://example.com")).rejects.toThrow(
      "not found",
    );
  });
});

// ── updateRecoveredPassword ───────────────────────────────────────────────────

describe("updateRecoveredPassword", () => {
  it("throws when password is fewer than 8 characters", async () => {
    const port = makeAuthPort();
    await expect(updateRecoveredPassword(port, "Ab1!")).rejects.toThrow("8 أحرف");
    expect(port.updatePassword).not.toHaveBeenCalled();
  });

  it("throws when password has no digit or special character", async () => {
    const port = makeAuthPort();
    await expect(updateRecoveredPassword(port, "AbCdEfGh")).rejects.toThrow("رقم أو رمز خاص");
    expect(port.updatePassword).not.toHaveBeenCalled();
  });

  it("delegates to port.updatePassword on valid input", async () => {
    const port = makeAuthPort();
    await updateRecoveredPassword(port, "NewPass1@");
    expect(port.updatePassword).toHaveBeenCalledWith("NewPass1@");
  });

  it("returns the AuthResult from port.updatePassword", async () => {
    const port = makeAuthPort();
    const result = await updateRecoveredPassword(port, "NewPass1@");
    expect(result).toEqual(successResult);
  });

  it("propagates port errors", async () => {
    const port = makeAuthPort({
      updatePassword: vi.fn().mockRejectedValue(new Error("session expired")),
    });
    await expect(updateRecoveredPassword(port, "NewPass1@")).rejects.toThrow("session expired");
  });
});

// ── signOut ───────────────────────────────────────────────────────────────────

describe("signOut", () => {
  it("delegates to port.signOut", async () => {
    const port = makeAuthPort();
    await signOut(port);
    expect(port.signOut).toHaveBeenCalledOnce();
  });

  it("propagates port errors", async () => {
    const port = makeAuthPort({
      signOut: vi.fn().mockRejectedValue(new Error("network error")),
    });
    await expect(signOut(port)).rejects.toThrow("network error");
  });
});
