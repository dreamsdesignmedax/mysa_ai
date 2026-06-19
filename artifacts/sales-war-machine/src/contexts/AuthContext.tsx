import { createContext, useContext } from "react";

export interface AuthUser {
  email: string;
}

export const AuthContext = createContext<AuthUser | null>(null);

export function useAuthUser(): AuthUser | null {
  return useContext(AuthContext);
}

export const ADMIN_EMAIL = "dreamsdesign.in@gmail.com";

export function useIsAdmin(): boolean {
  const user = useAuthUser();
  return user?.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase();
}
