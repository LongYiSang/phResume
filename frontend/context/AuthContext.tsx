"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useCallback,
  useRef,
  useState,
  type ReactNode,
} from "react";

type AuthContextValue = {
  accessToken: string | null;
  setAccessToken: (token: string | null) => void;
  mustChangePassword: boolean;
  setMustChangePassword: (value: boolean) => void;
  isAuthenticated: boolean;
  isCheckingAuth: boolean;
  refreshAccessToken: () => Promise<string | null>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

type AuthProviderProps = {
  children: ReactNode;
};

export function AuthProvider({ children }: AuthProviderProps) {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const isMountedRef = useRef(true);
  const refreshPromiseRef = useRef<Promise<string | null> | null>(null);

  const refreshAccessToken = useCallback(async () => {
    if (refreshPromiseRef.current) {
      return refreshPromiseRef.current;
    }

    refreshPromiseRef.current = (async () => {
      try {
        const { API_ROUTES } = await import("@/lib/api-routes");
        const response = await fetch(API_ROUTES.AUTH.refresh(), {
          method: "POST",
          credentials: "include",
        });

        if (!response.ok) {
          setAccessToken(null);
          setMustChangePassword(false);
          return null;
        }

        const data = (await response.json()) as {
          access_token?: string;
          must_change_password?: boolean;
        };
        const token =
          typeof data?.access_token === "string" ? data.access_token : null;
        setAccessToken(token);
        setMustChangePassword(Boolean(data?.must_change_password));
        return token;
      } catch {
        setAccessToken(null);
        setMustChangePassword(false);
        return null;
      } finally {
        if (isMountedRef.current) {
          setIsCheckingAuth(false);
        }
        refreshPromiseRef.current = null;
      }
    })();

    return refreshPromiseRef.current;
  }, []);

  useEffect(() => {
    refreshAccessToken();
    return () => {
      isMountedRef.current = false;
    };
  }, [refreshAccessToken]);

  const value = useMemo<AuthContextValue>(
    () => ({
      accessToken,
      setAccessToken,
      mustChangePassword,
      setMustChangePassword,
      isAuthenticated: accessToken !== null,
      isCheckingAuth,
      refreshAccessToken,
    }),
    [accessToken, mustChangePassword, isCheckingAuth, refreshAccessToken],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (context === undefined) {
    throw new Error("useAuth 必须在 AuthProvider 中使用");
  }

  return context;
}
