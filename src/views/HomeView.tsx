import { useState, useEffect } from "react";
import { useStore } from "../context/StoreContext";
import type { View } from "../types";

interface RemoteStats {
  memberCount: number;
  membersByRole: Record<string, number>;
  caseCount: number;
  annotationCount: number;
  reportCount: number;
}

function StatCard({
  title,
  count,
  stats,
  onClick,
}: {
  title: string;
  count: number | null;
  stats: { label: string; value: string | number }[];
  onClick: () => void;
}) {
  return (
    <div className="home-stat-card" onClick={onClick}>
      <div className="home-stat-title">{title}</div>
      <div className="home-stat-count">{count ?? "—"}</div>
      <div className="home-stat-details">
        {stats.map((s) => (
          <div key={s.label} className="home-stat-row">
            <span className="home-stat-label">{s.label}</span>
            <span className="home-stat-value">{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function HomeView() {
  const { pb, activeProject, documents, codes, memos, setView } = useStore();
  const [remote, setRemote] = useState<RemoteStats | null>(null);

  useEffect(() => {
    if (!activeProject) return;
    const pid = activeProject.id;
    let cancelled = false;

    async function load() {
      const [members, casesRes, reportsRes, annRes] = await Promise.all([
        pb.collection("project_members").getFullList({ filter: `project="${pid}"` }),
        pb.collection("cases").getList(1, 1, { filter: `project="${pid}"&&deleted_at=""` }),
        pb.collection("code_reports").getList(1, 1, { filter: `project="${pid}"&&deleted_at=""` }),
        pb.collection("annotations").getList(1, 1, { filter: `document.project="${pid}"&&deleted_at=""` }),
      ]);
      if (cancelled) return;
      const membersByRole: Record<string, number> = {};
      members.forEach((m) => { membersByRole[m.role] = (membersByRole[m.role] || 0) + 1; });
      setRemote({
        memberCount: members.length,
        membersByRole,
        caseCount: casesRes.totalItems,
        annotationCount: annRes.totalItems,
        reportCount: reportsRes.totalItems,
      });
    }

    load().catch(console.error);
    return () => { cancelled = true; };
  }, [pb, activeProject]);

  const docCount = documents.length;
  const totalWords = documents.reduce(
    (sum, d) => sum + (d.content.trim() ? d.content.trim().split(/\s+/).length : 0),
    0
  );
  const avgWords = docCount > 0 ? Math.round(totalWords / docCount) : 0;

  const codeCount = codes.length;
  const topLevel = codes.filter((c) => !c.parentId).length;
  const subCodes = codeCount - topLevel;

  const memoCount = memos.length;
  const linkedMemos = memos.filter((m) => m.documentId || m.annotationId).length;

  const nav = (v: View) => () => setView(v);

  return (
    <div className="view home-view">
      <header className="view-header">
        <h1>{activeProject?.name ?? "Home"}</h1>
      </header>

      <div className="home-stats-grid">
        <StatCard
          title="Users"
          count={remote?.memberCount ?? null}
          stats={[
            { label: "Owners",  value: remote?.membersByRole["owner"]  ?? 0 },
            { label: "Editors", value: remote?.membersByRole["editor"] ?? 0 },
            { label: "Coders",  value: remote?.membersByRole["coder"]  ?? 0 },
            { label: "Viewers", value: remote?.membersByRole["viewer"] ?? 0 },
          ]}
          onClick={nav("users")}
        />

        <StatCard
          title="Cases"
          count={remote?.caseCount ?? null}
          stats={[
            { label: "Documents", value: docCount },
          ]}
          onClick={nav("cases")}
        />

        <StatCard
          title="Documents"
          count={docCount}
          stats={[
            { label: "Total words",   value: totalWords.toLocaleString() },
            { label: "Avg per doc",   value: avgWords.toLocaleString() },
            { label: "Annotations",   value: remote?.annotationCount ?? "—" },
          ]}
          onClick={nav("documents")}
        />

        <StatCard
          title="Codebook"
          count={codeCount}
          stats={[
            { label: "Top-level", value: topLevel },
            { label: "Sub-codes", value: subCodes },
          ]}
          onClick={nav("codebook")}
        />

        <StatCard
          title="Memos"
          count={memoCount}
          stats={[
            { label: "Linked",   value: linkedMemos },
            { label: "Unlinked", value: memoCount - linkedMemos },
          ]}
          onClick={nav("memos")}
        />

        <StatCard
          title="Reports"
          count={remote?.reportCount ?? null}
          stats={[
            { label: "Codes applied", value: remote?.annotationCount ?? "—" },
          ]}
          onClick={nav("code-reports")}
        />
      </div>
    </div>
  );
}
