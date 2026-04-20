import { useState, useCallback, useEffect } from "react";
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";
import type { Project, Document, Code, Annotation, Memo, View, Role, ProjectLogEntry } from "../types";

// ─── Map PocketBase records to our typed model ───────────────────────────────

function toProject(r: RecordModel): Project {
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? "",
    createdAt: r.created,
    updatedAt: r.updated,
  };
}

function toDocument(r: RecordModel): Document {
  return {
    id: r.id,
    projectId: r.project,
    name: r.name,
    filePath: r.file_path ?? "",
    content: r.content,
    importedAt: r.created,
  };
}

function toCode(r: RecordModel): Code {
  return {
    id: r.id,
    projectId: r.project,
    label: r.label,
    color: r.color,
    description: r.description ?? "",
    shortcut: r.shortcut ?? undefined,
    parentId: r.parent || undefined,
  };
}

function toAnnotation(r: RecordModel): Annotation {
  const cb = r.expand?.created_by;
  return {
    id: r.id,
    documentId: r.document,
    codeId: r.code,
    startOffset: r.start_offset,
    endOffset: r.end_offset,
    quote: r.quote,
    note: r.note ?? "",
    createdAt: r.created,
    createdBy: cb?.name || cb?.email || "",
    createdById: cb?.id || r.created_by || "",
  };
}

function toLogEntry(r: RecordModel): ProjectLogEntry {
  return {
    id: r.id,
    projectId: r.project,
    userId: r.user,
    userName: r.user_name ?? "",
    action: r.action,
    label: r.label,
    recordId: r.record_id || undefined,
    occurredAt: r.occurred_at,
  };
}

function toMemo(r: RecordModel): Memo {
  return {
    id: r.id,
    projectId: r.project,
    documentId: r.document || undefined,
    annotationId: r.annotation || undefined,
    title: r.title,
    body: r.body ?? "",
    createdAt: r.created,
    updatedAt: r.updated,
  };
}

async function fetchOwnerMap(pb: PocketBase, projectIds: string[]): Promise<Record<string, string>> {
  if (projectIds.length === 0) return {};
  const filter = projectIds.map((id) => `project="${id}"`).join("||");
  const owners = await pb.collection("project_members").getFullList({
    filter: `(${filter})&&role="owner"`,
    expand: "user",
  });
  return Object.fromEntries(
    owners.map((m) => [m.project, m.expand?.user?.name || m.expand?.user?.email || "Unknown"])
  );
}

// ─── Store ───────────────────────────────────────────────────────────────────

