import { useListPreference, useListVisitCache } from "./listVisitCache";
import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { listPostgresTablePage, type PostgresProjectChangeEvent, type PostgresTablePage, type PostgresTablePageRequest } from "./postgres";

export function usePostgresTablePage<T>(projectId: string | undefined, options: Omit<PostgresTablePageRequest, "offset" | "selectedId">) {
  const cache = useListVisitCache();
  const viewKey = JSON.stringify(["table", projectId, options.entity, options.reportType]);
  const [searchInput, setSearchInput] = useListPreference(viewKey + ":search", "");
  const [query, setQuery] = useState(searchInput.trim());
  useEffect(() => { const timer = setTimeout(() => setQuery(searchInput.trim()), 200); return () => clearTimeout(timer); }, [searchInput]);
  options = { ...options, query };
  const scope = JSON.stringify([projectId, options]);
  const [position, setPosition] = useListPreference(viewKey + ":position", { scope, offset: 0 });
  const offset = position.scope === scope ? position.offset : 0;
  const [result, setResult] = useState<{ scope: string; page: PostgresTablePage<T> } | null>(() => cache.read(viewKey) ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const tableRef = useRef<HTMLDivElement>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const reload = useCallback(async (selectedId?: string) => {
    const token = ++generation.current;
    if (!projectId) return;
    const revision = cache.revision;
    const previous = cache.read<{scope: string; page: PostgresTablePage<T>}>(viewKey);
    setLoading(!previous || previous.scope !== scope || previous.page.offset !== offset); setError(null);
    try {
      const page = await listPostgresTablePage<T>(projectId, { ...optionsRef.current, offset, selectedId });
      // A save callback may still need its explicitly selected record if an
      // event-triggered refresh overtakes this list request.
      if (token !== generation.current) return selectedId ? page : undefined;
      cache.write(viewKey, { scope, page: { ...page, selected: null } }, revision);
      setResult({ scope, page });
      setPosition({ scope, offset: page.offset });
      return page;
    } catch (e) {
      if (token === generation.current) { cache.clear(); setResult(null); setError(e instanceof Error ? e.message : String(e)); }
    } finally {
      if (token === generation.current) setLoading(false);
    }
  }, [projectId, scope, offset]);
  useEffect(() => { void reload(); return () => { generation.current++; }; }, [reload]);
  useEffect(() => { if (tableRef.current) tableRef.current.scrollTop = 0; }, [scope, offset]);
  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void listen<PostgresProjectChangeEvent>("postgres-project-changed", ({ payload }) => {
      if (disposed || payload.projectId !== projectId) return;
      if (![optionsRef.current.entity === "memos" ? "memo" : "report", "project_user"].includes(payload.entityType)) return;
      clearTimeout(timer); timer = setTimeout(() => { void reload(); }, 100);
    }).then(unlisten => { if (disposed) unlisten(); else stop = unlisten; }).catch(() => {});
    return () => { disposed = true; clearTimeout(timer); stop?.(); };
  }, [projectId, reload]);
  const page = result?.scope === scope ? result.page : undefined;
  return { rows: page?.rows ?? [], counts: page?.counts ?? {}, loading, error, reload, tableRef,
    controls: { search: { value: searchInput, onChange: setSearchInput }, offset: page?.offset ?? offset, total: page?.total ?? 0, loading, onChange: (next: number) => setPosition({ scope, offset: next }) },
  };
}
