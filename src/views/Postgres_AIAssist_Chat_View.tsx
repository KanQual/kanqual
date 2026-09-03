import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ArrowLeftRightIcon, HelpIcon } from "../components/AppIcons";
import { SettingsModal } from "../components/SettingsModal";
import { formatCurrentDateTime } from "../i18n/formatters";
import { useI18n } from "../i18n/provider";
import { readAppSettings } from "../lib/appSettings";
import { useViewportContextMenuStyle } from "../lib/contextMenu";
import { htmlToPlainText } from "../lib/htmlText";
import { assertActiveLlmRuntime, buildLlmInvokeRequestFields, getActiveLlmRuntime, type ActiveLlmRuntime } from "../lib/llmRuntime";
import {
  POSTGRES_PROJECT_CHANGED_EVENT,
  createPostgresProjectAiChat,
  createPostgresProjectAiChatMessage,
  deletePostgresProjectAiChat,
  getPostgresProjectAiAssistSettings,
  listPostgresAnnotationSummaries,
  listPostgresCodes,
  listPostgresMemos,
  listPostgresObjects,
  listPostgresProjectAiChatMessages,
  listPostgresProjectAiChats,
  listPostgresRelationships,
  listPostgresSources,
  touchPostgresProjectAiChat,
  type PostgresAnnotationSummary,
  type PostgresCode,
  type PostgresMemo,
  type PostgresObject,
  type PostgresProject,
  type PostgresProjectAiChat,
  type PostgresProjectAiChatMessage,
  type PostgresProjectAiAssistSettings,
  type PostgresProjectChangeEvent,
  type PostgresProjectUser,
  type PostgresRelationship,
  type PostgresSource,
} from "../lib/postgres";
import type { ProjectChatAiJobResult } from "../lib/aiJobs";

type OllamaProjectChatCitation = ProjectChatAiJobResult["citations"][number];
type ChatContextKind = "document" | "object" | "relationship" | "code" | "annotation" | "memo";
type ChatContextMode = "default" | "prioritize" | "restrict";

type SelectedChatContextState = {
  documentIds: string[];
  caseIds: string[];
  relationshipIds: string[];
  codeIds: string[];
  annotationIds: string[];
  memoIds: string[];
};

type PostgresAiChatMessageMetadata = {
  model?: string;
  usedContextItems?: number;
  source?: string;
  citations?: OllamaProjectChatCitation[];
};

type PostgresAiChatMessage = Omit<PostgresProjectAiChatMessage, "role"> & {
  role: "user" | "assistant";
  metadata: PostgresAiChatMessageMetadata | null;
};

type PostgresAiChat = PostgresProjectAiChat & {
  messages: PostgresAiChatMessage[];
};

type ChatCitationModalState = {
  citation: OllamaProjectChatCitation;
  index: number;
};

export type PostgresAiAssistChatViewProps = {
  project: PostgresProject;
  currentProjectUser: PostgresProjectUser | null;
  isProjectAdmin: boolean;
  onNavigate: (
    screen: "sources" | "code-text" | "annotations" | "codebook" | "memos" | "objects" | "relationships" | "app-settings",
    target?: {
      sourceId?: string | null;
      annotationId?: string | null;
      objectId?: string | null;
      relationshipId?: string | null;
      startOffset?: number | null;
      endOffset?: number | null;
    },
  ) => void;
};

type ChatContextData = {
  sources: PostgresSource[];
  objects: PostgresObject[];
  relationships: PostgresRelationship[];
  codes: PostgresCode[];
  annotations: PostgresAnnotationSummary[];
  memos: PostgresMemo[];
};

const EMPTY_CONTEXT: ChatContextData = {
  sources: [],
  objects: [],
  relationships: [],
  codes: [],
  annotations: [],
  memos: [],
};

function isAiAssistTextSourceKind(sourceKind: string | null | undefined): boolean {
  const normalized = (sourceKind ?? "").trim().toLowerCase().replace(/_/g, " ");
  return normalized === ""
    || normalized === "text"
    || normalized === "document"
    || normalized === "processed transcript"
    || normalized === "transcript";
}

function activeChatStorageKey(projectId: string): string {
  return `kanqual:postgres-active-ai-chat:${projectId}`;
}

function readActivePostgresProjectAiChatId(projectId: string): string | null {
  try {
    return window.localStorage.getItem(activeChatStorageKey(projectId));
  } catch {
    return null;
  }
}

function saveActivePostgresProjectAiChatId(projectId: string, chatId: string): void {
  try {
    window.localStorage.setItem(activeChatStorageKey(projectId), chatId);
  } catch {
    // Local storage is only a UI preference.
  }
}

function clearActivePostgresProjectAiChatId(projectId: string): void {
  try {
    window.localStorage.removeItem(activeChatStorageKey(projectId));
  } catch {
    // Local storage is only a UI preference.
  }
}

function shortenChatLabel(value: string, maxLength = 72): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (!clean) return "Untitled chat";
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength - 1)}...`;
}

function sortPostgresAiChats(chats: PostgresAiChat[]): PostgresAiChat[] {
  return [...chats].sort((a, b) => {
    const aTime = new Date(a.lastMessageAt ?? a.updatedAt ?? a.createdAt).getTime();
    const bTime = new Date(b.lastMessageAt ?? b.updatedAt ?? b.createdAt).getTime();
    return bTime - aTime;
  });
}

function getLastUserMessage(chat: PostgresAiChat): PostgresAiChatMessage | null {
  for (let index = chat.messages.length - 1; index >= 0; index -= 1) {
    if (chat.messages[index].role === "user") return chat.messages[index];
  }
  return null;
}

function parseMessageMetadata(metadataJson: string): PostgresAiChatMessageMetadata | null {
  if (!metadataJson.trim()) return null;
  try {
    const parsed = JSON.parse(metadataJson) as PostgresAiChatMessageMetadata;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeMessage(row: PostgresProjectAiChatMessage): PostgresAiChatMessage {
  return {
    ...row,
    role: row.role === "assistant" ? "assistant" : "user",
    metadata: parseMessageMetadata(row.metadataJson),
  };
}

function combineChats(
  chatRows: PostgresProjectAiChat[],
  messageRows: PostgresProjectAiChatMessage[],
): PostgresAiChat[] {
  const messagesByChatId = new Map<string, PostgresAiChatMessage[]>();
  for (const row of messageRows) {
    const message = normalizeMessage(row);
    const current = messagesByChatId.get(message.chatId) ?? [];
    current.push(message);
    messagesByChatId.set(message.chatId, current);
  }

  for (const messages of messagesByChatId.values()) {
    messages.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  return sortPostgresAiChats(
    chatRows.map((chat) => ({
      ...chat,
      messages: messagesByChatId.get(chat.id) ?? [],
    })),
  );
}

function formatChatTimestamp(
  t: ReturnType<typeof useI18n>["t"],
  value: string | null | undefined,
): string {
  if (!value) return t("aiAssist.chat.noMessagesYet");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return t("aiAssist.chat.unknownTimestamp");
  return formatCurrentDateTime(date, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatCitationTitle(title: string): string {
  return title.replace(/\s+\(chunk\s+\d+\)$/i, "").trim();
}

function formatAnnotationDisplayId(value: number | null | undefined): string {
  return value == null ? "-" : `A${String(value).padStart(2, "0")}`;
}

type CitationKind =
  | "annotation"
  | "object"
  | "code"
  | "text-segment"
  | "memo"
  | "relationship"
  | "source"
  | "project-description"
  | "document"
  | "other";

function getCitationKind(citation: OllamaProjectChatCitation): CitationKind {
  if (citation.itemType === "code") return "code";
  if (citation.itemType === "annotation" || citation.annotationId) return "annotation";
  if (citation.itemType === "object" || citation.objectId) return "object";
  if (citation.itemType === "case" || citation.caseId) return "object";
  if (citation.itemType === "relationship" || citation.relationshipId) return "relationship";
  if (citation.itemType === "memo") return "memo";
  if (citation.itemType === "project-description" || citation.itemType === "project_description") return "project-description";
  if (
    citation.itemType === "text-segment"
    || (
      (citation.itemType === "document" || citation.itemType === "source")
      && typeof citation.startOffset === "number"
      && typeof citation.endOffset === "number"
    )
  ) {
    return "text-segment";
  }
  if (citation.itemType === "document") return "document";
  if (citation.itemType === "source" || citation.sourceId) return "source";
  return "other";
}

function formatCitationKindLabel(kind: CitationKind, t: ReturnType<typeof useI18n>["t"]): string {
  if (kind === "text-segment") return t("aiAssist.chat.citationKinds.textSegment");
  if (kind === "project-description") return t("aiAssist.chat.citationKinds.projectDescription");
  if (kind === "code") return t("aiAssist.chat.citationKinds.code");
  if (kind === "annotation") return t("aiAssist.chat.citationKinds.annotation");
  if (kind === "object") return t("aiAssist.chat.citationKinds.object");
  if (kind === "relationship") return "Relationship";
  if (kind === "memo") return t("aiAssist.chat.citationKinds.memo");
  if (kind === "source") return t("aiAssist.chat.citationKinds.source");
  if (kind === "document") return t("aiAssist.chat.citationKinds.text");
  return t("aiAssist.chat.citationKinds.source");
}

function citationMetadataRows(citation: OllamaProjectChatCitation): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [];
  const add = (label: string, value: string | number | null | undefined) => {
    if (value === null || typeof value === "undefined") return;
    const text = String(value).trim();
    if (!text) return;
    rows.push({ label, value: text });
  };
  add("Item type", citation.itemType);
  add("Source ID", citation.sourceId ?? citation.documentId);
  add("Object ID", citation.objectId ?? citation.caseId);
  add("Relationship ID", citation.relationshipId);
  add("Code ID", citation.codeId);
  add("Annotation ID", citation.annotationId);
  add("Memo ID", citation.memoId);
  add("Start", citation.startOffset);
  add("End", citation.endOffset);
  return rows;
}

function hexColorWithAlpha(value: string | null | undefined, alphaHex: string): string | null {
  const normalized = (value ?? "").trim();
  if (/^#[0-9a-f]{6}$/i.test(normalized)) return `${normalized}${alphaHex}`;
  if (/^#[0-9a-f]{3}$/i.test(normalized)) {
    const [, r, g, b] = normalized;
    return `#${r}${r}${g}${g}${b}${b}${alphaHex}`;
  }
  return null;
}

