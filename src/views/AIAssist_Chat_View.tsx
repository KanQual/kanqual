import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../context/StoreContext";
import { readAppSettings } from "../lib/appSettings";
import { useViewportContextMenuStyle } from "../lib/contextMenu";
import { HelpIcon } from "../components/AppIcons";
import {
  clearActiveProjectAiChatId,
  createProjectAiChat,
  createProjectAiChatMessage,
  deleteProjectAiChat,
  getLastUserMessage,
  loadProjectAiChats,
  migrateLegacyProjectAiChatsToBackend,
  readActiveProjectAiChatId,
  saveActiveProjectAiChatId,
  shortenChatLabel,
  sortProjectAiChats,
  touchProjectAiChat,
  type ProjectAiChat,
} from "../lib/projectAiChats";

type OllamaProjectChatCitation = {
  id: string;
  itemType: string;
  title: string;
  preview: string;
  documentId?: string | null;
  caseId?: string | null;
  codeId?: string | null;
  annotationId?: string | null;
  memoId?: string | null;
  startOffset?: number | null;
  endOffset?: number | null;
};

type ChatContextKind = "document" | "case" | "code" | "annotation" | "memo";
type ChatContextMode = "prioritize" | "restrict";

type SelectedChatContextState = {
  documentIds: string[];
  caseIds: string[];
  codeIds: string[];
  annotationIds: string[];
  memoIds: string[];
};

function formatChatTimestamp(value: string | null | undefined): string {
  if (!value) return "No messages yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatCitationTitle(title: string): string {
  return title.replace(/\s+\(chunk\s+\d+\)$/i, "").trim();
}

type CitationKind =
  | "annotation"
  | "case"
  | "code"
  | "uncoded-text"
  | "memo"
  | "project-description"
  | "document"
  | "other";

function getCitationKind(citation: OllamaProjectChatCitation): CitationKind {
  if (citation.itemType === "code") return "code";
  if (citation.itemType === "annotation" || citation.annotationId) return "annotation";
  if (citation.itemType === "case" || citation.caseId) return "case";
  if (citation.itemType === "memo") return "memo";
  if (citation.itemType === "project-description" || citation.itemType === "project_description") return "project-description";
  if (citation.itemType === "document" && typeof citation.startOffset === "number" && typeof citation.endOffset === "number") {
    return "uncoded-text";
  }
  if (citation.itemType === "document") return "document";
  return "other";
}

function formatCitationKindLabel(kind: CitationKind): string {
  if (kind === "uncoded-text") return "Text";
  if (kind === "project-description") return "Project Description";
  if (kind === "code") return "Code";
  if (kind === "annotation") return "Annotation";
  if (kind === "case") return "Case";
  if (kind === "memo") return "Memo";
  if (kind === "document") return "Text";
  return "Source";
}

