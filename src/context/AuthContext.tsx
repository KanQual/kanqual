import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";
import { waitForPb, ensureSetup } from "../lib/pb";

type AuthStatus = "loading" | "ready" | "authenticated";

interface AuthContextValue {
  pb: PocketBase | null;
  user: RecordModel | null;
  status: AuthStatus;
  serverUrl: string;
  setServerUrl: (url: string) => void;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => void;
  error: string | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [pb, setPb] = useState<PocketBase | null>(null);
  const [user, setUser] = useState<RecordModel | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [serverUrl, setServerUrl] = useState("http://127.0.0.1:8090");
  const [error, setError] = useState<string | null>(null);

  // Boot: wait for PocketBase, run first-time setup, restore session
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const instance = await waitForPb();
        if (cancelled) return;

        await ensureSetup(instance);
        if (cancelled) return;

        // Restore persisted auth token if valid
        if (instance.authStore.isValid) {
          try {
            await instance.collection("users").authRefresh();
            setUser(instance.authStore.record);
            setStatus("authenticated");
          } catch {
            instance.authStore.clear();
            setStatus("ready");
          }
        } else {
          setStatus("ready");
        }

        setPb(instance);

        // Clear user on logout; do not overwrite on auth changes (login sets it explicitly)
        instance.authStore.onChange((token) => {
          if (!token) setUser(null);
        });
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setStatus("ready");
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      if (!pb) return;
      setError(null);
      try {
        const result = await pb.collection("users").authWithPassword(email, password);
        setUser(result.record);
        setStatus("authenticated");
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Login failed";
        setError(msg);
        throw e;
      }
    },
    [pb]
  );

  const register = useCallback(
    async (name: string, email: string, password: string) => {
      if (!pb) return;
      setError(null);
      try {
        await pb.collection("users").create({
          name,
          email,
          emailVisibility: true,
          password,
          passwordConfirm: password,
        });
        await pb.collection("users").authWithPassword(email, password);
        setUser(pb.authStore.record);
        setStatus("authenticated");
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Registration failed";
        setError(msg);
        throw e;
      }
    },
    [pb]
  );

  const logout = useCallback(() => {
    pb?.authStore.clear();
    setUser(null);
    setStatus("ready");
  }, [pb]);

  return (
    <AuthContext.Provider
      value={{ pb, user, status, serverUrl, setServerUrl, login, register, logout, error }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
