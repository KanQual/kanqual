import { createContext, useContext, useEffect, useRef, useState, type ReactNode, type SetStateAction } from "react";
import { listen } from "@tauri-apps/api/event";
import type { PostgresProjectChangeEvent } from "./postgres";

function estimatedBytes(value: unknown, limit: number) {
  let size = 0;
  const pending: unknown[] = [value];
  const seen = new WeakSet<object>();
  while (pending.length && size <= limit) {
    const item = pending.pop();
    if (typeof item === "string") { size += item.length * 2 + 16; continue; }
    if (item && typeof item === "object") {
      if (seen.has(item)) continue;
      seen.add(item); size += 32;
      for (const [key, child] of Object.entries(item)) { size += key.length * 2 + 16; pending.push(child); }
    } else size += 8;
  }
  return size;
}

// Session-local LRU. Large memo/report pages are deliberately not retained.
export class ListVisitCache {
  private pages = new Map<string, { value: unknown; size: number; expires: number }>();
  private preferences = new Map<string, unknown>();
  private bytes = 0;
  revision = 0;
  constructor(private maxBytes = 4 * 1024 * 1024, private maxEntries = 16, private ttl = 30_000) {}
  clear() { this.pages.clear(); this.bytes = 0; this.revision++; }
  read<T>(key: string): T | undefined {
    const entry = this.pages.get(key);
    if (!entry) return;
    this.pages.delete(key);
    if (entry.expires <= Date.now()) { this.bytes -= entry.size; return; }
    this.pages.set(key, entry);
    return entry.value as T;
  }
  write(key: string, value: unknown, revision = this.revision) {
    if (revision !== this.revision) return;
    const size = estimatedBytes(value, this.maxBytes);
    const previous = this.pages.get(key);
    if (previous) { this.bytes -= previous.size; this.pages.delete(key); }
    if (size > this.maxBytes) return;
    while (this.pages.size >= this.maxEntries || this.bytes + size > this.maxBytes) {
      const oldest = this.pages.keys().next().value!;
      this.bytes -= this.pages.get(oldest)!.size; this.pages.delete(oldest);
    }
    this.pages.set(key, { value, size, expires: Date.now() + this.ttl }); this.bytes += size;
  }
  preference<T>(key: string): T | undefined { return this.preferences.get(key) as T | undefined; }
  remember(key: string, value: unknown) {
    this.preferences.delete(key); this.preferences.set(key, value);
    if (this.preferences.size > 64) this.preferences.delete(this.preferences.keys().next().value!);
  }
}
const Context = createContext<ListVisitCache | null>(null);
export function ListVisitCacheProvider({ projectId, children }: { projectId: string; children: ReactNode }) {
  const [cache] = useState(() => new ListVisitCache());
  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | undefined;
    void listen<PostgresProjectChangeEvent>("postgres-project-changed", ({ payload }) => {
      if (payload.projectId === projectId) cache.clear();
    }).then(unlisten => { if (disposed) unlisten(); else stop = unlisten; }).catch(() => { cache.clear(); });
    return () => { disposed = true; stop?.(); cache.clear(); };
  }, [cache, projectId]);
  return <Context.Provider value={cache}>{children}</Context.Provider>;
}
export function useListVisitCache() {
  const shared = useContext(Context);
  const [local] = useState(() => new ListVisitCache());
  return shared ?? local;
}
export function useListPreference<T>(key: string, initial: T) {
  const cache = useListVisitCache();
  const [state, setState] = useState(() => ({ key, value: cache.preference<T>(key) ?? initial }));
  const value = state.key === key ? state.value : cache.preference<T>(key) ?? initial;
  const latest = useRef(value); latest.current = value;
  const setValue = (next: SetStateAction<T>) => {
    const resolved = typeof next === "function" ? (next as (value: T) => T)(latest.current) : next;
    latest.current = resolved; cache.remember(key, resolved); setState({ key, value: resolved });
  };
  return [value, setValue] as const;
}
