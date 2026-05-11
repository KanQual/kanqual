export interface AccountHistory {
  email: string;
  name: string;
  lastLogin: string;
}

export interface RemoteSession {
  serverUrl: string;
  email: string;
  name: string;
  lastLogin: string;
}

export const LOCAL_ACCOUNTS_KEY = "mc_local_accounts";
export const REMOTE_SESSIONS_KEY = "mc_remote_sessions";
export const LOCAL_PB_URL = "http://127.0.0.1:8090";

export function getLocalAccounts(): AccountHistory[] {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_ACCOUNTS_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function saveLocalAccount(email: string, name: string): void {
  const list = getLocalAccounts().filter((account) => account.email !== email);
  list.unshift({ email, name, lastLogin: new Date().toISOString() });
  localStorage.setItem(LOCAL_ACCOUNTS_KEY, JSON.stringify(list.slice(0, 20)));
}

export function clearLocalAccounts(): void {
  localStorage.removeItem(LOCAL_ACCOUNTS_KEY);
}

export function getRemoteSessions(): RemoteSession[] {
  try {
    return JSON.parse(localStorage.getItem(REMOTE_SESSIONS_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function saveRemoteSession(serverUrl: string, email: string, name: string): void {
  const list = getRemoteSessions().filter(
    (session) => !(session.serverUrl === serverUrl && session.email === email),
  );
  list.unshift({ serverUrl, email, name, lastLogin: new Date().toISOString() });
  localStorage.setItem(REMOTE_SESSIONS_KEY, JSON.stringify(list.slice(0, 20)));
}

export function clearRemoteSessions(): void {
  localStorage.removeItem(REMOTE_SESSIONS_KEY);
}
