import type { UserProfile } from "@echoo/shared";
import type { PropsWithChildren } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { initApp } from "../bootstrap/initApp";
import type { AuthLinkParams } from "../../runtimes/contracts";
import { useRuntime } from "./RuntimeProvider";

type AuthMode = "login" | "register" | "forgot" | "reset" | "verify";

interface AuthContextValue {
  user: UserProfile | null;
  isLoading: boolean;
  authMode: AuthMode;
  authError: string | null;
  authLinkParams: AuthLinkParams;
  requireAuth: (mode?: AuthMode) => void;
  login: (input: { email: string; password: string }) => Promise<void>;
  register: (input: {
    email: string;
    password: string;
    displayName?: string;
  }) => Promise<{ verificationToken?: string }>;
  forgotPassword: (input: {
    email: string;
  }) => Promise<{ resetToken?: string }>;
  resetPassword: (input: { token: string; password: string }) => Promise<void>;
  verifyEmail: (input: { token: string }) => Promise<void>;
  signOut: () => Promise<void>;
  clearAuthLinkParams: (keys: Array<keyof AuthLinkParams>) => Promise<void>;
  setAuthMode: (mode: AuthMode) => void;
  clearAuthError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const runtime = useRuntime();
  const services = useMemo(() => initApp(runtime), [runtime]);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [authLinkParams, setAuthLinkParams] = useState<AuthLinkParams>({});
  const [isLoading, setIsLoading] = useState(true);
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      services.authService.loadCurrentUser(),
      runtime.link.getInitialAuthLinkParams(),
    ]).then(([currentUser, initialAuthLinkParams]) => {
      if (cancelled) return;
      setUser(currentUser);
      setAuthLinkParams(initialAuthLinkParams);
      setAuthMode(
        initialAuthLinkParams.verificationToken
          ? "verify"
          : initialAuthLinkParams.resetToken
            ? "reset"
            : "login",
      );
      setIsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [runtime.link, services]);

  const clearAuthLinkParams = useCallback(
    async (keys: Array<keyof AuthLinkParams>) => {
      await runtime.link.clearAuthLinkParams(keys);
      setAuthLinkParams((current) => {
        const next = { ...current };
        keys.forEach((key) => delete next[key]);
        return next;
      });
    },
    [runtime.link],
  );

  useEffect(() => {
    if (isLoading) return;
    if (authLinkParams.verificationToken) {
      setAuthMode("verify");
      return;
    }
    if (authLinkParams.resetToken) {
      setAuthMode("reset");
    }
  }, [authLinkParams.resetToken, authLinkParams.verificationToken, isLoading]);

  const runAuthAction = useCallback(async <T,>(action: () => Promise<T>) => {
    setAuthError(null);
    try {
      return await action();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "发生了意外错误。";
      setAuthError(message);
      throw error;
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isLoading,
      authMode,
      authError,
      authLinkParams,
      requireAuth: (mode = "login") => {
        setAuthMode(mode);
        setAuthError(null);
      },
      login: async (input) => {
        const nextUser = await runAuthAction(() =>
          services.authService.login(input),
        );
        setUser(nextUser);
      },
      register: (input) =>
        runAuthAction(() => services.authService.register(input)),
      forgotPassword: (input) =>
        runAuthAction(() => services.authService.forgotPassword(input)),
      resetPassword: async (input) => {
        await runAuthAction(() => services.authService.resetPassword(input));
        await clearAuthLinkParams(["resetToken"]);
        setAuthMode("login");
      },
      verifyEmail: async (input) => {
        await runAuthAction(() => services.authService.verifyEmail(input));
        await clearAuthLinkParams(["verificationToken"]);
        setAuthMode("login");
      },
      signOut: async () => {
        await services.authService.signOut();
        setUser(null);
        setAuthMode("login");
      },
      clearAuthLinkParams,
      setAuthMode: (mode) => {
        setAuthMode(mode);
        setAuthError(null);
      },
      clearAuthError: () => setAuthError(null),
    }),
    [
      authError,
      authLinkParams,
      authMode,
      clearAuthLinkParams,
      isLoading,
      runAuthAction,
      services.authService,
      user,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error("AuthProvider is missing");
  return auth;
}