export function useAppStore(pb: PocketBase) {
  const [view, setView] = useState<View>("projects");
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [userRole, setUserRole] = useState<Role | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [activeDocument, setActiveDocument] = useState<Document | null>(null);
  const [codes, setCodes] = useState<Code[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [memos, setMemos] = useState<Memo[]>([]);
  const [pendingDocId,  setPendingDocId]  = useState<string | null>(null);
  const [pendingMemoId, setPendingMemoId] = useState<string | null>(null);
  const [pendingCaseId, setPendingCaseId] = useState<string | null>(null);
  const [logEntries,    setLogEntries]    = useState<ProjectLogEntry[]>([]);

  // Convenience: true only when current user can modify project contents
  const canEdit = userRole === "owner";

  // ── Logging ───────────────────────────────────────────────────────────────

  const logAction = useCallback(
    async (projectId: string, action: string, label: string, recordId?: string) => {
      const uid  = pb.authStore.record?.id;
      const name = pb.authStore.record?.name || pb.authStore.record?.email || "";
      try {
        const r = await pb.collection("project_log").create({
          project:     projectId,
          user:        uid,
          user_name:   name,
          action,
          label,
          record_id:   recordId ?? "",
        });
        setLogEntries((prev) => [toLogEntry(r), ...prev]);
      } catch {
        // logging failures must never break normal app flow
      }
    },
    [pb]
  );

  // ── Initial load ──────────────────────────────────────────────────────────

  useEffect(() => {
    const userId = pb.authStore.record?.id;
    if (!userId) return;
    setProjectsLoading(true);
    pb.collection("project_members")
      .getFullList({ filter: `user="${userId}"`, expand: "project", sort: "-created" })
      .then(async (memberships) => {
        const projectRecords: RecordModel[] = memberships
          .map((m) => m.expand?.project)
          .filter(Boolean);
        const ownerMap = await fetchOwnerMap(pb, projectRecords.map((r) => r.id));
        setProjects(projectRecords.map((r) => ({ ...toProject(r), createdBy: ownerMap[r.id] })));
      })
      .catch(console.error)
      .finally(() => setProjectsLoading(false));
  }, [pb]);

  // ── Real-time: projects + memberships ─────────────────────────────────────

  useEffect(() => {
    const userId = pb.authStore.record?.id;
    const unsubProjects = pb.collection("projects").subscribe("*", (e) => {
      if (e.action === "update") setProjects((p) => p.map((x) => x.id === e.record.id ? toProject(e.record) : x));
      if (e.action === "delete") setProjects((p) => p.filter((x) => x.id !== e.record.id));
    });
    const unsubMembers = pb.collection("project_members").subscribe("*", async (e) => {
      if (e.record.user !== userId) return;
      if (e.action === "create") {
        try {
          const proj = await pb.collection("projects").getOne(e.record.project);
          const ownerMap = await fetchOwnerMap(pb, [proj.id]);
          const project = { ...toProject(proj), createdBy: ownerMap[proj.id] };
          setProjects((p) => p.some((x) => x.id === proj.id) ? p : [project, ...p]);
        } catch { /* project deleted */ }
      }
      if (e.action === "delete") setProjects((p) => p.filter((x) => x.id !== e.record.project));
    });
    return () => {
      unsubProjects.then((fn) => fn()).catch(() => {});
      unsubMembers.then((fn) => fn()).catch(() => {});
    };
  }, [pb]);

  // ── Load project data + real-time when active project changes ─────────────

  useEffect(() => {
    if (!activeProject) return;
    const pid = activeProject.id;
    const uid = pb.authStore.record?.id;

    // Load user's role for this project
    pb.collection("project_members")
      .getFirstListItem(`project="${pid}" && user="${uid}"`)
      .then((r) => setUserRole(r.role as Role))
      .catch(() => setUserRole(null));

    pb.collection("documents")
      .getFullList({ filter: `project="${pid}"&&deleted_at=""`, sort: "created" })
      .then((r) => setDocuments(r.map(toDocument)))
      .catch(console.error);

    pb.collection("codes")
      .getFullList({ filter: `project="${pid}"&&deleted_at=""`, sort: "created" })
      .then((r) => setCodes(r.map(toCode)))
      .catch(console.error);

    pb.collection("memos")
      .getFullList({ filter: `project="${pid}"&&deleted_at=""`, sort: "-created" })
      .then((r) => setMemos(r.map(toMemo)))
      .catch(console.error);

    pb.collection("project_log")
      .getFullList({ filter: `project="${pid}"`, sort: "-occurred_at" })
      .then((r) => setLogEntries(r.map(toLogEntry)))
      .catch(console.error);

    const unsubDocs = pb.collection("documents").subscribe("*", (e) => {
      if (e.record.project !== pid) return;
      if (e.action === "create") setDocuments((p) => [...p, toDocument(e.record)]);
      if (e.action === "update") {
        if (e.record.deleted_at) {
          setDocuments((p) => p.filter((x) => x.id !== e.record.id));
        } else {
          const d = toDocument(e.record);
          setDocuments((p) => p.some((x) => x.id === d.id) ? p.map((x) => x.id === d.id ? d : x) : [...p, d]);
        }
      }
      if (e.action === "delete") setDocuments((p) => p.filter((x) => x.id !== e.record.id));
    });

    const unsubCodes = pb.collection("codes").subscribe("*", (e) => {
      if (e.record.project !== pid) return;
      if (e.action === "create") setCodes((p) => [...p, toCode(e.record)]);
      if (e.action === "update") {
        if (e.record.deleted_at) {
          setCodes((p) => p.filter((x) => x.id !== e.record.id));
        } else {
          const c = toCode(e.record);
          setCodes((p) => p.some((x) => x.id === c.id) ? p.map((x) => x.id === c.id ? c : x) : [...p, c]);
        }
      }
      if (e.action === "delete") setCodes((p) => p.filter((x) => x.id !== e.record.id));
    });

    const unsubMemos = pb.collection("memos").subscribe("*", (e) => {
      if (e.record.project !== pid) return;
      if (e.action === "create") setMemos((p) => [toMemo(e.record), ...p]);
      if (e.action === "update") {
        if (e.record.deleted_at) {
          setMemos((p) => p.filter((x) => x.id !== e.record.id));
        } else {
          const m = toMemo(e.record);
          setMemos((p) => p.some((x) => x.id === m.id) ? p.map((x) => x.id === m.id ? m : x) : [m, ...p]);
        }
      }
      if (e.action === "delete") setMemos((p) => p.filter((x) => x.id !== e.record.id));
    });

    return () => {
      unsubDocs.then((fn) => fn()).catch(() => {});
      unsubCodes.then((fn) => fn()).catch(() => {});
      unsubMemos.then((fn) => fn()).catch(() => {});
      setDocuments([]);
      setCodes([]);
      setMemos([]);
      setAnnotations([]);
      setLogEntries([]);
      setActiveDocument(null);
      setUserRole(null);
    };
  }, [pb, activeProject]);

  useEffect(() => {
    if (!activeDocument) return;
    const did = activeDocument.id;

    pb.collection("annotations")
      .getFullList({ filter: `document="${did}"&&deleted_at=""`, sort: "start_offset", expand: "created_by" })
      .then((r) => setAnnotations(r.map(toAnnotation)))
      .catch(console.error);

    const unsubAnnotations = pb.collection("annotations").subscribe("*", async (e) => {
      if (e.record.document !== did) return;
      if (e.action === "create" || (e.action === "update" && !e.record.deleted_at)) {
        const full = await pb.collection("annotations").getOne(e.record.id, { expand: "created_by" });
        if (e.action === "create") {
          setAnnotations((p) => [...p, toAnnotation(full)].sort((a, b) => a.startOffset - b.startOffset));
        } else {
          const ann = toAnnotation(full);
          setAnnotations((p) => p.some((x) => x.id === ann.id) ? p.map((x) => x.id === ann.id ? ann : x) : [...p, ann].sort((a, b) => a.startOffset - b.startOffset));
        }
      }
      if (e.action === "delete" || (e.action === "update" && e.record.deleted_at))
        setAnnotations((p) => p.filter((x) => x.id !== e.record.id));
    });

    return () => {
      unsubAnnotations.then((fn) => fn()).catch(() => {});
      setAnnotations([]);
    };
  }, [pb, activeDocument]);

  // ── Projects ──────────────────────────────────────────────────────────────

  const createProject = useCallback(
    async (name: string, description: string) => {
      const record = await pb.collection("projects").create({ name, description });
      const project = toProject(record);
      await pb.collection("project_members").create({
        project: project.id,
        user: pb.authStore.record?.id,
        role: "owner",
      });
      await logAction(project.id, "project.create", `Created project "${name}"`);
      return project;
    },
    [pb, logAction]
  );

  const openProject = useCallback(async (project: Project, prevProject?: Project | null) => {
    const uid = pb.authStore.record?.id;
    const now = new Date().toISOString();

    // Log close of previous project (when switching)
    if (prevProject && prevProject.id !== project.id) {
      await logAction(prevProject.id, "project.close", `Left project "${prevProject.name}"`);
    }

    // Stamp last_active on the membership record
    try {
      const membership = await pb.collection("project_members")
        .getFirstListItem(`project="${project.id}" && user="${uid}"`);
      await pb.collection("project_members").update(membership.id, { last_active: now });
    } catch { /* membership may not exist yet */ }

    await logAction(project.id, "project.open", `Opened project "${project.name}"`);

    setActiveProject(project);
    setActiveDocument(null);
    setView("home");
  }, [pb, logAction]);

  const closeProject = useCallback(async (project: Project) => {
    await logAction(project.id, "project.close", `Left project "${project.name}"`);
    setActiveProject(null);
    setActiveDocument(null);
    setView("projects");
  }, [logAction]);

  // ── Documents ─────────────────────────────────────────────────────────────

  // ── Restore ───────────────────────────────────────────────────────────────

  const restoreRecord = useCallback(
    async (action: string, recordId: string) => {
      const entity = action.split(".")[0];
      try {
        switch (entity) {
          case "document": {
            const rec = await pb.collection("documents").getOne(recordId);
            const ts = rec.deleted_at;
            await pb.collection("documents").update(recordId, { deleted_at: "" });
            const anns = await pb.collection("annotations").getFullList({ filter: `document="${recordId}"&&deleted_at="${ts}"` });
            await Promise.all(anns.map((a) => pb.collection("annotations").update(a.id, { deleted_at: "" })));
            break;
          }
          case "code": {
            const rec = await pb.collection("codes").getOne(recordId);
            const ts = rec.deleted_at;
            await pb.collection("codes").update(recordId, { deleted_at: "" });
            const anns = await pb.collection("annotations").getFullList({ filter: `code="${recordId}"&&deleted_at="${ts}"` });
            await Promise.all(anns.map((a) => pb.collection("annotations").update(a.id, { deleted_at: "" })));
            break;
          }
          case "annotation":
            await pb.collection("annotations").update(recordId, { deleted_at: "" });
            break;
          case "memo":
            await pb.collection("memos").update(recordId, { deleted_at: "" });
            break;
          case "case":
            await pb.collection("cases").update(recordId, { deleted_at: "" });
            break;
          case "code_report":
            await pb.collection("code_reports").update(recordId, { deleted_at: "" });
            break;
        }
        if (activeProject) await logAction(activeProject.id, `${entity}.restore`, `Restored ${entity}`);
      } catch (e) {
        console.error("Restore failed:", e);
        throw e;
      }
    },
    [pb, activeProject, logAction]
  );

  const addDocument = useCallback(
    async (name: string, filePath: string, content: string, createdBy?: string) => {
      if (!activeProject) return;
      const payload: Record<string, unknown> = {
        project: activeProject.id,
        name,
        file_path: filePath,
        content,
      };
      if (createdBy) payload.created_by = createdBy;
      const record = await pb.collection("documents").create(payload);
      const doc = toDocument(record);
      setActiveDocument(doc);
      await logAction(activeProject.id, "document.create", `Added document "${name}"`);
      return doc;
    },
    [pb, activeProject, logAction]
  );

  const updateDocument = useCallback(
    async (id: string, data: { name?: string; notes?: string; content?: string }) => {
      await pb.collection("documents").update(id, data);
      if (activeProject && data.name) await logAction(activeProject.id, "document.update", `Renamed document to "${data.name}"`);
      else if (activeProject) await logAction(activeProject.id, "document.update", "Updated document");
    },
    [pb, activeProject, logAction]
  );

  const deleteDocument = useCallback(
    async (id: string, name?: string) => {
      const deletedAt = new Date().toISOString();
      // Cascade soft-delete to annotations so they don't surface in reports
      const anns = await pb.collection("annotations").getFullList({ filter: `document="${id}"&&deleted_at=""`, fields: "id" });
      await Promise.all(anns.map((a) => pb.collection("annotations").update(a.id, { deleted_at: deletedAt })));
      await pb.collection("documents").update(id, { deleted_at: deletedAt });
      if (activeProject) await logAction(activeProject.id, "document.delete", `Deleted document${name ? ` "${name}"` : ""}`, id);
    },
    [pb, activeProject, logAction]
  );

  const addCaseDocument = useCallback(
    async (caseId: string, documentId: string) => {
      await pb.collection("case_documents").create({ case: caseId, document: documentId });
    },
    [pb]
  );

  const removeCaseDocument = useCallback(
    async (recordId: string) => {
      await pb.collection("case_documents").delete(recordId);
    },
    [pb]
  );

  // ── Codes ─────────────────────────────────────────────────────────────────

  const addCode = useCallback(
    async (label: string, color: string, description: string, shortcut?: string, parentId?: string, createdBy?: string) => {
      if (!activeProject) return;
      const record = await pb.collection("codes").create({
        project: activeProject.id,
        label,
        color,
        description,
        shortcut: shortcut ?? "",
        parent: parentId || null,
        created_by: createdBy || pb.authStore.record?.id || null,
      });
      await logAction(activeProject.id, "code.create", `Added code "${label}"`);
      return toCode(record);
    },
    [pb, activeProject, logAction]
  );

  const updateCode = useCallback(
    async (id: string, data: { label: string; color: string; description: string; parentId?: string }) => {
      await pb.collection("codes").update(id, {
        label: data.label,
        color: data.color,
        description: data.description,
        parent: data.parentId || null,
      });
      if (activeProject) await logAction(activeProject.id, "code.update", `Updated code "${data.label}"`);
    },
    [pb, activeProject, logAction]
  );

  const deleteCode = useCallback(
    async (id: string, label?: string) => {
      const deletedAt = new Date().toISOString();
      const anns = await pb.collection("annotations").getFullList({ filter: `code="${id}"&&deleted_at=""`, fields: "id" });
      await Promise.all(anns.map((a) => pb.collection("annotations").update(a.id, { deleted_at: deletedAt })));
      await pb.collection("codes").update(id, { deleted_at: deletedAt });
      if (activeProject) await logAction(activeProject.id, "code.delete", `Deleted code${label ? ` "${label}"` : ""}`, id);
    },
    [pb, activeProject, logAction]
  );

  // ── Annotations ───────────────────────────────────────────────────────────

  const addAnnotation = useCallback(
    async (documentId: string, codeId: string, startOffset: number, endOffset: number, quote: string, note = "") => {
      const record = await pb.collection("annotations").create({
        document: documentId,
        code: codeId,
        start_offset: startOffset,
        end_offset: endOffset,
        quote,
        note,
        created_by: pb.authStore.record?.id,
      });
      const truncated = quote.length > 40 ? quote.slice(0, 40) + "…" : quote;
      if (activeProject) await logAction(activeProject.id, "annotation.create", `Annotated "${truncated}"`);
      return toAnnotation(record);
    },
    [pb, activeProject, logAction]
  );

  const updateAnnotationNote = useCallback(
    async (id: string, note: string) => {
      await pb.collection("annotations").update(id, { note });
      if (activeProject) await logAction(activeProject.id, "annotation.update", "Updated annotation note");
    },
    [pb, activeProject, logAction]
  );

  const deleteAnnotation = useCallback(
    async (id: string) => {
      await pb.collection("annotations").update(id, { deleted_at: new Date().toISOString() });
      if (activeProject) await logAction(activeProject.id, "annotation.delete", "Deleted annotation", id);
    },
    [pb, activeProject, logAction]
  );

  // ── Cases ─────────────────────────────────────────────────────────────────

  const createCase = useCallback(
    async (name: string, createdBy?: string) => {
      if (!activeProject) return;
      const record = await pb.collection("cases").create({
        project: activeProject.id,
        name,
        created_by: createdBy || pb.authStore.record?.id || "",
      });
      await logAction(activeProject.id, "case.create", `Created case "${name}"`);
      return record;
    },
    [pb, activeProject, logAction]
  );

  const updateCase = useCallback(
    async (id: string, data: { name: string; notes: string }) => {
      await pb.collection("cases").update(id, data);
      if (activeProject) await logAction(activeProject.id, "case.update", `Updated case "${data.name}"`);
    },
    [pb, activeProject, logAction]
  );

  const deleteCase = useCallback(
    async (id: string, name?: string) => {
      await pb.collection("cases").update(id, { deleted_at: new Date().toISOString() });
      if (activeProject) await logAction(activeProject.id, "case.delete", `Deleted case${name ? ` "${name}"` : ""}`, id);
    },
    [pb, activeProject, logAction]
  );

  // ── Memos ─────────────────────────────────────────────────────────────────

  const addMemo = useCallback(
    async (data: {
      title: string;
      body: string;
      documentIds?: string[];
      annotationIds?: string[];
      caseIds?: string[];
      codeIds?: string[];
      createdBy?: string;
    }) => {
      if (!activeProject) return;
      const record = await pb.collection("memos").create({
        project: activeProject.id,
        title: data.title,
        body: data.body,
        document: data.documentIds ?? [],
        annotation: data.annotationIds ?? [],
        cases: data.caseIds ?? [],
        codes: data.codeIds ?? [],
        created_by: data.createdBy || pb.authStore.record?.id,
      });
      await logAction(activeProject.id, "memo.create", `Created memo "${data.title}"`);
      return toMemo(record);
    },
    [pb, activeProject, logAction]
  );

  const updateMemo = useCallback(
    async (id: string, data: {
      title: string;
      body: string;
      documentIds?: string[];
      annotationIds?: string[];
      caseIds?: string[];
      codeIds?: string[];
    }) => {
      await pb.collection("memos").update(id, {
        title: data.title,
        body: data.body,
        document: data.documentIds ?? [],
        annotation: data.annotationIds ?? [],
        cases: data.caseIds ?? [],
        codes: data.codeIds ?? [],
      });
      if (activeProject) await logAction(activeProject.id, "memo.update", `Updated memo "${data.title}"`);
    },
    [pb, activeProject, logAction]
  );

  const deleteMemo = useCallback(
    async (id: string, title?: string) => {
      await pb.collection("memos").update(id, { deleted_at: new Date().toISOString() });
      if (activeProject) await logAction(activeProject.id, "memo.delete", `Deleted memo${title ? ` "${title}"` : ""}`, id);
    },
    [pb, activeProject, logAction]
  );

  // ── Code Reports ──────────────────────────────────────────────────────────

  const createCodeReport = useCallback(
    async (data: { name: string; caseIds: string[]; documentIds: string[]; codeIds: string[]; createdBy?: string; snapshot?: string }) => {
      if (!activeProject) return;
      await pb.collection("code_reports").create({
        project: activeProject.id,
        name: data.name,
        cases: data.caseIds,
        documents: data.documentIds,
        codes: data.codeIds,
        created_by: data.createdBy || pb.authStore.record?.id || "",
        snapshot: data.snapshot ?? "",
      });
      await logAction(activeProject.id, "code_report.create", `Created report "${data.name}"`);
    },
    [pb, activeProject, logAction]
  );

  const updateCodeReport = useCallback(
    async (id: string, data: { name: string; caseIds: string[]; documentIds: string[]; codeIds: string[] }) => {
      await pb.collection("code_reports").update(id, {
        name: data.name,
        cases: data.caseIds,
        documents: data.documentIds,
        codes: data.codeIds,
      });
      if (activeProject) await logAction(activeProject.id, "code_report.update", `Updated report "${data.name}"`);
    },
    [pb, activeProject, logAction]
  );

  const deleteCodeReport = useCallback(
    async (id: string, name?: string) => {
      await pb.collection("code_reports").update(id, { deleted_at: new Date().toISOString() });
      if (activeProject) await logAction(activeProject.id, "code_report.delete", `Deleted report${name ? ` "${name}"` : ""}`, id);
    },
    [pb, activeProject, logAction]
  );

  return {
    pb,
    view, setView,
    projects, projectsLoading,
    activeProject,
    userRole,
    canEdit,
    documents,
    activeDocument, setActiveDocument,
    codes,
    annotations,
    allAnnotations: annotations,
    memos,
    logEntries,
    createProject, openProject, closeProject,
    restoreRecord,
    addDocument, updateDocument, deleteDocument,
    addCaseDocument, removeCaseDocument,
    addCode, updateCode, deleteCode,
    addAnnotation, updateAnnotationNote, deleteAnnotation,
    createCase, updateCase, deleteCase,
    addMemo, updateMemo, deleteMemo,
    createCodeReport, updateCodeReport, deleteCodeReport,
    logAction,
    pendingDocId, setPendingDocId,
    pendingMemoId, setPendingMemoId,
    pendingCaseId, setPendingCaseId,
  };
}

export type AppStore = ReturnType<typeof useAppStore>;
