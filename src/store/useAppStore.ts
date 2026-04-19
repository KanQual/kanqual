import { useState, useCallback, useEffect } from "react";
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";
import type { Project, Document, Code, Annotation, Memo, View, Role } from "../types";

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

  // Convenience: true only when current user can modify project contents
  const canEdit = userRole === "owner";

  // ── Initial load ──────────────────────────────────────────────────────────

  useEffect(() => {
    setProjectsLoading(true);
    pb.collection("projects")
      .getFullList({ sort: "-created" })
      .then((records) => setProjects(records.map(toProject)))
      .catch(console.error)
      .finally(() => setProjectsLoading(false));
  }, [pb]);

  // ── Real-time: projects ───────────────────────────────────────────────────

  useEffect(() => {
    const unsubProjects = pb.collection("projects").subscribe("*", (e) => {
      if (e.action === "create") setProjects((p) => [toProject(e.record), ...p]);
      if (e.action === "update") setProjects((p) => p.map((x) => x.id === e.record.id ? toProject(e.record) : x));
      if (e.action === "delete") setProjects((p) => p.filter((x) => x.id !== e.record.id));
    });
    return () => { unsubProjects.then((fn) => fn()).catch(() => {}); };
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
      .getFullList({ filter: `project="${pid}"`, sort: "created" })
      .then((r) => setDocuments(r.map(toDocument)))
      .catch(console.error);

    pb.collection("codes")
      .getFullList({ filter: `project="${pid}"`, sort: "created" })
      .then((r) => setCodes(r.map(toCode)))
      .catch(console.error);

    pb.collection("memos")
      .getFullList({ filter: `project="${pid}"`, sort: "-created" })
      .then((r) => setMemos(r.map(toMemo)))
      .catch(console.error);

    const unsubDocs = pb.collection("documents").subscribe("*", (e) => {
      if (e.record.project !== pid) return;
      if (e.action === "create") setDocuments((p) => [...p, toDocument(e.record)]);
      if (e.action === "update") setDocuments((p) => p.map((x) => x.id === e.record.id ? toDocument(e.record) : x));
      if (e.action === "delete") setDocuments((p) => p.filter((x) => x.id !== e.record.id));
    });

    const unsubCodes = pb.collection("codes").subscribe("*", (e) => {
      if (e.record.project !== pid) return;
      if (e.action === "create") setCodes((p) => [...p, toCode(e.record)]);
      if (e.action === "update") setCodes((p) => p.map((x) => x.id === e.record.id ? toCode(e.record) : x));
      if (e.action === "delete") setCodes((p) => p.filter((x) => x.id !== e.record.id));
    });

    const unsubMemos = pb.collection("memos").subscribe("*", (e) => {
      if (e.record.project !== pid) return;
      if (e.action === "create") setMemos((p) => [toMemo(e.record), ...p]);
      if (e.action === "update") setMemos((p) => p.map((x) => x.id === e.record.id ? toMemo(e.record) : x));
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
      setActiveDocument(null);
      setUserRole(null);
    };
  }, [pb, activeProject]);

  useEffect(() => {
    if (!activeDocument) return;
    const did = activeDocument.id;

    pb.collection("annotations")
      .getFullList({ filter: `document="${did}"`, sort: "start_offset", expand: "created_by" })
      .then((r) => setAnnotations(r.map(toAnnotation)))
      .catch(console.error);

    const unsubAnnotations = pb.collection("annotations").subscribe("*", async (e) => {
      if (e.record.document !== did) return;
      if (e.action === "create" || e.action === "update") {
        const full = await pb.collection("annotations").getOne(e.record.id, { expand: "created_by" });
        if (e.action === "create") {
          setAnnotations((p) => [...p, toAnnotation(full)].sort((a, b) => a.startOffset - b.startOffset));
        } else {
          setAnnotations((p) => p.map((x) => x.id === full.id ? toAnnotation(full) : x));
        }
      }
      if (e.action === "delete") setAnnotations((p) => p.filter((x) => x.id !== e.record.id));
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
      // Auto-assign the creator as owner
      await pb.collection("project_members").create({
        project: project.id,
        user: pb.authStore.record?.id,
        role: "owner",
      });
      return project;
    },
    [pb]
  );

  const openProject = useCallback((project: Project) => {
    setActiveProject(project);
    setActiveDocument(null);
    setView("home");
  }, []);

  // ── Documents ─────────────────────────────────────────────────────────────

  const addDocument = useCallback(
    async (name: string, filePath: string, content: string) => {
      if (!activeProject) return;
      const record = await pb.collection("documents").create({
        project: activeProject.id,
        name,
        file_path: filePath,
        content,
      });
      const doc = toDocument(record);
      setActiveDocument(doc);
      return doc;
    },
    [pb, activeProject]
  );

  // ── Codes ─────────────────────────────────────────────────────────────────

  const addCode = useCallback(
    async (label: string, color: string, description: string, shortcut?: string) => {
      if (!activeProject) return;
      const record = await pb.collection("codes").create({
        project: activeProject.id,
        label,
        color,
        description,
        shortcut: shortcut ?? "",
      });
      return toCode(record);
    },
    [pb, activeProject]
  );

  const deleteCode = useCallback(
    async (id: string) => { await pb.collection("codes").delete(id); },
    [pb]
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
      return toAnnotation(record);
    },
    [pb]
  );

  const updateAnnotationNote = useCallback(
    async (id: string, note: string) => { await pb.collection("annotations").update(id, { note }); },
    [pb]
  );

  const deleteAnnotation = useCallback(
    async (id: string) => { await pb.collection("annotations").delete(id); },
    [pb]
  );

  // ── Memos ─────────────────────────────────────────────────────────────────

  const addMemo = useCallback(
    async (title: string, body: string, documentId?: string, annotationId?: string) => {
      if (!activeProject) return;
      const record = await pb.collection("memos").create({
        project: activeProject.id,
        document: documentId ?? "",
        annotation: annotationId ?? "",
        title,
        body,
        created_by: pb.authStore.record?.id,
      });
      return toMemo(record);
    },
    [pb, activeProject]
  );

  const updateMemo = useCallback(
    async (id: string, title: string, body: string) => { await pb.collection("memos").update(id, { title, body }); },
    [pb]
  );

  const deleteMemo = useCallback(
    async (id: string) => { await pb.collection("memos").delete(id); },
    [pb]
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
    createProject, openProject,
    addDocument,
    addCode, deleteCode,
    addAnnotation, updateAnnotationNote, deleteAnnotation,
    addMemo, updateMemo, deleteMemo,
    pendingDocId, setPendingDocId,
    pendingMemoId, setPendingMemoId,
    pendingCaseId, setPendingCaseId,
  };
}

export type AppStore = ReturnType<typeof useAppStore>;
