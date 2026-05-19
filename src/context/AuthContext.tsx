import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";
import {
  waitForPb,
  ensureSetup,
  registerUserAccount,
  startLocalPocketBase,
  stopLocalPocketBase,
} from "../lib/pb";
import { clearRecentProjects, readAppSettings } from "../lib/appSettings";
import { clearLocalAccounts, clearRemoteSessions, LOCAL_PB_URL } from "../lib/authHistory";

type AuthStatus = "loading" | "ready" | "authenticated";
const LAST_SERVER_URL_KEY = "kq_last_server_url";
const REMOTE_CONNECT_TIMEOUT_MS = 7000;
const REMOTE_TEST_TIMEOUT_MS = 5000;
const REMOTE_AUTO_RECONNECT_TIMEOUT_MS = 3000;

interface AuthContextValue {
  pb: PocketBase | null;
  user: RecordModel | null;
  status: AuthStatus;
  serverUrl: string;
  useLocalServer: () => Promise<void>;
  useRemoteServer: (url: string) => Promise<void>;
  testRemoteServer: (url: string) => Promise<string>;
  returnToModeSelection: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  updateProfile: (data: { name: string; email: string }) => Promise<void>;
  changePassword: (data: { currentPassword: string; newPassword: string }) => Promise<void>;
  logout: () => void;
  error: string | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [pb, setPb] = useState<PocketBase | null>(null);
  const [user, setUser] = useState<RecordModel | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [serverUrl, setServerUrlState] = useState(LOCAL_PB_URL);
  const [error, setError] = useState<string | null>(null);
  const authUnsubscribeRef = useRef<(() => void) | null>(null);

  const bindAuthStore = useCallback((instance: PocketBase) => {
    authUnsubscribeRef.current?.();
    authUnsubscribeRef.current = instance.authStore.onChange((token, record) => {
      if (!token) {
        setUser(null);
        setStatus("ready");
        return;
      }
      if (record) {
        setUser(record);
      }
    });
  }, []);

  const normalizeServerUrl = useCallback((url: string) => {
    const trimmed = url.trim().replace(/\/+$/, "");
    if (!trimmed) return LOCAL_PB_URL;
    return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  }, []);

  const activateServer = useCallback(
    async (
      nextUrl: string,
      options?: {
        ensureLocalSetup?: boolean;
        stopLocalBeforeConnect?: boolean;
        allowAutoLogin?: boolean;
        waitTimeoutMs?: number;
      },
    ) => {
      const normalizedUrl = normalizeServerUrl(nextUrl);
      if (options?.stopLocalBeforeConnect && normalizedUrl !== LOCAL_PB_URL) {
        await stopLocalPocketBase().catch(() => undefined);
      }

      const resolvedUrl = normalizedUrl === LOCAL_PB_URL
        ? await startLocalPocketBase()
        : normalizedUrl;
      const instance = await waitForPb(resolvedUrl, options?.waitTimeoutMs);

      if (resolvedUrl === LOCAL_PB_URL && options?.ensureLocalSetup) {
        await ensureSetup(instance);
      }

      const settings = readAppSettings();
      let nextUser: RecordModel | null = null;
      let nextStatus: AuthStatus = "ready";

      if (instance.authStore.isValid && options?.allowAutoLogin && settings.startup.autoLoginLastUser) {
        try {
          await instance.collection("users").authRefresh();
          nextUser = instance.authStore.record;
          nextStatus = "authenticated";
        } catch {
          instance.authStore.clear();
          nextStatus = "ready";
        }
      } else if (instance.authStore.isValid && !settings.startup.autoLoginLastUser) {
        instance.authStore.clear();
      }

      setPb(instance);
      setUser(nextUser);
      setStatus(nextStatus);
      setError(null);
      setServerUrlState(resolvedUrl);
      bindAuthStore(instance);

      try {
        localStorage.setItem(LAST_SERVER_URL_KEY, resolvedUrl);
      } catch {
        // Convenience only.
      }
    },
    [bindAuthStore, normalizeServerUrl],
  );

  // Boot without starting local PocketBase automatically. If auto-login is enabled
  // and the last session was remote, try to reconnect to that remote server.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const settings = readAppSettings();
        let lastServerUrl: string | null = null;
        try {
          lastServerUrl = localStorage.getItem(LAST_SERVER_URL_KEY);
        } catch {
          lastServerUrl = null;
        }

