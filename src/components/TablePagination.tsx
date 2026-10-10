import { useListVisitCache } from "../lib/listVisitCache";
import { useEffect, useRef, useState } from "react";
import { SkipBackIcon, StepBackIcon, StepForwardIcon, SkipForwardIcon } from "./AppIcons";
import { useI18n } from "../i18n/provider";

export const TABLE_PAGE_SIZE = 50;

export function TablePagination({ offset, total, onChange, loading = false, search }: {
  offset: number; total: number; onChange: (offset: number) => void; loading?: boolean;
  search?: { value: string; onChange: (value: string) => void };
}) {
  const { t } = useI18n();
  const pages = Math.ceil(total / TABLE_PAGE_SIZE);
  const page = total ? Math.min(Math.floor(offset / TABLE_PAGE_SIZE) + 1, pages) : 0;
  const lastOffset = Math.max(0, (pages - 1) * TABLE_PAGE_SIZE);
  const controls = <div className="table-pagination" role="group" aria-label={t("pagination.label")}>
    <button type="button" className="table-pagination-button" disabled={loading || offset === 0 || total === 0} onClick={() => onChange(0)} aria-label={t("pagination.first")} title={t("pagination.first")}><SkipBackIcon /></button>
    <button type="button" className="table-pagination-button" disabled={loading || offset === 0 || total === 0} onClick={() => onChange(Math.max(0, offset - TABLE_PAGE_SIZE))} aria-label={t("pagination.previous")} title={t("pagination.previous")}><StepBackIcon /></button>
    <span className="table-pagination-counter" aria-live="polite" aria-atomic="true" aria-label={t("pagination.counter", { page, pages })}>{page} / {pages}</span>
    <button type="button" className="table-pagination-button" disabled={loading || offset >= lastOffset} onClick={() => onChange(Math.min(lastOffset, offset + TABLE_PAGE_SIZE))} aria-label={t("pagination.next")} title={t("pagination.next")}><StepForwardIcon /></button>
    <button type="button" className="table-pagination-button" disabled={loading || offset >= lastOffset} onClick={() => onChange(lastOffset)} aria-label={t("pagination.last")} title={t("pagination.last")}><SkipForwardIcon /></button>
  </div>;
  return search ? <div className="sources-list-toolbar">
    <input type="search" aria-label={t("projectCore.sources.detail.search")} placeholder={t("projectCore.sources.detail.search")} value={search.value} onChange={event => search.onChange(event.target.value)} />
    {controls}
  </div> : controls;
}

// For datasets also used by graphs, selectors, or bulk editors: page only the
// rendered rows, leaving the complete, filtered/sorted collection intact.
export function useTablePagination<T>(rows: readonly T[], scope: string, memoryKey?: string) {
  const cache = useListVisitCache();
  const [position, setPosition] = useState(() => (memoryKey ? cache.preference<{scope: string; offset: number}>(memoryKey) : undefined) ?? { scope, offset: 0 });
  const offset = Math.min(position.scope === scope ? position.offset : 0, Math.floor(Math.max(0, rows.length - 1) / TABLE_PAGE_SIZE) * TABLE_PAGE_SIZE);
  const tableRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setPosition(current => current.scope === scope && current.offset === offset ? current : { scope, offset });
    if (memoryKey) cache.remember(memoryKey, { scope, offset });
    if (tableRef.current) tableRef.current.scrollTop = 0;
  }, [scope, offset]);
  return { rows: rows.slice(offset, offset + TABLE_PAGE_SIZE), tableRef, controls: {
    offset, total: rows.length, onChange: (next: number) => setPosition({ scope, offset: next }),
  } };
}
