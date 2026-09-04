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
export const POSTGRES_ACCOUNTS_KEY = "kq_postgres_experiment_accounts";

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

export function getPostgresAccounts(): AccountHistory[] {
  try {
    return JSON.parse(localStorage.getItem(POSTGRES_ACCOUNTS_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function savePostgresAccount(email: string, name: string): void {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return;
  const list = getPostgresAccounts().filter((account) => account.email !== normalizedEmail);
  list.unshift({ email: normalizedEmail, name, lastLogin: new Date().toISOString() });
  localStorage.setItem(POSTGRES_ACCOUNTS_KEY, JSON.stringify(list.slice(0, 20)));
}

export function updatePostgresAccount(previousEmail: string, nextEmail: string, nextName: string): void {
  const normalizedPreviousEmail = previousEmail.trim().toLowerCase();
  const normalizedNextEmail = nextEmail.trim().toLowerCase();
  if (!normalizedNextEmail) return;
  const list = getPostgresAccounts().filter(
    (account) => account.email !== normalizedPreviousEmail && account.email !== normalizedNextEmail,
  );
  list.unshift({ email: normalizedNextEmail, name: nextName, lastLogin: new Date().toISOString() });
  localStorage.setItem(POSTGRES_ACCOUNTS_KEY, JSON.stringify(list.slice(0, 20)));
}

export function clearPostgresAccounts(): void {
  localStorage.removeItem(POSTGRES_ACCOUNTS_KEY);
}