        if (
          settings.startup.autoLoginLastUser
          && lastServerUrl
          && lastServerUrl !== LOCAL_PB_URL
        ) {
          try {
            await activateServer(lastServerUrl, {
              allowAutoLogin: true,
              stopLocalBeforeConnect: true,
              waitTimeoutMs: REMOTE_AUTO_RECONNECT_TIMEOUT_MS,
            });
            return;
          } catch {
            // Fall through to normal ready state.
          }
        }
        if (!cancelled) {
          setStatus("ready");
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setStatus("ready");
        }
      }
    })();
    return () => {
      cancelled = true;
      authUnsubscribeRef.current?.();
      authUnsubscribeRef.current = null;
    };
  }, [activateServer]);

  const useLocalServer = useCallback(async () => {
    setStatus("loading");
    try {
      await activateServer(LOCAL_PB_URL, { ensureLocalSetup: true, allowAutoLogin: true });
    } catch (error) {
      setStatus("ready");
      throw error;
    }
  }, [activateServer]);

  const useRemoteServer = useCallback(async (url: string) => {
    setStatus("loading");
    try {
      await activateServer(url, {
        allowAutoLogin: true,
        stopLocalBeforeConnect: true,
        waitTimeoutMs: REMOTE_CONNECT_TIMEOUT_MS,
      });
    } catch (error) {
      setStatus("ready");
      throw error;
    }
  }, [activateServer]);

  const testRemoteServer = useCallback(async (url: string) => {
    const normalizedUrl = normalizeServerUrl(url);
    if (normalizedUrl === LOCAL_PB_URL) {
      throw new Error("Enter a remote host address to test the connection.");
    }
    await waitForPb(normalizedUrl, REMOTE_TEST_TIMEOUT_MS);
    return normalizedUrl;
  }, [normalizeServerUrl]);

  const returnToModeSelection = useCallback(async () => {
    pb?.authStore.clear();
    authUnsubscribeRef.current?.();
    authUnsubscribeRef.current = null;

    if (serverUrl === LOCAL_PB_URL) {
      await stopLocalPocketBase().catch(() => undefined);
    }

    setPb(null);
    setUser(null);
    setStatus("ready");
    setError(null);
    setServerUrlState(LOCAL_PB_URL);
  }, [pb, serverUrl]);

  const login = useCallback(
    async (email: string, password: string) => {
      if (!pb) throw new Error("Choose a local or remote workspace before signing in.");
      setError(null);
      try {
        const result = await pb.collection("users").authWithPassword(email, password);
        setUser(result.record);
        setStatus("authenticated");
        try {
          localStorage.setItem(LAST_SERVER_URL_KEY, serverUrl);
        } catch {
          // Convenience only.
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Login failed";
        setError(msg);
        throw e;
      }
    },
    [pb, serverUrl]
  );

  const register = useCallback(
    async (name: string, email: string, password: string) => {
      if (!pb) throw new Error("Choose local device work before creating a local account.");
      setError(null);
      try {
        if (serverUrl === LOCAL_PB_URL) {
          // Local registrations use the native (trusted) command which performs
          // the registration using an internal superuser on the host.
          await registerUserAccount({
            name,
            email,
            password,
            passwordConfirm: password,
          });
        } else {
          // Remote registrations should be performed via the PocketBase client
          // so that web/remote clients can create accounts directly on the
          // remote server instead of invoking local native commands.
          await pb.collection("users").create({
            name,
            email,
            password,
            passwordConfirm: password,
            emailVisibility: true,
          });
        }
        await pb.collection("users").authWithPassword(email, password);
        setUser(pb.authStore.record);
        setStatus("authenticated");
        try {
          localStorage.setItem(LAST_SERVER_URL_KEY, serverUrl);
        } catch {
          // Convenience only.
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Registration failed";
        setError(msg);
        throw e;
      }
    },
    [pb, serverUrl]
  );

  const updateProfile = useCallback(
    async (data: { name: string; email: string }) => {
      if (!pb || !user) return;
      const record = await pb.collection("users").update(user.id, data);
      pb.authStore.save(pb.authStore.token, record);
      setUser(record);
    },
    [pb, user]
  );

  const changePassword = useCallback(
    async (data: { currentPassword: string; newPassword: string }) => {
      if (!pb || !user) return;
      const record = await pb.collection("users").update(user.id, {
        oldPassword: data.currentPassword,
        password: data.newPassword,
        passwordConfirm: data.newPassword,
        must_change_password: false,
      });
      pb.authStore.save(pb.authStore.token, record);
      setUser(record);
    },
    [pb, user]
  );

  const logout = useCallback(() => {
    const settings = readAppSettings();
    if (settings.privacy.clearRecentProjectsOnSignOut) {
      clearRecentProjects();
    }
    if (settings.privacy.forgetLoginIdentitiesOnLogout) {
      clearLocalAccounts();
      clearRemoteSessions();
    }
    pb?.authStore.clear();
    setUser(null);
    setStatus("ready");
  }, [pb]);

  return (
    <AuthContext.Provider
      value={{
        pb,
        user,
        status,
        serverUrl,
        useLocalServer,
        useRemoteServer,
        testRemoteServer,
        returnToModeSelection,
        login,
        register,
        updateProfile,
        changePassword,
        logout,
        error,
      }}
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