function providerLabel(
  source: string,
  t: ReturnType<typeof useI18n>["t"],
): string {
  if (source === "copilot") return t("aiAssist.chat.providers.copilot");
  if (source === "blablador") return t("aiAssist.chat.providers.blablador");
  if (source === "openai") return t("aiAssist.chat.providers.openai");
  if (source === "anthropic") return t("aiAssist.chat.providers.anthropic");
  if (source === "host") return t("aiAssist.chat.providers.host");
  return t("aiAssist.chat.providers.ollama");
}

function toggleString(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

function annotationPreview(value: string, maxLength = 96): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength - 1)}...`;
}

function readActiveRuntimeSummary(): ActiveLlmRuntime | null {
  return getActiveLlmRuntime(readAppSettings().llm);
}

function formatRuntimeSummary(runtime: ActiveLlmRuntime | null): string {
  if (!runtime) return "LLM not configured";
  const modeLabel = runtime.mode === "cloud" ? "Cloud" : "Local";
  return `${modeLabel} - ${runtime.providerLabel} - ${runtime.model}`;
}

function renderChatTextWithCitations(
  text: string,
  citations: OllamaProjectChatCitation[],
  onClick: (citation: OllamaProjectChatCitation, citationIndex: number) => void,
): ReactNode {
  const paragraphs = text.split(/\n{2,}/).filter((part) => part.trim().length > 0);
  return paragraphs.map((paragraph, paragraphIndex) => {
    const parts: ReactNode[] = [];
    const regex = /\[(\d+)\]/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    let keyCounter = 0;
    while ((match = regex.exec(paragraph)) !== null) {
      const citationIndex = parseInt(match[1], 10) - 1;
      const citation = citations[citationIndex];
      if (!citation) continue;
      if (match.index > lastIndex) {
        parts.push(<span key={keyCounter++}>{paragraph.slice(lastIndex, match.index)}</span>);
      }
      parts.push(
        <button
          key={keyCounter++}
          type="button"
          className="ai-analyze-citation-link"
          onClick={() => onClick(citation, citationIndex)}
          title={citation.preview}
        >
          [{citationIndex + 1}]
        </button>,
      );
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < paragraph.length) {
      parts.push(<span key={keyCounter++}>{paragraph.slice(lastIndex)}</span>);
    }
    return <p key={paragraphIndex}>{parts}</p>;
  });
}

export function PostgresAiAssistChatView({
  project,
  currentProjectUser,
  isProjectAdmin,
  onNavigate,
}: PostgresAiAssistChatViewProps) {
  const { t } = useI18n();
  const [projectAiAssistSettings, setProjectAiAssistSettings] = useState<PostgresProjectAiAssistSettings | null>(null);
  const [contextData, setContextData] = useState<ChatContextData>(EMPTY_CONTEXT);
  const [chats, setChats] = useState<PostgresAiChat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [creatingChat, setCreatingChat] = useState(false);
  const [loading, setLoading] = useState(true);
  const [chatError, setChatError] = useState("");
  const [activeRuntimeSummary, setActiveRuntimeSummary] = useState<ActiveLlmRuntime | null>(() => readActiveRuntimeSummary());
  const [helpOpen, setHelpOpen] = useState(false);
  const [openCitationIds, setOpenCitationIds] = useState<Record<string, boolean>>({});
  const [highlightedCitation, setHighlightedCitation] = useState<{ messageId: string; index: number } | null>(null);
  const [citationModal, setCitationModal] = useState<ChatCitationModalState | null>(null);
  const [contextPickerOpen, setContextPickerOpen] = useState(false);
  const [contextTab, setContextTab] = useState<ChatContextKind>("document");
  const [contextQuery, setContextQuery] = useState("");
  const [selectedContext, setSelectedContext] = useState<SelectedChatContextState>({
    documentIds: [],
    caseIds: [],
    relationshipIds: [],
    codeIds: [],
    annotationIds: [],
    memoIds: [],
  });
  const [selectedContextMode, setSelectedContextMode] = useState<ChatContextMode>("default");
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; chatId: string } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const citationLinkRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const contextMenuStyle = useViewportContextMenuStyle(contextMenu, contextMenuRef);
  const currentUserId = currentProjectUser?.id ?? "";
  const currentProjectRole = currentProjectUser?.role ?? (isProjectAdmin ? "administrator" : "viewer");
  const canUseAiChat = isProjectAdmin || Boolean(currentProjectUser);
  const canSeeAllChats = isProjectAdmin || currentProjectRole === "owner" || currentProjectRole === "editor";
  const aiAssistEnabledForProject = projectAiAssistSettings?.enabled ?? false;

  const loadViewData = useCallback(async () => {
    setLoading(true);
    try {
      const [
        settings,
        chatRows,
        messageRows,
        sources,
        objects,
        relationships,
        codes,
        annotations,
        memos,
      ] = await Promise.all([
        getPostgresProjectAiAssistSettings(project.id),
        listPostgresProjectAiChats(project.id),
        listPostgresProjectAiChatMessages(project.id),
        listPostgresSources(project.id),
        listPostgresObjects(project.id),
        listPostgresRelationships(project.id),
        listPostgresCodes(project.id),
        listPostgresAnnotationSummaries(project.id),
        listPostgresMemos(project.id),
      ]);
      const nextChats = combineChats(chatRows, messageRows);
      const savedActiveChatId = readActivePostgresProjectAiChatId(project.id);
      const nextActiveChatId = nextChats.some((chat) => chat.id === savedActiveChatId)
        ? savedActiveChatId
        : nextChats[0]?.id ?? null;
      setProjectAiAssistSettings(settings);
      setContextData({ sources, objects, relationships, codes, annotations, memos });
      setChats(nextChats);
      setActiveChatId(nextActiveChatId);
      if (nextActiveChatId) saveActivePostgresProjectAiChatId(project.id, nextActiveChatId);
      else clearActivePostgresProjectAiChatId(project.id);
      setChatError("");
    } catch (error) {
      console.error("Failed to load PostgreSQL project chat:", error);
      setChatError(error instanceof Error ? error.message : t("aiAssist.chat.errors.couldNotLoad"));
    } finally {
      setLoading(false);
    }
  }, [project.id]);

  useEffect(() => {
    void loadViewData();
  }, [loadViewData]);

  useEffect(() => {
    if (!highlightedCitation || !openCitationIds[highlightedCitation.messageId]) return;
    const citationKey = `${highlightedCitation.messageId}:${highlightedCitation.index}`;
    citationLinkRefs.current[citationKey]?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "nearest",
    });
  }, [highlightedCitation, openCitationIds]);

  useEffect(() => {
    function refreshRuntimeSummary() {
      setActiveRuntimeSummary(readActiveRuntimeSummary());
    }

    window.addEventListener("focus", refreshRuntimeSummary);
    document.addEventListener("visibilitychange", refreshRuntimeSummary);
    return () => {
      window.removeEventListener("focus", refreshRuntimeSummary);
      document.removeEventListener("visibilitychange", refreshRuntimeSummary);
    };
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void listen<PostgresProjectChangeEvent>(POSTGRES_PROJECT_CHANGED_EVENT, (event) => {
      if (
        event.payload.projectId === project.id
        && (event.payload.entityType === "project_ai_chat" || event.payload.entityType === "project_ai_chat_message")
      ) {
        void loadViewData();
      }
    }).then((nextUnlisten) => {
      unlisten = nextUnlisten;
    });
    return () => {
      unlisten?.();
    };
  }, [loadViewData, project.id]);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (contextMenuRef.current && !contextMenuRef.current.contains(event.target as Node)) {
        setContextMenu(null);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setContextMenu(null);
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const sortedChats = useMemo(() => sortPostgresAiChats(chats), [chats]);
  const activeChat = sortedChats.find((chat) => chat.id === activeChatId) ?? null;
  const activeChatReadOnly = !!(
    activeChat
    && activeChat.createdByProjectUserId
    && activeChat.createdByProjectUserId !== currentUserId
    && canSeeAllChats
  );
  const sourceById = useMemo(() => new Map(contextData.sources.map((source) => [source.id, source])), [contextData.sources]);
  const aiAssistTextSourceIds = useMemo(
    () => new Set(contextData.sources.filter((source) => isAiAssistTextSourceKind(source.sourceKind)).map((source) => source.id)),
    [contextData.sources],
  );
  const aiAssistTextAnnotationIds = useMemo(
    () => new Set(contextData.annotations.filter((annotation) => isAiAssistTextSourceKind(annotation.sourceKind)).map((annotation) => annotation.id)),
    [contextData.annotations],
  );
  const objectById = useMemo(() => new Map(contextData.objects.map((object) => [object.id, object])), [contextData.objects]);
  const relationshipById = useMemo(() => new Map(contextData.relationships.map((relationship) => [relationship.id, relationship])), [contextData.relationships]);
  const codeById = useMemo(() => new Map(contextData.codes.map((code) => [code.id, code])), [contextData.codes]);
  const annotationById = useMemo(() => new Map(contextData.annotations.map((annotation) => [annotation.id, annotation])), [contextData.annotations]);
  const memoById = useMemo(() => new Map(contextData.memos.map((memo) => [memo.id, memo])), [contextData.memos]);

  const selectedContextChips = useMemo(() => {
    const chips: Array<{ kind: ChatContextKind; id: string; label: string; detail?: string }> = [];

    for (const documentId of selectedContext.documentIds) {
      const source = sourceById.get(documentId);
      if (!source || !aiAssistTextSourceIds.has(documentId)) continue;
      chips.push({ kind: "document", id: documentId, label: source.title, detail: t("aiAssist.chat.source") });
    }

    for (const objectId of selectedContext.caseIds) {
      const object = objectById.get(objectId);
      if (!object) continue;
      chips.push({ kind: "object", id: objectId, label: object.title, detail: "Object" });
    }

    for (const relationshipId of selectedContext.relationshipIds) {
      const relationship = relationshipById.get(relationshipId);
      if (!relationship) continue;
      chips.push({
        kind: "relationship",
        id: relationshipId,
        label: relationship.relationshipType || t("aiAssist.chat.citationKinds.relationship"),
        detail: `${relationship.fromEntityName || relationship.fromObjectId} -> ${relationship.toEntityName || relationship.toObjectId}`,
      });
    }

    for (const codeId of selectedContext.codeIds) {
      const code = codeById.get(codeId);
      if (!code) continue;
      chips.push({ kind: "code", id: codeId, label: code.label, detail: "Code" });
    }

    for (const annotationId of selectedContext.annotationIds) {
      const annotation = contextData.annotations.find((item) => item.id === annotationId);
      if (!annotation || !aiAssistTextAnnotationIds.has(annotationId)) continue;
      const source = sourceById.get(annotation.sourceId);
      chips.push({
        kind: "annotation",
        id: annotationId,
        label: annotationPreview(annotation.quote || annotation.note || t("aiAssist.chat.citationKinds.annotation")),
        detail: `${annotation.primaryCodeLabel || t("aiAssist.chat.citationKinds.annotation")} in ${source?.title ?? t("aiAssist.chat.sourceFallback")}`,
      });
    }

    for (const memoId of selectedContext.memoIds) {
      const memo = memoById.get(memoId);
      if (!memo) continue;
      chips.push({ kind: "memo", id: memoId, label: memo.title, detail: t("aiAssist.chat.citationKinds.memo") });
    }

    return chips;
  }, [aiAssistTextAnnotationIds, aiAssistTextSourceIds, codeById, contextData.annotations, memoById, objectById, relationshipById, selectedContext, sourceById]);

  const filteredSources = useMemo(() => {
    const textSources = contextData.sources.filter((source) => isAiAssistTextSourceKind(source.sourceKind));
    const query = contextQuery.trim().toLowerCase();
    if (!query) return textSources;
    return textSources.filter((source) =>
      source.title.toLowerCase().includes(query)
      || source.notes.toLowerCase().includes(query)
      || source.textContent.toLowerCase().includes(query),
    );
  }, [contextData.sources, contextQuery]);

  const filteredObjects = useMemo(() => {
    const query = contextQuery.trim().toLowerCase();
    if (!query) return contextData.objects;
    return contextData.objects.filter((object) =>
      object.title.toLowerCase().includes(query)
      || object.description.toLowerCase().includes(query)
      || object.objectType.toLowerCase().includes(query),
    );
  }, [contextData.objects, contextQuery]);

  const filteredRelationships = useMemo(() => {
    const query = contextQuery.trim().toLowerCase();
    if (!query) return contextData.relationships;
    return contextData.relationships.filter((relationship) =>
      relationship.relationshipType.toLowerCase().includes(query)
      || relationship.description.toLowerCase().includes(query)
      || relationship.fromEntityName.toLowerCase().includes(query)
      || relationship.toEntityName.toLowerCase().includes(query),
    );
  }, [contextData.relationships, contextQuery]);

  const filteredCodes = useMemo(() => {
    const query = contextQuery.trim().toLowerCase();
    if (!query) return contextData.codes;
    return contextData.codes.filter((code) =>
      code.label.toLowerCase().includes(query)
      || code.description.toLowerCase().includes(query),
    );
  }, [contextData.codes, contextQuery]);

  const filteredAnnotations = useMemo(() => {
    const textAnnotations = contextData.annotations.filter((annotation) => isAiAssistTextSourceKind(annotation.sourceKind));
    const query = contextQuery.trim().toLowerCase();
    if (!query) return textAnnotations;
    return textAnnotations.filter((annotation) => {
      const source = sourceById.get(annotation.sourceId);
      return (
        annotation.quote.toLowerCase().includes(query)
        || annotation.note.toLowerCase().includes(query)
        || annotation.primaryCodeLabel.toLowerCase().includes(query)
        || (source?.title.toLowerCase().includes(query) ?? false)
      );
    });
  }, [contextData.annotations, contextQuery, sourceById]);

  const filteredMemos = useMemo(() => {
    const query = contextQuery.trim().toLowerCase();
    if (!query) return contextData.memos;
    return contextData.memos.filter((memo) =>
      memo.title.toLowerCase().includes(query)
      || memo.body.toLowerCase().includes(query),
    );
  }, [contextData.memos, contextQuery]);

  const contextCategoryItems: Array<{
    kind: ChatContextKind;
    label: string;
    count: number;
    selectedCount: number;
  }> = [
    {
      kind: "document",
      label: t("aiAssist.chat.contextSources"),
      count: aiAssistTextSourceIds.size,
      selectedCount: selectedContext.documentIds.filter((id) => aiAssistTextSourceIds.has(id)).length,
    },
    {
      kind: "object",
      label: "Objects",
      count: contextData.objects.length,
      selectedCount: selectedContext.caseIds.length,
    },
    {
      kind: "relationship",
      label: "Relationships",
      count: contextData.relationships.length,
      selectedCount: selectedContext.relationshipIds.length,
    },
    {
      kind: "code",
      label: "Codes",
      count: contextData.codes.length,
      selectedCount: selectedContext.codeIds.length,
    },
    {
      kind: "annotation",
      label: t("aiAssist.chat.contextAnnotations"),
      count: aiAssistTextAnnotationIds.size,
      selectedCount: selectedContext.annotationIds.filter((id) => aiAssistTextAnnotationIds.has(id)).length,
    },
    {
      kind: "memo",
      label: t("aiAssist.chat.contextMemos"),
      count: contextData.memos.length,
      selectedCount: selectedContext.memoIds.length,
    },
  ];
  const activeContextCategory = contextCategoryItems.find((item) => item.kind === contextTab) ?? contextCategoryItems[0];
  const selectedContextCount = selectedContextChips.length;

  function updateChats(nextChats: PostgresAiChat[], nextActiveChatId?: string | null) {
    const sorted = sortPostgresAiChats(nextChats);
    setChats(sorted);
    const resolvedActiveChatId = nextActiveChatId ?? activeChatId ?? sorted[0]?.id ?? null;
    setActiveChatId(resolvedActiveChatId);
    if (resolvedActiveChatId) {
      saveActivePostgresProjectAiChatId(project.id, resolvedActiveChatId);
    } else {
      clearActivePostgresProjectAiChatId(project.id);
    }
  }

  function mergeChatUpdate(chatId: string, fallbackChats: PostgresAiChat[], updateChat: (chat: PostgresAiChat) => PostgresAiChat) {
    setChats((currentChats) => {
      const baseChats = currentChats.some((chat) => chat.id === chatId) ? currentChats : fallbackChats;
      return sortPostgresAiChats(baseChats.map((chat) => (chat.id === chatId ? updateChat(chat) : chat)));
    });
    setActiveChatId(chatId);
    saveActivePostgresProjectAiChatId(project.id, chatId);
  }

  async function handleNewChat() {
    if (!canUseAiChat) return;
    if (!currentUserId) {
      setChatError(t("aiAssist.chat.errors.mustBeProjectMemberToStart"));
      return;
    }
    if (creatingChat) return;
    const existingEmptyOwnChat = sortedChats.find((chat) =>
      chat.createdByProjectUserId === currentUserId && chat.messages.length === 0
    );
    if (existingEmptyOwnChat) {
      setActiveChatId(existingEmptyOwnChat.id);
      saveActivePostgresProjectAiChatId(project.id, existingEmptyOwnChat.id);
      setDraft("");
      setChatError("");
      window.setTimeout(() => textareaRef.current?.focus(), 0);
      return;
    }
    setCreatingChat(true);
    try {
      const createdChat = await createPostgresProjectAiChat({
        projectId: project.id,
        title: t("aiAssist.chat.untitledChat"),
        participantProjectUserIds: [currentUserId],
      });
      updateChats([{ ...createdChat, messages: [] }, ...chats], createdChat.id);
      setDraft("");
      setChatError("");
      window.setTimeout(() => textareaRef.current?.focus(), 0);
    } catch (error) {
      setChatError(error instanceof Error ? error.message : t("aiAssist.chat.errors.couldNotStart"));
    } finally {
      setCreatingChat(false);
    }
  }

  function handleSelectChat(chatId: string) {
    setActiveChatId(chatId);
    saveActivePostgresProjectAiChatId(project.id, chatId);
    setChatError("");
    setContextMenu(null);
  }

  function toggleCitationOpen(messageId: string) {
    setOpenCitationIds((current) => ({
      ...current,
      [messageId]: !current[messageId],
    }));
  }

  function handleInlineCitationClick(messageId: string, _citation: OllamaProjectChatCitation, citationIndex: number) {
    setOpenCitationIds((current) => ({
      ...current,
      [messageId]: true,
    }));
    setHighlightedCitation({ messageId, index: citationIndex });
  }

  async function handleDeleteChat(chatId: string) {
    const targetChat = chats.find((chat) => chat.id === chatId);
    if (!targetChat || targetChat.createdByProjectUserId !== currentUserId) {
      setContextMenu(null);
      return;
    }
    try {
      await deletePostgresProjectAiChat(project.id, chatId);
      const remainingChats = chats.filter((chat) => chat.id !== chatId);
      const nextActiveChatId = activeChatId === chatId ? (remainingChats[0]?.id ?? null) : activeChatId;
      updateChats(remainingChats, nextActiveChatId);
      setContextMenu(null);
      setChatError("");
    } catch (error) {
      setChatError(error instanceof Error ? error.message : t("aiAssist.chat.errors.couldNotDelete"));
    }
  }

  function toggleContext(kind: ChatContextKind, id: string) {
    setSelectedContext((current) => {
      if (kind === "document") return { ...current, documentIds: toggleString(current.documentIds, id) };
      if (kind === "object") return { ...current, caseIds: toggleString(current.caseIds, id) };
      if (kind === "relationship") return { ...current, relationshipIds: toggleString(current.relationshipIds, id) };
      if (kind === "code") return { ...current, codeIds: toggleString(current.codeIds, id) };
      if (kind === "annotation") return { ...current, annotationIds: toggleString(current.annotationIds, id) };
      return { ...current, memoIds: toggleString(current.memoIds, id) };
    });
  }

  function removeContextChip(kind: ChatContextKind, id: string) {
    setSelectedContext((current) => {
      if (kind === "document") return { ...current, documentIds: current.documentIds.filter((item) => item !== id) };
      if (kind === "object") return { ...current, caseIds: current.caseIds.filter((item) => item !== id) };
      if (kind === "relationship") return { ...current, relationshipIds: current.relationshipIds.filter((item) => item !== id) };
      if (kind === "code") return { ...current, codeIds: current.codeIds.filter((item) => item !== id) };
      if (kind === "annotation") return { ...current, annotationIds: current.annotationIds.filter((item) => item !== id) };
      return { ...current, memoIds: current.memoIds.filter((item) => item !== id) };
    });
  }

  function handleOpenCitation(citation: OllamaProjectChatCitation) {
    const kind = getCitationKind(citation);
    if (kind === "code" && citation.codeId) {
      onNavigate("codebook");
      setChatError("");
      return;
    }
    if (kind === "object" && (citation.objectId || citation.caseId)) {
      onNavigate("objects", {
        objectId: citation.objectId ?? citation.caseId ?? null,
      });
      setChatError("");
      return;
    }
    if (kind === "relationship" && citation.relationshipId) {
      onNavigate("relationships", {
        relationshipId: citation.relationshipId,
      });
      setChatError("");
      return;
    }
    if (kind === "memo" && citation.memoId) {
      onNavigate("memos");
      setChatError("");
      return;
    }
    if (kind === "annotation" && citation.annotationId) {
      onNavigate("annotations", {
        annotationId: citation.annotationId,
      });
      setChatError("");
      return;
    }
    if (kind === "text-segment") {
      const targetSourceId =
        citation.sourceId
        ?? citation.documentId
        ?? null;
      if (
        !targetSourceId
        || typeof citation.startOffset !== "number"
        || typeof citation.endOffset !== "number"
        || citation.endOffset <= citation.startOffset
      ) {
        setChatError(t("aiAssist.chat.citationUnavailableInCodeText"));
        return;
      }
      onNavigate("code-text", {
        sourceId: targetSourceId,
        startOffset: citation.startOffset,
        endOffset: citation.endOffset,
      });
      setChatError("");
      return;
    }
    if (kind === "source" || kind === "document") {
      const targetSourceId =
        citation.sourceId
        ?? citation.documentId
        ?? null;
      if (!targetSourceId) {
        setChatError(t("aiAssist.chat.citationUnavailableInCodeText"));
        return;
      }
      onNavigate("sources", {
        sourceId: targetSourceId,
      });
      setChatError("");
      return;
    }
    if (kind === "project-description") {
      onNavigate("app-settings");
      setChatError("");
      return;
    }
    setChatError(t("aiAssist.chat.citationUnavailableInCodeText"));
  }

  function handleOpenCitationFromModal() {
    if (!citationModal) return;
    const citation = citationModal.citation;
    setCitationModal(null);
    handleOpenCitation(citation);
  }

  function getTextSegmentCitationSource(citation: OllamaProjectChatCitation): PostgresSource | null {
    const targetSourceId = citation.sourceId ?? citation.documentId ?? null;
    if (!targetSourceId) return null;
    return sourceById.get(targetSourceId) ?? null;
  }

  function getTextSegmentCitationText(citation: OllamaProjectChatCitation): string {
    const source = getTextSegmentCitationSource(citation);
    if (
      source
      && typeof citation.startOffset === "number"
      && typeof citation.endOffset === "number"
      && citation.endOffset > citation.startOffset
    ) {
      const startOffset = Math.max(0, Math.min(citation.startOffset, source.textContent.length));
      const endOffset = Math.max(startOffset, Math.min(citation.endOffset, source.textContent.length));
      const fullTextSegment = source.textContent.slice(startOffset, endOffset);
      if (fullTextSegment.trim()) return fullTextSegment;
    }
    return citation.preview;
  }

  function getTextSegmentCitationSourceTitle(citation: OllamaProjectChatCitation): string {
    return getTextSegmentCitationSource(citation)?.title
      ?? formatCitationTitle(citation.title || t("aiAssist.chat.source"));
  }

  function getAnnotationCitation(citation: OllamaProjectChatCitation): PostgresAnnotationSummary | null {
    if (!citation.annotationId) return null;
    return annotationById.get(citation.annotationId) ?? null;
  }

  function getAnnotationCitationCode(annotation: PostgresAnnotationSummary | null, citation: OllamaProjectChatCitation): PostgresCode | null {
    const codeId = annotation?.primaryCodeId || citation.codeId || null;
    return codeId ? codeById.get(codeId) ?? null : null;
  }

  function getAnnotationCitationCodeLabel(annotation: PostgresAnnotationSummary | null, citation: OllamaProjectChatCitation): string {
    return getAnnotationCitationCode(annotation, citation)?.label
      || annotation?.primaryCodeLabel
      || t("aiAssist.chat.citationKinds.annotation");
  }

  function getAnnotationCitationText(annotation: PostgresAnnotationSummary | null, citation: OllamaProjectChatCitation): string {
    if (!annotation) return citation.preview;
    return [
      annotation.quote.trim(),
      annotation.note.trim() ? `${t("aiAssist.chat.note")}:\n${annotation.note.trim()}` : "",
    ].filter(Boolean).join("\n\n");
  }

  function getAnnotationCitationStyle(annotation: PostgresAnnotationSummary | null, citation: OllamaProjectChatCitation): CSSProperties {
    const codeColor = getAnnotationCitationCode(annotation, citation)?.color ?? "#888888";
    return {
      borderColor: codeColor,
      backgroundColor: hexColorWithAlpha(codeColor, "22") ?? codeColor,
    };
  }

  function getObjectCitation(citation: OllamaProjectChatCitation): PostgresObject | null {
    const objectId = citation.objectId ?? citation.caseId ?? null;
    if (!objectId) return null;
    return objectById.get(objectId) ?? null;
  }

  function getObjectCitationTitle(citation: OllamaProjectChatCitation): string {
    return getObjectCitation(citation)?.title
      || formatCitationTitle(citation.title || t("aiAssist.chat.citationKinds.object")).replace(/^Object:\s*/i, "").trim()
      || t("aiAssist.chat.citationKinds.object");
  }

  function getObjectCitationDescription(citation: OllamaProjectChatCitation): string {
    const object = getObjectCitation(citation);
    if (object?.description.trim()) return htmlToPlainText(object.description);
    return citation.preview.replace(/^passage:\s*/i, "").trim();
  }

  function getObjectCitationType(citation: OllamaProjectChatCitation): string {
    return getObjectCitation(citation)?.objectType || t("aiAssist.chat.citationKinds.object");
  }

  function getRelationshipCitation(citation: OllamaProjectChatCitation): PostgresRelationship | null {
    if (!citation.relationshipId) return null;
    return relationshipById.get(citation.relationshipId) ?? null;
  }

  function getRelationshipCitationTitle(citation: OllamaProjectChatCitation): string {
    const relationship = getRelationshipCitation(citation);
    if (relationship) {
      const fromLabel = relationship.fromEntityName || relationship.fromEntityId || t("aiAssist.chat.from");
      const toLabel = relationship.toEntityName || relationship.toEntityId || t("aiAssist.chat.to");
      return `${fromLabel} -> ${toLabel}`;
    }
    return formatCitationTitle(citation.title || t("aiAssist.chat.citationKinds.relationship")).replace(/^Relationship:\s*/i, "").trim() || t("aiAssist.chat.citationKinds.relationship");
  }

  function getRelationshipCitationType(citation: OllamaProjectChatCitation): string {
    return getRelationshipCitation(citation)?.relationshipType || t("aiAssist.chat.citationKinds.relationship");
  }

  function getRelationshipCitationDescription(citation: OllamaProjectChatCitation): string {
    const relationship = getRelationshipCitation(citation);
    if (relationship?.description.trim()) return htmlToPlainText(relationship.description);
    return "";
  }

  function formatRelationshipEndpointType(value: string): string {
    const clean = value.replace(/_/g, " ").trim();
    if (!clean) return "Item";
    return clean.replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function getRelationshipEndpointSummary(
    relationship: PostgresRelationship | null,
    side: "from" | "to",
  ): { label: string; title: string; type: string } {
    const label = side === "from" ? "From" : "To";
    if (!relationship) return { label, title: "-", type: "-" };

    const entityType = side === "from" ? relationship.fromEntityType : relationship.toEntityType;
    const entityId = side === "from" ? relationship.fromEntityId : relationship.toEntityId;
    const fallbackId = side === "from" ? relationship.fromObjectId : relationship.toObjectId;
    const fallbackName = side === "from" ? relationship.fromEntityName : relationship.toEntityName;
    const resolvedId = entityId || fallbackId;

    if (entityType === "source") {
      const source = sourceById.get(resolvedId);
      return {
        label,
        title: source?.title || fallbackName || resolvedId || "-",
        type: formatRelationshipEndpointType(source?.sourceKind || t("aiAssist.chat.source")),
      };
    }

    const object = objectById.get(resolvedId);
    return {
      label,
      title: object?.title || fallbackName || resolvedId || "-",
      type: object?.objectType || t("aiAssist.chat.citationKinds.object"),
    };
  }

  function getCitationListTitle(citation: OllamaProjectChatCitation, kind: CitationKind): string {
    if (kind === "annotation") {
      const annotation = getAnnotationCitation(citation);
      return annotation ? formatAnnotationDisplayId(annotation.displayId) : formatCitationTitle(citation.title || t("aiAssist.chat.citationKinds.annotation"));
    }
    if (kind === "object") return getObjectCitationTitle(citation);
    if (kind === "relationship") return getRelationshipCitationTitle(citation);
    return formatCitationTitle(citation.title);
  }

  function getCitationListBadge(citation: OllamaProjectChatCitation, kind: CitationKind): string {
    if (kind === "annotation") return getAnnotationCitationCodeLabel(getAnnotationCitation(citation), citation);
    if (kind === "object") return getObjectCitationType(citation);
    if (kind === "relationship") return getRelationshipCitationType(citation);
    return formatCitationKindLabel(kind, t);
  }

  function getCitationListDetail(citation: OllamaProjectChatCitation, kind: CitationKind): string {
    if (kind === "annotation") return getAnnotationCitationText(getAnnotationCitation(citation), citation);
    if (kind === "object") return getObjectCitationDescription(citation);
    if (kind === "relationship") return getRelationshipCitationDescription(citation);
    return citation.preview;
  }

  async function handleSendMessage() {
    if (!canUseAiChat) return;
    if (!currentUserId) {
      setChatError(t("aiAssist.chat.errors.mustBeProjectMemberToSend"));
      return;
    }
    if (activeChatReadOnly) {
      setChatError(t("aiAssist.chat.errors.conversationReadOnly"));
      return;
    }
    const messageText = draft.trim();
    if (!messageText) return;

    let runtime;
    let llmSettings;
    try {
      llmSettings = readAppSettings().llm;
      runtime = assertActiveLlmRuntime(llmSettings, "using project chat");
      setActiveRuntimeSummary(runtime);
    } catch (error) {
      setChatError(error instanceof Error ? error.message : t("aiAssist.chat.errors.configureBeforeChat"));
      return;
    }

    let nextChats = chats;
    let nextChatId = activeChatId;
    let conversationForRequest: Array<{ role: string; content: string }> = [];
    let targetChatTitle = shortenChatLabel(messageText);
    let userTouchRequest: Parameters<typeof touchPostgresProjectAiChat>[0] | null = null;
    setSending(true);
    setChatError("");

    try {
      if (!activeChat) {
        const createdChat = await createPostgresProjectAiChat({
          projectId: project.id,
          title: targetChatTitle,
          participantProjectUserIds: [currentUserId],
        });
        const userMessage = normalizeMessage(await createPostgresProjectAiChatMessage({
          chatId: createdChat.id,
          projectId: project.id,
          role: "user",
          text: messageText,
          metadataJson: null,
        }));
        userTouchRequest = {
          projectId: project.id,
          chatId: createdChat.id,
          lastMessageAt: userMessage.createdAt,
          title: targetChatTitle,
        };
        nextChats = [
          {
            ...createdChat,
            title: targetChatTitle,
            lastMessageAt: userMessage.createdAt,
            updatedAt: userMessage.createdAt,
            messages: [userMessage],
          },
          ...chats,
        ];
        nextChatId = createdChat.id;
        conversationForRequest = [];
      } else {
        const shouldRetitleChat = activeChat.messages.length === 0 || !activeChat.title || activeChat.title === t("aiAssist.chat.untitledChat");
        targetChatTitle = shouldRetitleChat ? targetChatTitle : activeChat.title;
        conversationForRequest = activeChat.messages.map((message) => ({
          role: message.role,
          content: message.text,
        }));
        const userMessage = normalizeMessage(await createPostgresProjectAiChatMessage({
          chatId: activeChat.id,
          projectId: project.id,
          role: "user",
          text: messageText,
          metadataJson: null,
        }));
        userTouchRequest = {
          projectId: project.id,
          chatId: activeChat.id,
          lastMessageAt: userMessage.createdAt,
          ...(shouldRetitleChat ? { title: targetChatTitle } : {}),
        };
        nextChats = chats.map((chat) => (
          chat.id === activeChat.id
            ? {
                ...chat,
                title: shouldRetitleChat ? targetChatTitle : chat.title,
                lastMessageAt: userMessage.createdAt,
                updatedAt: userMessage.createdAt,
                messages: [...chat.messages, userMessage],
              }
            : chat
        ));
        nextChatId = activeChat.id;
      }

      updateChats(nextChats, nextChatId);
      setDraft("");
      if (userTouchRequest) {
        try {
          await touchPostgresProjectAiChat(userTouchRequest);
        } catch (error) {
          console.warn("Could not update PostgreSQL AI chat metadata after user message:", error);
        }
      }

      const response = await invoke<ProjectChatAiJobResult>("chat_with_project_ollama", {
        request: {
          projectId: project.id,
          query: messageText,
          conversation: conversationForRequest,
          ...buildLlmInvokeRequestFields(llmSettings),
          prefixQueries: llmSettings.prefixQueries,
          selectedContextMode,
          selectedDocumentIds: selectedContext.documentIds.filter((id) => aiAssistTextSourceIds.has(id)),
          selectedCaseIds: selectedContext.caseIds,
          selectedRelationshipIds: selectedContext.relationshipIds,
          selectedCodeIds: selectedContext.codeIds,
          selectedAnnotationIds: selectedContext.annotationIds.filter((id) => aiAssistTextAnnotationIds.has(id)),
          selectedMemoIds: selectedContext.memoIds,
        },
      });

      const assistantMessage = normalizeMessage(await createPostgresProjectAiChatMessage({
        chatId: nextChatId!,
        projectId: project.id,
        role: "assistant",
        text: response.content,
        metadataJson: JSON.stringify({
          model: response.model,
          usedContextItems: response.usedContextItems,
          source: runtime.sourceTag,
          citations: response.citations,
        } satisfies PostgresAiChatMessageMetadata),
      }));
      await touchPostgresProjectAiChat({
        projectId: project.id,
        chatId: nextChatId!,
        lastMessageAt: assistantMessage.createdAt,
      }).catch((error) => {
        console.warn("Could not update PostgreSQL AI chat metadata after assistant response:", error);
      });
      mergeChatUpdate(nextChatId!, nextChats, (chat) => ({
        ...chat,
        lastMessageAt: assistantMessage.createdAt,
        updatedAt: assistantMessage.createdAt,
        messages: chat.messages.some((message) => message.id === assistantMessage.id)
          ? chat.messages
          : [...chat.messages, assistantMessage],
      }));
      setChatError("");
    } catch (error) {
      console.error("PostgreSQL project chat failed:", error);
      setChatError(error instanceof Error ? error.message : t("aiAssist.chat.errors.noResponse"));
    } finally {
      setSending(false);
    }
  }

  if (!canUseAiChat) {
    return (
      <div className="view">
        <header className="view-header">
          <h1>{t("aiAssist.chat.pageTitle")}</h1>
        </header>
        <div className="empty-state">
          <p>{t("aiAssist.chat.noPermission")}</p>
        </div>
      </div>
    );
  }

  if (loading && !projectAiAssistSettings) {
    return (
      <div className="view ai-chat-view">
        <header className="view-header">
          <h1>{t("aiAssist.chat.pageTitle")}</h1>
        </header>
        <div className="empty-state">
          <p>{t("aiAssist.chat.loadingProjectChat")}</p>
        </div>
      </div>
    );
  }

  if (!aiAssistEnabledForProject) {
    return (
      <div className="view">
        <header className="view-header">
          <h1>{t("aiAssist.chat.pageTitle")}</h1>
        </header>
        <div className="empty-state">
          <p>{t("aiAssist.chat.enableInProjectSettings")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="view ai-chat-view">
      <header className="view-header">
        <div className="users-title-wrap">
          <h1>{t("aiAssist.chat.pageTitle")}</h1>
          <button
            type="button"
            className="users-help-icon-btn"
            aria-label={t("aiAssist.chat.openHelp")}
            title={t("aiAssist.chat.showHelp")}
            onClick={() => setHelpOpen(true)}
          >
            <HelpIcon className="users-help-icon" />
          </button>
        </div>
      </header>

      {helpOpen && (
        <SettingsModal title={t("aiAssist.chat.help.title")} onClose={() => setHelpOpen(false)} modalClassName="modal--help">
          <div className="app-settings-modal-body">
            <p className="users-guide-copy">{t("aiAssist.chat.help.line1")}</p>
            <p className="users-guide-copy">{t("aiAssist.chat.help.line2")}</p>
            <p className="users-guide-copy">{t("aiAssist.chat.help.line3")}</p>
            <p className="users-guide-copy">
              {t("aiAssist.chat.help.visibility")}
            </p>
          </div>
        </SettingsModal>
      )}

      <section className="ai-chat-layout">
        <aside className="ai-chat-sidebar-panel">
          <div className="ai-chat-sidebar-header">
            <div>
              <h2>{t("aiAssist.chat.chats")}</h2>
            </div>
            <button
              type="button"
              className="codebook-icon-action ai-chat-new-chat-button"
              onClick={() => void handleNewChat()}
              disabled={creatingChat}
              aria-label={creatingChat ? t("aiAssist.chat.startingNewChat") : t("aiAssist.chat.newChat")}
              title={creatingChat ? t("aiAssist.chat.starting") : t("aiAssist.chat.newChat")}
            >
              +
            </button>
          </div>

          <div className="ai-chat-list">
            {sortedChats.length === 0 ? (
              <div className="empty-state ai-chat-empty-state">
                <p>{t("aiAssist.chat.noChats")}</p>
              </div>
            ) : (
              sortedChats.map((chat) => {
                const lastUserMessage = getLastUserMessage(chat);
                const isReadOnlyThread = chat.createdByProjectUserId !== currentUserId && canSeeAllChats;
                return (
                  <button
                    key={chat.id}
                    type="button"
                    className={`ai-chat-list-item ${chat.id === activeChatId ? "ai-chat-list-item--active" : ""}`}
                    onClick={() => handleSelectChat(chat.id)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setContextMenu({ x: event.clientX, y: event.clientY, chatId: chat.id });
                    }}
                  >
                    <strong>{shortenChatLabel(lastUserMessage?.text ?? chat.title ?? t("aiAssist.chat.untitledChat"))}</strong>
                    {isReadOnlyThread && (
                      <small>{t("aiAssist.chat.memberChat", { owner: chat.createdByName || t("aiAssist.chat.projectMember") })}</small>
                    )}
                    <span>{formatChatTimestamp(t, lastUserMessage?.createdAt ?? chat.lastMessageAt ?? chat.updatedAt)}</span>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {contextMenu && (
          <div ref={contextMenuRef} className="context-menu" style={contextMenuStyle}>
            <button
              type="button"
              className="context-menu-item context-menu-item--danger"
              onClick={() => void handleDeleteChat(contextMenu.chatId)}
              disabled={chats.find((chat) => chat.id === contextMenu.chatId)?.createdByProjectUserId !== currentUserId}
            >
              {t("aiAssist.chat.deleteChat")}
            </button>
          </div>
        )}

        <div className="ai-chat-col-divider" aria-hidden="true" />

        <section className="ai-chat-main-panel">
          <div className="ai-chat-thread-header">
            <div>
              <h2>
                {activeChat
                  ? shortenChatLabel(getLastUserMessage(activeChat)?.text ?? activeChat.title ?? t("aiAssist.chat.untitledChat"))
                  : t("aiAssist.chat.newChat")}
              </h2>
              <p>
                {activeChat
                  ? t("aiAssist.chat.messagesInConversation", { count: activeChat.messages.length })
                  : t("aiAssist.chat.startOnRight")}
              </p>
              {activeChatReadOnly && (
                <p>{t("aiAssist.chat.viewOnlyConversation", { owner: activeChat?.createdByName || t("aiAssist.chat.anotherProjectMember") })}</p>
              )}
              <p className={`ai-chat-runtime-summary${activeRuntimeSummary ? " ai-chat-runtime-summary--ready" : " ai-chat-runtime-summary--missing"}`}>
                <span>{t("aiAssist.chat.connectedLlm")}</span>
                <strong>{formatRuntimeSummary(activeRuntimeSummary)}</strong>
              </p>
            </div>
          </div>

          {chatError && <div className="form-error project-settings-error">{chatError}</div>}

          <div className="ai-chat-thread">
            {!activeChat || activeChat.messages.length === 0 ? (
              <div className="empty-state ai-chat-empty-state">
                <p>{t("aiAssist.chat.startPrompt")}</p>
              </div>
            ) : (
              activeChat.messages.map((message) => (
                <div
                  key={message.id}
                  className={`ai-chat-message ${message.role === "assistant" ? "ai-chat-message--assistant" : "ai-chat-message--user"}`}
                >
                  <div className="ai-chat-message-meta">
                    <strong>
                      {message.role === "assistant"
                        ? t("aiAssist.chat.assistantName")
                        : message.createdByProjectUserId === currentUserId
                          ? t("aiAssist.chat.you")
                          : (message.createdByName || t("aiAssist.chat.projectMember"))}
                    </strong>
                    <span>{formatChatTimestamp(t, message.createdAt)}</span>
                  </div>
                  {message.role === "assistant" && (message.metadata?.citations?.length ?? 0) > 0
                    ? renderChatTextWithCitations(
                      message.text,
                      message.metadata?.citations ?? [],
                      (citation, citationIndex) => handleInlineCitationClick(message.id, citation, citationIndex),
                    )
                    : <p>{message.text}</p>}
                  {message.role === "assistant" && message.metadata && (
                    <div className="ai-chat-message-footnote">
                      {message.metadata.source && (
                        <span>{t("aiAssist.chat.answeredWith", { provider: providerLabel(message.metadata.source, t) })}</span>
                      )}
                      {typeof message.metadata.usedContextItems === "number" && (
                        <span>{t("aiAssist.chat.indexedItemsUsed", { count: message.metadata.usedContextItems })}</span>
                      )}
                      {message.metadata.model && <span>{t("aiAssist.chat.modelLabel", { model: message.metadata.model })}</span>}
                    </div>
                  )}
                  {message.role === "assistant" && (message.metadata?.citations?.length ?? 0) > 0 && (
                    <div className="ai-chat-citations ai-chat-citations--collapsible">
                      <div className="ai-chat-citations-toggle">
                        <div className="ai-chat-citations-title">
                          <strong>{t("aiAssist.chat.citations")}</strong>
                          <span>{message.metadata?.citations?.length ?? 0}</span>
                        </div>
                        <button type="button" className="btn ai-chat-citations-toggle-btn" onClick={() => toggleCitationOpen(message.id)}>
                          {openCitationIds[message.id] ? t("aiAssist.chat.hideCitations") : t("aiAssist.chat.showCitations")}
                        </button>
                      </div>
                      {openCitationIds[message.id] && (
                        <div className="ai-chat-citation-list">
                          {(message.metadata?.citations ?? []).map((citation, index) => {
                            const kind = getCitationKind(citation);
                            const citationKey = `${message.id}:${index}`;
                            const isHighlightedCitation = highlightedCitation?.messageId === message.id
                              && highlightedCitation.index === index;
                            return (
                              <button
                                key={citation.id}
                                ref={(node) => {
                                  citationLinkRefs.current[citationKey] = node;
                                }}
                                type="button"
                                className={`ai-chat-citation-link ai-chat-citation-link--${kind}${isHighlightedCitation ? " ai-chat-citation-link--highlighted" : ""}`}
                                onClick={() => setCitationModal({ citation, index })}
                                title={citation.preview}
                              >
                                <span className="ai-chat-citation-number">[{index + 1}]</span>
                                <span className={`ai-chat-citation-kind ai-chat-citation-kind--${kind}`}>
                                  {getCitationListBadge(citation, kind)}
                                </span>
                                <span className={`ai-chat-citation-line${["annotation", "object", "relationship"].includes(kind) ? " ai-chat-citation-line--stacked" : ""}`}>
                                  <strong>{getCitationListTitle(citation, kind)}</strong>
                                  <small>{getCitationListDetail(citation, kind)}</small>
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          <div className="ai-chat-composer">
            <label className="form-label">
              <div className="ai-chat-composer-title-row">
                <span>{t("aiAssist.chat.messageTitle")}</span>
                <div className="ai-chat-context-toolbar">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setContextPickerOpen(true);
                      setContextQuery("");
                    }}
                  >
                    {selectedContextChips.length > 0 ? t("aiAssist.chat.editContext") : t("aiAssist.chat.addContext")}
                  </button>
                  {selectedContextChips.length > 0 && (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        setSelectedContext({ documentIds: [], caseIds: [], relationshipIds: [], codeIds: [], annotationIds: [], memoIds: [] });
                        setSelectedContextMode("default");
                      }}
                    >
                      {t("aiAssist.chat.clearContext")}
                    </button>
                  )}
                </div>
              </div>
              {selectedContextChips.length > 0 && (
                <div className="ai-chat-context-chips">
                  {selectedContextChips.map((chip) => (
                    <button
                      key={`${chip.kind}:${chip.id}`}
                      type="button"
                      className="ai-chat-context-chip"
                      onClick={() => removeContextChip(chip.kind, chip.id)}
                      title={
                        chip.detail
                          ? t("aiAssist.chat.removeContextWithDetail", { detail: chip.detail })
                          : t("aiAssist.chat.removeContext")
                      }
                    >
                      <span>{chip.detail ? `${chip.detail}: ${chip.label}` : chip.label}</span>
                      <strong>x</strong>
                    </button>
                  ))}
                </div>
              )}
              <textarea
                ref={textareaRef}
                className="form-input ai-chat-textarea"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    if (!draft.trim() || sending) return;
                    void handleSendMessage();
                  }
                }}
                rows={5}
                disabled={sending}
                readOnly={activeChatReadOnly}
                placeholder={
                  activeChatReadOnly
                    ? t("aiAssist.chat.viewOnlyConversation", { owner: t("aiAssist.chat.anotherProjectMember") })
                    : t("aiAssist.chat.askPlaceholder")
                }
              />
            </label>
            <div className="form-actions">
              <button type="button" className="btn btn--primary" onClick={() => void handleSendMessage()} disabled={!draft.trim() || sending || activeChatReadOnly}>
                {sending ? t("aiAssist.chat.waitingForAiResponse") : t("aiAssist.chat.sendMessage")}
              </button>
            </div>
          </div>
        </section>
      </section>

      {citationModal ? (
        <SettingsModal
          title={t("aiAssist.chat.citationTitle", { number: citationModal.index + 1 })}
          subtitle={
            !["text-segment", "annotation", "object", "relationship"].includes(getCitationKind(citationModal.citation))
              ? formatCitationKindLabel(getCitationKind(citationModal.citation), t)
              : undefined
          }
          onClose={() => setCitationModal(null)}
          modalClassName="modal--wide ai-citation-detail-modal"
        >
            <div className="ai-citation-detail-body">
              {getCitationKind(citationModal.citation) === "text-segment" ? (
                <>
                  <div className="ai-citation-detail-summary">
                    <span>{t("aiAssist.chat.source")}</span>
                    <strong>{getTextSegmentCitationSourceTitle(citationModal.citation)}</strong>
                  </div>
                  {getTextSegmentCitationText(citationModal.citation).trim() ? (
                    <div className="ai-citation-detail-text">
                      <span>{t("aiAssist.chat.citedTextSegment")}</span>
                      <p>{getTextSegmentCitationText(citationModal.citation)}</p>
                    </div>
                  ) : null}
                </>
              ) : getCitationKind(citationModal.citation) === "annotation" ? (
                (() => {
                  const annotation = getAnnotationCitation(citationModal.citation);
                  const annotationText = getAnnotationCitationText(annotation, citationModal.citation);
                  return (
                    <>
                      <div className="ai-citation-detail-summary ai-citation-detail-summary--annotation">
                        <strong>{formatAnnotationDisplayId(annotation?.displayId)}</strong>
                        <span
                          className="annotation-code-badge"
                          style={{ background: getAnnotationCitationCode(annotation, citationModal.citation)?.color ?? "#888888" }}
                        >
                          {getAnnotationCitationCodeLabel(annotation, citationModal.citation)}
                        </span>
                      </div>
                      {annotationText.trim() ? (
                        <div className="ai-citation-detail-text ai-citation-detail-text--annotation">
                          <p style={getAnnotationCitationStyle(annotation, citationModal.citation)}>{annotationText}</p>
                        </div>
                      ) : null}
                    </>
                  );
                })()
              ) : getCitationKind(citationModal.citation) === "object" ? (
                <>
                  <div className="ai-citation-detail-summary">
                    <span>{t("aiAssist.chat.titleLabel")}</span>
                    <strong>{getObjectCitationTitle(citationModal.citation)}</strong>
                  </div>
                  {getObjectCitationDescription(citationModal.citation).trim() ? (
                    <div className="ai-citation-detail-text">
                      <span>{t("aiAssist.chat.description")}</span>
                      <p>{getObjectCitationDescription(citationModal.citation)}</p>
                    </div>
                  ) : null}
                </>
              ) : getCitationKind(citationModal.citation) === "relationship" ? (
                (() => {
                  const relationship = getRelationshipCitation(citationModal.citation);
                  const fromEndpoint = getRelationshipEndpointSummary(relationship, "from");
                  const toEndpoint = getRelationshipEndpointSummary(relationship, "to");
                  const description = getRelationshipCitationDescription(citationModal.citation);
                  return (
                    <>
                      <div className="ai-citation-detail-summary">
                        <span>{t("aiAssist.chat.type")}</span>
                        <strong>{getRelationshipCitationType(citationModal.citation)}</strong>
                      </div>
                      {description.trim() ? (
                        <div className="ai-citation-detail-text">
                          <span>{t("aiAssist.chat.description")}</span>
                          <p>{description}</p>
                        </div>
                      ) : null}
                      <div className="ai-citation-detail-grid">
                        {[fromEndpoint, toEndpoint].map((endpoint) => (
                          <div key={endpoint.label}>
                            <span>{endpoint.label}</span>
                            <strong>{endpoint.title}</strong>
                            <small>{endpoint.type}</small>
                          </div>
                        ))}
                      </div>
                    </>
                  );
                })()
              ) : (
                <>
                  <div className="ai-citation-detail-summary">
                    <span>{t("aiAssist.chat.titleLabel")}</span>
                    <strong>{formatCitationTitle(citationModal.citation.title || t("aiAssist.chat.genericCitation"))}</strong>
                  </div>
                  {citationModal.citation.preview?.trim() ? (
                    <div className="ai-citation-detail-text">
                      <span>{t("aiAssist.chat.content")}</span>
                      <p>{citationModal.citation.preview}</p>
                    </div>
                  ) : null}
                  <div className="ai-citation-detail-grid">
                    {citationMetadataRows(citationModal.citation).map((row) => (
                      <div key={row.label}>
                        <span>{row.label}</span>
                        <strong>{row.value}</strong>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
            <div className="project-export-actions project-export-actions--modal ai-citation-detail-actions">
              <button type="button" className="btn btn--primary" onClick={handleOpenCitationFromModal}>
                {t("aiAssist.chat.open")}
              </button>
            </div>
        </SettingsModal>
      ) : null}

      {contextPickerOpen && (
        <SettingsModal title={t("aiAssist.chat.addContextTitle")} onClose={() => setContextPickerOpen(false)} modalClassName="modal--wide">
          <div className="app-settings-modal-body">
            <p className="users-guide-copy">{t("aiAssist.chat.addContextBody")}</p>
            <div className="form-label" style={{ marginBottom: 16 }}>
              <span style={{ display: "block", marginBottom: 8, fontWeight: 600 }}>{t("aiAssist.chat.contextMode")}</span>
              <div className="segmented-control ai-chat-context-mode-tabs" role="tablist" aria-label={t("aiAssist.chat.contextModeAria")}>
                {([
                  ["default", t("aiAssist.chat.contextModes.default")],
                  ["prioritize", t("aiAssist.chat.contextModes.prioritize")],
                  ["restrict", t("aiAssist.chat.contextModes.restrict")],
                ] as Array<[ChatContextMode, string]>).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    role="tab"
                    aria-selected={selectedContextMode === mode}
                    className={`segmented-control-option${selectedContextMode === mode ? " segmented-control-option--active" : ""}`}
                    onClick={() => setSelectedContextMode(mode)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="users-guide-copy" style={{ marginTop: 8, marginBottom: 0 }}>
                {selectedContextMode === "restrict"
                  ? t("aiAssist.chat.restrictModeHelp")
                  : selectedContextMode === "prioritize"
                    ? t("aiAssist.chat.preferModeHelp")
                    : t("aiAssist.chat.defaultModeHelp")}
              </p>
            </div>
            {selectedContextMode !== "default" && (
              <>
                <div className="ai-chat-context-picker-summary">
                  <span>{selectedContextCount === 1 ? t("aiAssist.chat.oneSelected") : t("aiAssist.chat.selectedCount", { count: selectedContextCount })}</span>
                  {selectedContextCount > 0 ? (
                    <button
                      type="button"
                      className="btn btn--sm"
                      onClick={() => setSelectedContext({ documentIds: [], caseIds: [], relationshipIds: [], codeIds: [], annotationIds: [], memoIds: [] })}
                    >
                      {t("common.clear")}
                    </button>
                  ) : null}
                </div>
                <div className="ai-chat-context-picker-grid">
                  <div className="ai-chat-context-category-rail" role="tablist" aria-label={t("aiAssist.chat.contextItemTypes")}>
                    {contextCategoryItems.map((category) => (
                      <button
                        key={category.kind}
                        type="button"
                        role="tab"
                        aria-selected={contextTab === category.kind}
                        className={`ai-chat-context-category${contextTab === category.kind ? " ai-chat-context-category--active" : ""}`}
                        onClick={() => {
                          setContextTab(category.kind);
                          setContextQuery("");
                        }}
                      >
                        <span>
                          <strong>{category.label}</strong>
                          <small>{t("aiAssist.chat.availableCount", { count: category.count })}</small>
                        </span>
                        {category.selectedCount > 0 ? <em>{category.selectedCount}</em> : null}
                      </button>
                    ))}
                  </div>
                  <div className="ai-chat-context-picker-panel">
                    <label className="form-label">
                      {t("aiAssist.chat.searchKind", { kind: activeContextCategory.label })}
                      <input
                        className="form-input"
                        value={contextQuery}
                        onChange={(event) => setContextQuery(event.target.value)}
                        placeholder={t("aiAssist.chat.searchContext", { kind: activeContextCategory.label.toLowerCase() })}
                        autoFocus
                      />
                    </label>
                    <div className="ai-chat-context-modal-list" role="list">
                      {contextTab === "document" && filteredSources.map((source) => (
                        <label key={source.id} className="ai-chat-context-option" role="listitem">
                          <input
                            type="checkbox"
                            checked={selectedContext.documentIds.includes(source.id)}
                            onChange={() => toggleContext("document", source.id)}
                          />
                          <span>
                            <strong>{source.title}</strong>
                            <small>{source.sourceKind || t("aiAssist.chat.source")}</small>
                          </span>
                        </label>
                      ))}
                      {contextTab === "object" && filteredObjects.map((object) => (
                        <label key={object.id} className="ai-chat-context-option" role="listitem">
                          <input
                            type="checkbox"
                            checked={selectedContext.caseIds.includes(object.id)}
                            onChange={() => toggleContext("object", object.id)}
                          />
                          <span>
                            <strong>{object.title}</strong>
                            <small>{object.objectType || t("aiAssist.chat.citationKinds.object")}</small>
                          </span>
                        </label>
                      ))}
                      {contextTab === "relationship" && filteredRelationships.map((relationship) => (
                        <label key={relationship.id} className="ai-chat-context-option" role="listitem">
                          <input
                            type="checkbox"
                            checked={selectedContext.relationshipIds.includes(relationship.id)}
                            onChange={() => toggleContext("relationship", relationship.id)}
                          />
                          <span>
                            <strong>{relationship.relationshipType || t("aiAssist.chat.citationKinds.relationship")}</strong>
                            <small className="ai-chat-context-relationship-detail">
                              {relationship.fromEntityName || relationship.fromObjectId}
                              <ArrowLeftRightIcon className="ai-chat-context-relationship-icon" />
                              {relationship.toEntityName || relationship.toObjectId}
                            </small>
                          </span>
                        </label>
                      ))}
                      {contextTab === "code" && filteredCodes.map((code) => (
                        <label key={code.id} className="ai-chat-context-option" role="listitem">
                          <input
                            type="checkbox"
                            checked={selectedContext.codeIds.includes(code.id)}
                            onChange={() => toggleContext("code", code.id)}
                          />
                          <span>
                            <strong>{code.label}</strong>
                          </span>
                        </label>
                      ))}
                      {contextTab === "annotation" && filteredAnnotations.map((annotation) => {
                        const source = sourceById.get(annotation.sourceId);
                        return (
                          <label key={annotation.id} className="ai-chat-context-option" role="listitem">
                            <input
                              type="checkbox"
                              checked={selectedContext.annotationIds.includes(annotation.id)}
                              onChange={() => toggleContext("annotation", annotation.id)}
                            />
                            <span>
                              <strong>{annotationPreview(annotation.quote || annotation.note || t("aiAssist.chat.citationKinds.annotation"))}</strong>
                              <small>{annotation.primaryCodeLabel || t("aiAssist.chat.citationKinds.annotation")} in {source?.title ?? t("aiAssist.chat.sourceFallback")}</small>
                            </span>
                          </label>
                        );
                      })}
                      {contextTab === "memo" && filteredMemos.map((memo) => (
                        <label key={memo.id} className="ai-chat-context-option" role="listitem">
                          <input
                            type="checkbox"
                            checked={selectedContext.memoIds.includes(memo.id)}
                            onChange={() => toggleContext("memo", memo.id)}
                          />
                          <span>
                            <strong>{memo.title}</strong>
                            <small>{t("aiAssist.chat.citationKinds.memo")}</small>
                          </span>
                        </label>
                      ))}
                      {contextTab === "document" && filteredSources.length === 0 && (
                        <p className="users-guide-copy">{t("aiAssist.chat.noMatchingDocuments")}</p>
                      )}
                      {contextTab === "object" && filteredObjects.length === 0 && (
                        <p className="users-guide-copy">{t("aiAssist.chat.noMatchingCases")}</p>
                      )}
                      {contextTab === "relationship" && filteredRelationships.length === 0 && (
                        <p className="users-guide-copy">{t("aiAssist.chat.noMatchingRelationships")}</p>
                      )}
                      {contextTab === "code" && filteredCodes.length === 0 && (
                        <p className="users-guide-copy">{t("aiAssist.chat.noMatchingCodes")}</p>
                      )}
                      {contextTab === "annotation" && filteredAnnotations.length === 0 && (
                        <p className="users-guide-copy">{t("aiAssist.chat.noMatchingAnnotations")}</p>
                      )}
                      {contextTab === "memo" && filteredMemos.length === 0 && (
                        <p className="users-guide-copy">{t("aiAssist.chat.noMatchingMemos")}</p>
                      )}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
          <div className="app-settings-modal-footer app-settings-modal-footer--actions-only">
            <button type="button" className="btn btn--primary" onClick={() => setContextPickerOpen(false)}>
              {t("aiAssist.chat.done")}
            </button>
          </div>
        </SettingsModal>
      )}
    </div>
  );
}
