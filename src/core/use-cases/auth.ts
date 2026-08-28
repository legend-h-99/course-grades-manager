/**
 * Authentication use cases — validation-first wrappers around AuthPort.
 * Business rules (minimum password length, required fields) live here.
 * Zero knowledge of HTTP, cookies, or browser APIs.
 */

import type { AuthPort, AuthResult } from "../ports";

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
  if (!email.trim() || password.length < 6) {
    throw new Error("أدخل بريدًا صحيحًا وكلمة مرور من 6 أحرف على الأقل.");
  }
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
  if (password.length < 6) {
    throw new Error("أدخل كلمة مرور جديدة من 6 أحرف على الأقل.");
  }
  return port.updatePassword(password);
}

export function signOut(port: AuthPort): Promise<void> {
  return port.signOut();
}
