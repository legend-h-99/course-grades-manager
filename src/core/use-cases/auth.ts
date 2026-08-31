/**
 * Authentication use cases — validation-first wrappers around AuthPort.
 * Business rules (minimum password length, required fields) live here.
 * Zero knowledge of HTTP, cookies, or browser APIs.
 */

import type { AuthPort, AuthResult } from "../ports";

/** Minimum 8 chars + at least one digit or special character. */
function validatePassword(password: string) {
  if (password.length < 8) throw new Error("كلمة المرور يجب أن تكون 8 أحرف على الأقل.");
  if (!/[\d!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)) {
    throw new Error("كلمة المرور يجب أن تحتوي على رقم أو رمز خاص على الأقل (مثل: 1، @، #، !).");
  }
}

export async function signInWithPassword(
  port: AuthPort,
  email: string,
  password: string,
): Promise<AuthResult> {
  if (!email.trim()) throw new Error("البريد الإلكتروني مطلوب.");
  if (!password) throw new Error("كلمة المرور مطلوبة.");
  return port.signInWithPassword(email.trim().toLowerCase(), password);
}

export async function signUp(
  port: AuthPort,
  email: string,
  password: string,
  redirectTo: string,
): Promise<AuthResult> {
  if (!email.trim()) throw new Error("أدخل بريدًا إلكترونيًا صحيحًا.");
  validatePassword(password);
  return port.signUp(email.trim().toLowerCase(), password, redirectTo);
}

export async function sendOtp(port: AuthPort, email: string): Promise<void> {
  if (!email.trim()) throw new Error("أدخل البريد الإلكتروني أولاً.");
  return port.sendOtp(email.trim().toLowerCase());
}

export async function verifyOtp(
  port: AuthPort,
  email: string,
  rawCode: string,
): Promise<AuthResult> {
  const token = rawCode.trim();
  if (token.length < 6) throw new Error("أدخل رمز التحقق المكون من 6 أرقام.");
  return port.verifyOtp(email.trim().toLowerCase(), token);
}

export async function resetPassword(
  port: AuthPort,
  email: string,
  redirectTo: string,
): Promise<void> {
  if (!email.trim()) {
    throw new Error("أدخل البريد الإلكتروني أولًا لإرسال رابط إعادة الضبط.");
  }
  return port.resetPassword(email.trim().toLowerCase(), redirectTo);
}

export async function updateRecoveredPassword(
  port: AuthPort,
  password: string,
): Promise<AuthResult> {
  validatePassword(password);
  return port.updatePassword(password);
}

export function signOut(port: AuthPort): Promise<void> {
  return port.signOut();
}
