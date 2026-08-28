/**
 * Browser implementation of AuthPort.
 * Wraps authApi (which owns session storage and HTTP) so that
 * core use cases never see sessionStorage, fetch, or URL params.
 */

import { authApi } from "../api";
import type { AuthPort, AuthResult, AuthUser, StoredSession } from "../core/ports";

export class AuthGateway implements AuthPort {
  getSession(): Promise<{ session: StoredSession | null; profileExists: boolean }> {
    return authApi.getSession() as Promise<{ session: StoredSession | null; profileExists: boolean }>;
  }

  completeOAuthCallback(): Promise<{ session: StoredSession | null; profileExists: boolean }> {
    return authApi.completeOAuthCallback() as Promise<{ session: StoredSession | null; profileExists: boolean }>;
  }

  signInWithGoogle(): void {
    authApi.signInWithGoogle();
  }

  signInWithPassword(email: string, password: string): Promise<AuthResult> {
    return authApi.signInWithPassword(email, password) as Promise<AuthResult>;
  }

  signUp(email: string, password: string, redirectTo: string): Promise<AuthResult> {
    return authApi.signUp(email, password, redirectTo) as Promise<AuthResult>;
  }

  resetPassword(email: string, redirectTo: string): Promise<void> {
    return authApi.resetPassword(email, redirectTo).then(() => undefined);
  }

  updatePassword(password: string): Promise<AuthResult> {
    return authApi.updatePassword(password) as Promise<AuthResult>;
  }

  sendOtp(email: string): Promise<void> {
    return authApi.sendOtp(email).then(() => undefined);
  }

  verifyOtp(email: string, token: string): Promise<AuthResult> {
    return authApi.verifyOtp(email, token) as Promise<AuthResult>;
  }

  updateUserMetadata(data: Record<string, unknown>): Promise<AuthUser | undefined> {
    return authApi.updateUserMetadata(data) as Promise<AuthUser | undefined>;
  }

  signOut(): Promise<void> {
    return authApi.signOut();
  }
}