function toggleString(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

function annotationPreview(value: string, maxLength = 96): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength - 1)}...`;
}

function renderChatTextWithCitations(
  text: string,
  citations: OllamaProjectChatCitation[],
  onClick: (citation: OllamaProjectChatCitation) => void,
): React.ReactNode {
  const paragraphs = text.split(/\n{2,}/).filter((part) => part.trim().length > 0);
  return paragraphs.map((paragraph, paragraphIndex) => {
    const parts: React.ReactNode[] = [];
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
          onClick={() => onClick(citation)}
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

export function AIAssistChatView() {
  const {
    activeProject,
    setView,
    canCurrentUser,
    documents,
    cases,
    codes,
    annotations,
    memos,
    setActiveDocument,
    setPendingAnnId,
    setPendingCaseId,
    setPendingCodeId,
    setPendingMemoId,
    setPendingTextCitation,
    projectAiAssistSettings,
    isLocalWorkspace,
    runProjectChat,
    pb,
    userRole,
    appRole,
    isAdministrator,
    logAction,
  } = useStore();
  const canUseAiChat = canCurrentUser("useAiChat");
  const aiAssistEnabledForProject = activeProject ? projectAiAssistSettings.enabled : false;
  const [chats, setChats] = useState<ProjectAiChat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const [contextPickerOpen, setContextPickerOpen] = useState(false);
  const [contextTab, setContextTab] = useState<ChatContextKind>("document");
  const [contextQuery, setContextQuery] = useState("");
  const [selectedContext, setSelectedContext] = useState<SelectedChatContextState>({
    documentIds: [],
    caseIds: [],
    codeIds: [],
    annotationIds: [],
    memoIds: [],
  });
  const [selectedContextMode, setSelectedContextMode] = useState<ChatContextMode>("prioritize");
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; chatId: string } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const contextMenuStyle = useViewportContextMenuStyle(contextMenu, contextMenuRef);
  const currentUserId = pb.authStore.record?.id ?? "";
  const currentUserIdentifier = pb.authStore.record?.user_identifier || "";
  const currentUserName = pb.authStore.record?.name || pb.authStore.record?.email || "You";
  const canSeeAllChats = isAdministrator || userRole === "owner" || userRole === "editor";

  useEffect(() => {
    let cancelled = false;
    let unsubChats: (() => void) | null = null;
    let unsubMessages: (() => void) | null = null;

    async function refreshChats() {
      if (!activeProject || !currentUserId) {
        if (!cancelled) {
          setChats([]);
          setActiveChatId(null);
        }
        return;
      }

      await migrateLegacyProjectAiChatsToBackend(pb, {
        projectId: activeProject.id,
        currentUserId,
        currentUserIdentifier,
        currentUserName,
        appRole,
        projectRole: userRole,
      });

      const savedChats = await loadProjectAiChats(pb, {
        projectId: activeProject.id,
        currentUserId,
        appRole,
        projectRole: userRole,
      });
      if (cancelled) return;
      const savedActiveChatId = readActiveProjectAiChatId(activeProject.id);
      const nextActiveChatId = savedChats.some((chat) => chat.id === savedActiveChatId)
        ? savedActiveChatId
        : savedChats[0]?.id ?? null;
      setChats(savedChats);
      setActiveChatId(nextActiveChatId);
      if (nextActiveChatId) saveActiveProjectAiChatId(activeProject.id, nextActiveChatId);
      else clearActiveProjectAiChatId(activeProject.id);
    }

    if (!activeProject) {
      setChats([]);
      setActiveChatId(null);
      return;
    }

    void refreshChats();

    void pb.collection("project_ai_chats").subscribe("*", (event) => {
      if (event.record?.project === activeProject.id) void refreshChats();
    }).then((unsub) => {
      unsubChats = unsub;
    });

    void pb.collection("project_ai_chat_messages").subscribe("*", (event) => {
      if (event.record?.project === activeProject.id) void refreshChats();
    }).then((unsub) => {
      unsubMessages = unsub;
    });

    return () => {
      cancelled = true;
      unsubChats?.();
      unsubMessages?.();
    };
  }, [activeProject?.id, appRole, currentUserId, currentUserIdentifier, currentUserName, pb, userRole]);

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

  const sortedChats = useMemo(() => sortProjectAiChats(chats), [chats]);
  const activeChat = sortedChats.find((chat) => chat.id === activeChatId) ?? null;
  const activeChatReadOnly = !!(activeChat && activeChat.createdById && activeChat.createdById !== currentUserId && canSeeAllChats);
  const documentById = useMemo(() => new Map(documents.map((document) => [document.id, document])), [documents]);
  const caseById = useMemo(() => new Map(cases.map((caseItem) => [caseItem.id, caseItem])), [cases]);
  const codeById = useMemo(() => new Map(codes.map((code) => [code.id, code])), [codes]);
  const memoById = useMemo(() => new Map(memos.map((memo) => [memo.id, memo])), [memos]);

  const selectedContextChips = useMemo(() => {
    const chips: Array<{ kind: ChatContextKind; id: string; label: string; detail?: string }> = [];

    for (const documentId of selectedContext.documentIds) {
      const document = documentById.get(documentId);
      if (!document) continue;
      chips.push({
        kind: "document",
        id: documentId,
        label: document.name,
        detail: "Document",
      });
    }

    for (const caseId of selectedContext.caseIds) {
      const caseItem = caseById.get(caseId);
      if (!caseItem) continue;
      chips.push({
        kind: "case",
        id: caseId,
        label: caseItem.name,
        detail: "Case",
      });
    }

    for (const codeId of selectedContext.codeIds) {
      const code = codeById.get(codeId);
      if (!code) continue;
      chips.push({
        kind: "code",
        id: codeId,
        label: code.label,
        detail: "Code",
      });
    }

    for (const annotationId of selectedContext.annotationIds) {
      const annotation = annotations.find((item) => item.id === annotationId);
      if (!annotation) continue;
      const code = codeById.get(annotation.codeId);
      const document = documentById.get(annotation.documentId);
      chips.push({
        kind: "annotation",
        id: annotationId,
        label: annotationPreview(annotation.quote || annotation.note || "Annotation"),
        detail: `${code?.label ?? "Annotation"} in ${document?.name ?? "document"}`,
      });
    }

    for (const memoId of selectedContext.memoIds) {
      const memo = memoById.get(memoId);
      if (!memo) continue;
      const document = memo.documentId ? documentById.get(memo.documentId) : undefined;
      chips.push({
        kind: "memo",
        id: memoId,
        label: memo.title,
        detail: document?.name ? `Memo in ${document.name}` : "Memo",
      });
    }

    return chips;
  }, [annotations, caseById, codeById, documentById, memoById, selectedContext]);

  const filteredDocuments = useMemo(() => {
    const query = contextQuery.trim().toLowerCase();
    if (!query) return documents;
    return documents.filter((document) => document.name.toLowerCase().includes(query));
  }, [contextQuery, documents]);

  const filteredCases = useMemo(() => {
    const query = contextQuery.trim().toLowerCase();
    if (!query) return cases;
    return cases.filter((caseItem) =>
      caseItem.name.toLowerCase().includes(query)
      || caseItem.notes.toLowerCase().includes(query),
    );
  }, [cases, contextQuery]);

  const filteredCodes = useMemo(() => {
    const query = contextQuery.trim().toLowerCase();
    if (!query) return codes;
    return codes.filter((code) =>
      code.label.toLowerCase().includes(query)
      || code.description.toLowerCase().includes(query),
    );
  }, [codes, contextQuery]);

  const filteredAnnotations = useMemo(() => {
    const query = contextQuery.trim().toLowerCase();
    if (!query) return annotations;
    return annotations.filter((annotation) => {
      const code = codeById.get(annotation.codeId);
      const document = documentById.get(annotation.documentId);
      return (
        annotation.quote.toLowerCase().includes(query)
        || annotation.note.toLowerCase().includes(query)
        || (code?.label.toLowerCase().includes(query) ?? false)
        || (document?.name.toLowerCase().includes(query) ?? false)
      );
    });
  }, [annotations, codeById, contextQuery, documentById]);

  const filteredMemos = useMemo(() => {
    const query = contextQuery.trim().toLowerCase();
    if (!query) return memos;
    return memos.filter((memo) =>
      memo.title.toLowerCase().includes(query)
      || memo.body.toLowerCase().includes(query),
    );
  }, [contextQuery, memos]);

  function updateChats(nextChats: ProjectAiChat[], nextActiveChatId?: string | null) {
    if (!activeProject) return;
    const sorted = sortProjectAiChats(nextChats);
    setChats(sorted);
    const resolvedActiveChatId = nextActiveChatId ?? activeChatId ?? sorted[0]?.id ?? null;
    setActiveChatId(resolvedActiveChatId);
    if (resolvedActiveChatId) {
      saveActiveProjectAiChatId(activeProject.id, resolvedActiveChatId);
    } else {
      clearActiveProjectAiChatId(activeProject.id);
    }
  }

  function handleNewChat() {
    setActiveChatId(null);
    if (activeProject) clearActiveProjectAiChatId(activeProject.id);
    setDraft("");
    setChatError("");
  }

  function handleSelectChat(chatId: string) {
    if (!activeProject) return;
    setActiveChatId(chatId);
    saveActiveProjectAiChatId(activeProject.id, chatId);
    setChatError("");
    setContextMenu(null);
  }

  async function handleDeleteChat(chatId: string) {
    const targetChat = chats.find((chat) => chat.id === chatId);
    if (!targetChat || targetChat.createdById !== currentUserId) {
      setContextMenu(null);
      return;
    }
    await deleteProjectAiChat(pb, chatId);
    const remainingChats = chats.filter((chat) => chat.id !== chatId);
    const nextActiveChatId = activeChatId === chatId ? (remainingChats[0]?.id ?? null) : activeChatId;
    updateChats(remainingChats, nextActiveChatId);
    setContextMenu(null);
    setChatError("");
  }

  function toggleContext(kind: ChatContextKind, id: string) {
    setSelectedContext((current) => {
      if (kind === "document") {
        return { ...current, documentIds: toggleString(current.documentIds, id) };
      }
      if (kind === "case") {
        return { ...current, caseIds: toggleString(current.caseIds, id) };
      }
      if (kind === "code") {
        return { ...current, codeIds: toggleString(current.codeIds, id) };
      }
      if (kind === "annotation") {
        return { ...current, annotationIds: toggleString(current.annotationIds, id) };
      }
      return { ...current, memoIds: toggleString(current.memoIds, id) };
    });
  }

  function removeContextChip(kind: ChatContextKind, id: string) {
    setSelectedContext((current) => {
      if (kind === "document") {
        return { ...current, documentIds: current.documentIds.filter((item) => item !== id) };
      }
      if (kind === "case") {
        return { ...current, caseIds: current.caseIds.filter((item) => item !== id) };
      }
      if (kind === "code") {
        return { ...current, codeIds: current.codeIds.filter((item) => item !== id) };
      }
      if (kind === "annotation") {
        return { ...current, annotationIds: current.annotationIds.filter((item) => item !== id) };
      }
      return { ...current, memoIds: current.memoIds.filter((item) => item !== id) };
    });
  }

  function handleOpenCitation(citation: OllamaProjectChatCitation) {
    if (citation.codeId && getCitationKind(citation) === "code") {
      setPendingAnnId(null);
      setPendingTextCitation(null);
      setPendingCodeId(citation.codeId);
      setView("codebook");
      setChatError("");
      return;
    }

    if (citation.caseId && getCitationKind(citation) === "case") {
      setPendingAnnId(null);
      setPendingTextCitation(null);
      setPendingCaseId(citation.caseId);
      setView("cases");
      setChatError("");
      return;
    }

    if (citation.memoId && getCitationKind(citation) === "memo") {
      setPendingAnnId(null);
      setPendingTextCitation(null);
      setPendingMemoId(citation.memoId);
      setView("memos");
      setChatError("");
      return;
    }

    const targetDocumentId =
      citation.documentId
      ?? (citation.annotationId ? annotations.find((item) => item.id === citation.annotationId)?.documentId : undefined)
      ?? (citation.codeId ? annotations.find((item) => item.codeId === citation.codeId)?.documentId : undefined);

    if (!targetDocumentId) {
      setChatError("This citation does not point to a document that can be opened in Code Text.");
      return;
    }

    const targetDocument = documents.find((item) => item.id === targetDocumentId);
    if (!targetDocument) {
      setChatError("The cited document is not currently available in this project.");
      return;
    }

    setActiveDocument(targetDocument);
    setChatError("");

    if (citation.annotationId) {
      setPendingTextCitation(null);
      setPendingAnnId(citation.annotationId);
      setView("code-text");
      return;
    }

    if (
      typeof citation.startOffset === "number"
      && typeof citation.endOffset === "number"
      && citation.endOffset > citation.startOffset
    ) {
      setPendingAnnId(null);
      setPendingTextCitation({
        documentId: targetDocument.id,
        startOffset: citation.startOffset,
        endOffset: citation.endOffset,
        label: citation.title,
      });
      setView("code-text");
      return;
    }

    const fallbackAnnotation = citation.codeId
      ? annotations.find((item) => item.codeId === citation.codeId && item.documentId === targetDocument.id)
      : annotations.find((item) => item.documentId === targetDocument.id);

    if (fallbackAnnotation) {
      setPendingTextCitation(null);
      setPendingAnnId(fallbackAnnotation.id);
      setView("code-text");
      return;
    }

    setPendingAnnId(null);
    setPendingTextCitation(null);
    setView("code-text");
    setChatError("Opened the cited document, but there was no exact annotation or text span to highlight for this citation.");
  }

  async function handleSendMessage() {
    if (!activeProject) return;
    if (!currentUserId) {
      setChatError("You must be signed in to send project chat messages.");
      return;
    }
    if (activeChatReadOnly) {
      setChatError("This conversation is read-only for your role. Start your own chat to continue.");
      return;
    }
    const messageText = draft.trim();
    if (!messageText) return;
    if (isLocalWorkspace) {
      const llmSettings = readAppSettings().llm;
      if (!llmSettings.ollamaEnabled) {
        setChatError("Enable Ollama in App Settings before using project chat.");
        return;
      }
      if (!llmSettings.ollamaSelectedModel) {
        setChatError("Choose an Ollama model in App Settings before using project chat.");
        return;
      }
    }

    let nextChats = chats;
    let nextChatId = activeChatId;
    let conversationForRequest: Array<{ role: string; content: string }> = [];
    let targetChatTitle = shortenChatLabel(messageText);
    let createdChatId: string | null = null;
    setSending(true);
    setChatError("");

    try {
      if (!activeChat) {
        const createdChat = await createProjectAiChat(pb, {
          projectId: activeProject.id,
          createdById: currentUserId,
          createdByIdentifier: currentUserIdentifier,
          createdByName: currentUserName,
          initialTitle: targetChatTitle,
        });
        createdChatId = createdChat.id;
        const userMessage = await createProjectAiChatMessage(pb, {
          chatId: createdChat.id,
          projectId: activeProject.id,
          role: "user",
          text: messageText,
          createdById: currentUserId,
          createdByIdentifier: currentUserIdentifier,
          createdByName: currentUserName,
        });
        nextChats = [createdChat, ...chats];
        nextChats = nextChats.map((chat) => (
          chat.id === createdChat.id
            ? { ...chat, updatedAt: userMessage.createdAt, messages: [userMessage] }
            : chat
        ));
        nextChatId = createdChat.id;
        conversationForRequest = [];
      } else {
        targetChatTitle = activeChat.title || targetChatTitle;
        conversationForRequest = activeChat.messages.map((message) => ({
          role: message.role,
          content: message.text,
        }));
        const userMessage = await createProjectAiChatMessage(pb, {
          chatId: activeChat.id,
          projectId: activeProject.id,
          role: "user",
          text: messageText,
          createdById: currentUserId,
          createdByIdentifier: currentUserIdentifier,
          createdByName: currentUserName,
        });
        await touchProjectAiChat(pb, {
          chatId: activeChat.id,
          lastMessageAt: userMessage.createdAt,
        });
        nextChats = chats.map((chat) => (
          chat.id === activeChat.id
            ? {
                ...chat,
                updatedAt: userMessage.createdAt,
                messages: [...chat.messages, userMessage],
              }
            : chat
        ));
        nextChatId = activeChat.id;
      }

      updateChats(nextChats, nextChatId);
      await logAction(
        activeProject.id,
        "project.ai_chat.message",
        `Sent AI chat message in "${targetChatTitle}"`,
        nextChatId ?? createdChatId ?? undefined,
      );
      setDraft("");

      const response = await runProjectChat({
        projectId: activeProject.id,
        query: messageText,
        conversation: conversationForRequest,
        selectedContextMode,
        selectedDocumentIds: selectedContext.documentIds,
        selectedCaseIds: selectedContext.caseIds,
        selectedCodeIds: selectedContext.codeIds,
        selectedAnnotationIds: selectedContext.annotationIds,
        selectedMemoIds: selectedContext.memoIds,
      }, (progressMessage) => {
        setChatError(progressMessage);
      });

      const assistantMessage = await createProjectAiChatMessage(pb, {
        chatId: nextChatId!,
        projectId: activeProject.id,
        role: "assistant",
        text: response.content,
        metadata: {
          model: response.model,
          usedContextItems: response.usedContextItems,
          source: "ollama",
          citations: response.citations,
        },
      });
      await touchProjectAiChat(pb, {
        chatId: nextChatId!,
        lastMessageAt: assistantMessage.createdAt,
      });
      await logAction(
        activeProject.id,
        "project.ai_chat.response",
        `Received AI chat response in "${targetChatTitle}"`,
        nextChatId ?? createdChatId ?? undefined,
      );

      const refreshedChats = nextChats.map((chat) => (
        chat.id === nextChatId
          ? {
              ...chat,
              updatedAt: assistantMessage.createdAt,
              messages: [...chat.messages, assistantMessage],
            }
          : chat
      ));
      updateChats(refreshedChats, nextChatId);
      setChatError("");
    } catch (error) {
      console.error("Project chat with Ollama failed:", error);
      setChatError(error instanceof Error ? error.message : "Could not get a response from Ollama.");
    } finally {
      setSending(false);
    }
  }

  if (!activeProject) {
    return (
      <div className="view">
        <header className="view-header">
          <h1>Project Chat</h1>
        </header>
        <div className="empty-state">
          <p>Open a project first.</p>
        </div>
      </div>
    );
  }

  if (!canUseAiChat) {
    return (
      <div className="view">
        <header className="view-header">
          <h1>Chat About Your Project</h1>
        </header>
        <div className="empty-state">
          <p>You do not have permission to use AI Assist chat for this project.</p>
        </div>
      </div>
    );
  }

  if (!aiAssistEnabledForProject) {
    return (
      <div className="view">
        <header className="view-header">
          <h1>Chat About Your Project</h1>
        </header>
        <div className="empty-state">
          <p>Enable AI Assist in Project Settings before using project chat.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="view ai-chat-view">
      <header className="view-header">
        <div className="users-title-wrap">
          <h1>Chat About Your Project</h1>
          <button
            type="button"
            className="users-help-icon-btn"
            aria-label="Show AI Assist chat help"
            title="Show Help"
            onClick={() => setHelpOpen(true)}
          >
            <HelpIcon className="users-help-icon" />
          </button>
        </div>
      </header>

      {helpOpen && (
        <div className="modal-overlay" onClick={() => setHelpOpen(false)}>
          <div className="modal modal--help" onClick={(e) => e.stopPropagation()}>
            <h2>AI Assist Chat Help</h2>
            <p className="users-guide-copy">
              Create a chat, send a prompt, switch between chats, add context to a chat, review citations in responses, delete your own chats, and supervise other users' chats when your role allows it.
            </p>
            <p className="users-guide-copy">
              Use chat to ask grounded questions about the current project. Choose or create a chat, send a prompt, and inspect cited responses that point back to project evidence.
            </p>
            <p className="users-guide-copy">
              Owners, editors, and administrators can view all project chats; coders and viewers only see their own. Supervisors can view but should not reply inside another user's private thread. Chat activity is logged in the project log.
            </p>
            <div className="form-actions">
              <button type="button" className="btn btn--primary" onClick={() => setHelpOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <section className="ai-chat-layout">
        <aside className="ai-chat-sidebar-panel">
          <div className="ai-chat-sidebar-header">
            <div>
            </div>
            <button type="button" className="btn btn--primary" onClick={handleNewChat}>
              New Chat
            </button>
          </div>

          <div className="ai-chat-list">
            {sortedChats.length === 0 ? (
              <div className="empty-state ai-chat-empty-state">
                <p>No project chats yet. Start a new chat to begin.</p>
              </div>
            ) : (
              sortedChats.map((chat) => {
                const lastUserMessage = getLastUserMessage(chat);
                const isReadOnlyThread = chat.createdById !== currentUserId && canSeeAllChats;
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
                    <strong>{shortenChatLabel(lastUserMessage?.text ?? "Untitled chat")}</strong>
                    {isReadOnlyThread && <small>{chat.createdByName || "Project member"}'s chat</small>}
                    <span>{formatChatTimestamp(lastUserMessage?.createdAt ?? chat.updatedAt)}</span>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {contextMenu && (
          <div
            ref={contextMenuRef}
            className="context-menu"
            style={contextMenuStyle}
          >
            <button
              type="button"
              className="context-menu-item context-menu-item--danger"
              onClick={() => void handleDeleteChat(contextMenu.chatId)}
              disabled={chats.find((chat) => chat.id === contextMenu.chatId)?.createdById !== currentUserId}
            >
              Delete Chat
            </button>
          </div>
        )}

        <div className="ai-chat-col-divider" aria-hidden="true" />

        <section className="ai-chat-main-panel">
            <div className="ai-chat-thread-header">
              <div>
                <h2>{activeChat ? shortenChatLabel(getLastUserMessage(activeChat)?.text ?? "Untitled chat") : "New chat"}</h2>
                <p>{activeChat ? `${activeChat.messages.length} messages in this conversation` : "Start a project chat on the right."}</p>
                {activeChatReadOnly && (
                  <p>This conversation belongs to {activeChat?.createdByName || "another project member"} and is view-only for your role.</p>
                )}
              </div>
            </div>

          {chatError && <div className="form-error project-settings-error">{chatError}</div>}

          <div className="ai-chat-thread">
            {!activeChat || activeChat.messages.length === 0 ? (
              <div className="empty-state ai-chat-empty-state">
                <p>Start by asking something about your project. This workspace will keep the chat history in the left column.</p>
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
                        ? "AI Assist"
                        : message.createdById === currentUserId
                          ? "You"
                          : (message.createdByName || "Project member")}
                    </strong>
                    <span>{formatChatTimestamp(message.createdAt)}</span>
                  </div>
                  {message.role === "assistant" && (message.metadata?.citations?.length ?? 0) > 0
                    ? renderChatTextWithCitations(message.text, message.metadata?.citations ?? [], handleOpenCitation)
                    : <p>{message.text}</p>}
                  {message.role === "assistant" && message.metadata && (
                    <div className="ai-chat-message-footnote">
                      {message.metadata.source === "ollama" && <span>Answered with Ollama</span>}
                      {typeof message.metadata.usedContextItems === "number" && (
                        <span>{message.metadata.usedContextItems} indexed project items used</span>
                      )}
                      {message.metadata.model && <span>Model: {message.metadata.model}</span>}
                    </div>
                  )}
                  {message.role === "assistant" && (message.metadata?.citations?.length ?? 0) > 0 && (
                    <details className="ai-chat-citations ai-chat-citations--collapsible">
                      <summary className="ai-chat-citations-toggle">
                        <strong>Citations</strong>
                        <span>{message.metadata?.citations?.length ?? 0}</span>
                      </summary>
                      <div className="ai-chat-citation-list">
                        {(message.metadata?.citations ?? []).map((citation, index) => {
                          const kind = getCitationKind(citation);
                          return (
                            <button
                              key={citation.id}
                              type="button"
                              className={`ai-chat-citation-link ai-chat-citation-link--${kind}`}
                              onClick={() => handleOpenCitation(citation)}
                              title={citation.preview}
                            >
                              <span className="ai-chat-citation-number">[{index + 1}]</span>
                              <span className={`ai-chat-citation-kind ai-chat-citation-kind--${kind}`}>
                                {formatCitationKindLabel(kind)}
                              </span>
                              <span className="ai-chat-citation-line">
                                <strong>{formatCitationTitle(citation.title)}</strong>
                                <small>{citation.preview}</small>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </details>
                  )}
                </div>
              ))
            )}
          </div>

          <div className="ai-chat-composer">
            <label className="form-label">
              Message
              <div className="ai-chat-context-toolbar">
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setContextPickerOpen(true);
                    setContextQuery("");
                  }}
                >
                  Add Context
                </button>
                {selectedContextChips.length > 0 && (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setSelectedContext({ documentIds: [], caseIds: [], codeIds: [], annotationIds: [], memoIds: [] });
                      setSelectedContextMode("prioritize");
                    }}
                  >
                    Clear Context
                  </button>
                )}
              </div>
              {selectedContextChips.length > 0 && (
                <p className="backup-field-hint" style={{ margin: "4px 0 8px" }}>
                  Context mode: {selectedContextMode === "restrict" ? "Restrict to selected context" : "Prioritize selected context"}
                </p>
              )}
              {selectedContextChips.length > 0 && (
                <div className="ai-chat-context-chips">
                  {selectedContextChips.map((chip) => (
                    <button
                      key={`${chip.kind}:${chip.id}`}
                      type="button"
                      className="ai-chat-context-chip"
                      onClick={() => removeContextChip(chip.kind, chip.id)}
                      title={chip.detail ? `${chip.detail} - click to remove` : "Click to remove"}
                    >
                      <span>{chip.detail ? `${chip.detail}: ${chip.label}` : chip.label}</span>
                      <strong>×</strong>
                    </button>
                  ))}
                </div>
              )}
              <textarea
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
                placeholder={activeChatReadOnly ? "This conversation is view-only for your role." : "Ask a question about this project..."}
              />
            </label>
            <div className="form-actions">
              <button type="button" className="btn btn--primary" onClick={() => void handleSendMessage()} disabled={!draft.trim() || sending || activeChatReadOnly}>
                {sending ? "Waiting for Ollama..." : "Send Message"}
              </button>
            </div>
          </div>
        </section>
      </section>

      {contextPickerOpen && (
        <div className="modal-overlay" onClick={() => setContextPickerOpen(false)}>
          <div className="modal modal--wide" onClick={(event) => event.stopPropagation()}>
            <h2>Add Context</h2>
            <p className="users-guide-copy">
              Select cases, documents, codes, annotations, or memos for your next messages, then choose whether AI Assist should prioritize them or restrict retrieval to them.
            </p>
            <div className="form-label" style={{ marginBottom: 16 }}>
              <span style={{ display: "block", marginBottom: 8, fontWeight: 600 }}>Context Mode</span>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className={`btn${selectedContextMode === "prioritize" ? " btn--primary" : ""}`}
                  onClick={() => setSelectedContextMode("prioritize")}
                >
                  Prioritize
                </button>
                <button
                  type="button"
                  className={`btn${selectedContextMode === "restrict" ? " btn--primary" : ""}`}
                  onClick={() => setSelectedContextMode("restrict")}
                >
                  Restrict
                </button>
              </div>
              <p className="users-guide-copy" style={{ marginTop: 8, marginBottom: 0 }}>
                {selectedContextMode === "restrict"
                  ? "Only the selected context will be retrieved and cited."
                  : "Selected context will be preferred, but AI Assist may still use other project context if it is more relevant."}
              </p>
            </div>
            <div className="ai-chat-context-modal-tabs" role="tablist" aria-label="Context item types">
              {([
                ["document", `Documents (${documents.length})`],
                ["case", `Cases (${cases.length})`],
                ["code", `Codes (${codes.length})`],
                ["annotation", `Annotations (${annotations.length})`],
                ["memo", `Memos (${memos.length})`],
              ] as Array<[ChatContextKind, string]>).map(([tab, label]) => (
                <button
                  key={tab}
                  type="button"
                  className={`btn${contextTab === tab ? " btn--primary" : ""}`}
                  onClick={() => setContextTab(tab)}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="form-label">
              Search
              <input
                className="form-input"
                value={contextQuery}
                onChange={(event) => setContextQuery(event.target.value)}
                placeholder={`Search ${contextTab}s...`}
                autoFocus
              />
            </label>
            <div className="ai-chat-context-modal-list" role="list">
              {contextTab === "document" && filteredDocuments.map((document) => (
                <label key={document.id} className="ai-chat-context-option" role="listitem">
                  <input
                    type="checkbox"
                    checked={selectedContext.documentIds.includes(document.id)}
                    onChange={() => toggleContext("document", document.id)}
                  />
                  <span>
                    <strong>{document.name}</strong>
                    <small>Document</small>
                  </span>
                </label>
              ))}
              {contextTab === "case" && filteredCases.map((caseItem) => (
                <label key={caseItem.id} className="ai-chat-context-option" role="listitem">
                  <input
                    type="checkbox"
                    checked={selectedContext.caseIds.includes(caseItem.id)}
                    onChange={() => toggleContext("case", caseItem.id)}
                  />
                  <span>
                    <strong>{caseItem.name}</strong>
                    <small>Case</small>
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
                    <small>{code.description || "Code"}</small>
                  </span>
                </label>
              ))}
              {contextTab === "annotation" && filteredAnnotations.map((annotation) => {
                const code = codeById.get(annotation.codeId);
                const document = documentById.get(annotation.documentId);
                return (
                  <label key={annotation.id} className="ai-chat-context-option" role="listitem">
                    <input
                      type="checkbox"
                      checked={selectedContext.annotationIds.includes(annotation.id)}
                      onChange={() => toggleContext("annotation", annotation.id)}
                    />
                    <span>
                      <strong>{annotationPreview(annotation.quote || annotation.note || "Annotation")}</strong>
                      <small>{code?.label ?? "Annotation"} in {document?.name ?? "document"}</small>
                    </span>
                  </label>
                );
              })}
              {contextTab === "memo" && filteredMemos.map((memo) => {
                const document = memo.documentId ? documentById.get(memo.documentId) : undefined;
                return (
                  <label key={memo.id} className="ai-chat-context-option" role="listitem">
                    <input
                      type="checkbox"
                      checked={selectedContext.memoIds.includes(memo.id)}
                      onChange={() => toggleContext("memo", memo.id)}
                    />
                    <span>
                      <strong>{memo.title}</strong>
                      <small>{document?.name ? `Memo in ${document.name}` : "Memo"}</small>
                    </span>
                  </label>
                );
              })}
              {contextTab === "document" && filteredDocuments.length === 0 && (
                <p className="users-guide-copy">No documents matched your search.</p>
              )}
              {contextTab === "case" && filteredCases.length === 0 && (
                <p className="users-guide-copy">No cases matched your search.</p>
              )}
              {contextTab === "code" && filteredCodes.length === 0 && (
                <p className="users-guide-copy">No codes matched your search.</p>
              )}
              {contextTab === "annotation" && filteredAnnotations.length === 0 && (
                <p className="users-guide-copy">No annotations matched your search.</p>
              )}
              {contextTab === "memo" && filteredMemos.length === 0 && (
                <p className="users-guide-copy">No memos matched your search.</p>
              )}
            </div>
            <div className="form-actions">
              <button type="button" className="btn" onClick={() => setContextPickerOpen(false)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
