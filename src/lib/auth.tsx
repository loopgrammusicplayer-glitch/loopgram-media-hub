import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Auth, User } from "firebase/auth";
import { getFirebaseConfig, getMe } from "./api.functions";

type Role = "owner" | "user";
type Ctx = {
  auth: Auth | null;
  user: User | null;
  role: Role | null;
  loading: boolean;
  configError: string | null;
  token: () => Promise<string>;
};
const AuthCtx = createContext<Ctx | null>(null);

let authPromise: Promise<Auth> | null = null;
export function loadAuth() {
  if (!authPromise) {
    authPromise = (async () => {
      const cfg = await getFirebaseConfig();
      if (!cfg.apiKey) throw new Error("Firebase API key is not configured.");
      const { initializeApp, getApps } = await import("firebase/app");
      const { getAuth } = await import("firebase/auth");
      const app = getApps()[0] ?? initializeApp(cfg);
      return getAuth(app);
    })().catch((error) => {
      authPromise = null;
      throw error;
    });
  }
  return authPromise;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Omit<Ctx, "token">>({
    auth: null, user: null, role: null, loading: true, configError: null,
  });
  useEffect(() => {
    let unsub = () => {};
    loadAuth()
      .then(async (auth) => {
        const { onIdTokenChanged } = await import("firebase/auth");
        unsub = onIdTokenChanged(auth, async (user) => {
          if (!user) return setState({ auth, user: null, role: null, loading: false, configError: null });
          setState((s) => ({ ...s, auth, user, loading: true }));
          try {
            const me = await getMe({ data: { token: await user.getIdToken() } });
            setState({ auth, user, role: me.role, loading: false, configError: null });
          } catch {
            setState({ auth, user, role: null, loading: false, configError: null });
          }
        });
      })
      .catch((e) => setState((s) => ({ ...s, loading: false, configError: e.message })));
    return () => unsub();
  }, []);
  const token = async () => {
    if (!state.user) throw new Error("Not signed in");
    return state.user.getIdToken();
  };
  return <AuthCtx.Provider value={{ ...state, token }}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => {
  const c = useContext(AuthCtx);
  // Fallback (e.g. during hot reload or error screens): treat as signed out instead of crashing.
  return c ?? { auth: null, user: null, role: null, loading: true, configError: null, token: async () => { throw new Error("Not signed in"); } };
};

export function authError(code: string) {
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
    case "auth/invalid-email":
      return "Incorrect email or password.";
    case "auth/user-disabled":
      return "This account has been disabled. Contact support.";
    case "auth/too-many-requests":
      return "Too many attempts. Please wait and try again.";
    case "auth/network-request-failed":
      return "Network problem. Check your connection.";
    case "auth/email-already-in-use":
      return "An account with this email already exists.";
    case "auth/weak-password":
      return "Password must be at least 6 characters.";
    default:
      return "Something went wrong. Please try again.";
  }
}
