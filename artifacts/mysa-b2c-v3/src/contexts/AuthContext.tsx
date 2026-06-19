import { createContext, useContext } from "react";

export interface AuthUser {
  id: number;
  email: string;
  firstName: string | null;
  lastName: string | null;
  orgId: number;
  role: string;
  phone?: string | null;
  phoneVerified?: boolean;
  isVerified?: boolean;
  pendingEmail?: string | null;
  pendingEmailTokenExpiresAt?: string | null;
  hasPassword?: boolean;
  businessWhy?: string | null;
  onboardingCompleted?: boolean;
}

/**
 * Returns true when the user can access the platform.
 * - Real email users: only need email verified (phone is optional).
 * - Phone-OTP users (synthetic email): must add + verify a real email first.
 */
export function isFullyVerified(user: AuthUser | null): boolean {
  if (!user) return false;
  const synthetic = user.email?.endsWith("@otp.mysa.internal");
  if (synthetic) return false; // phone users must add a real email before getting access
  return !!(user.isVerified);
}

interface AuthContextValue {
  user: AuthUser | null;
  refreshUser: () => Promise<void>;
  updateUser: (partial: Partial<AuthUser>) => void;
}

const noop = async () => {};
const noopUpdate = () => {};

export const AuthContext = createContext<AuthContextValue>({
  user: null,
  refreshUser: noop,
  updateUser: noopUpdate,
});

export function useAuthUser(): AuthUser | null {
  return useContext(AuthContext).user;
}

export function useRefreshUser(): () => Promise<void> {
  return useContext(AuthContext).refreshUser;
}

export function useUpdateUser(): (partial: Partial<AuthUser>) => void {
  return useContext(AuthContext).updateUser;
}

export const ADMIN_EMAIL = "dreamsdesign.in@gmail.com";

export function useIsAdmin(): boolean {
  const user = useAuthUser();
  return user?.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase();
}

export function getUserInitials(user: AuthUser | null): string {
  if (!user) return "?";
  const first = user.firstName?.trim();
  const last = user.lastName?.trim();
  if (first && last) return `${first[0]}${last[0]}`.toUpperCase();
  if (first) return first.slice(0, 2).toUpperCase();
  if (user.email) return user.email.slice(0, 2).toUpperCase();
  return "?";
}
