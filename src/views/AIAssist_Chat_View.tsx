import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useStore } from "../context/StoreContext";
import { readAppSettings } from "../lib/appSettings";
import { useViewportContextMenuStyle } from "../lib/contextMenu";
import { readProjectAiAssistSettings } from "../lib/projectAiAssistSettings";
import helpIcon from "../assets/ic_help_outline_24px.svg";
import {
  createChatId,
  createMessageId,
  getLastUserMessage,
  readActiveProjectAiChatId,
  readProjectAiChats,
  saveActiveProjectAiChatId,
  saveProjectAiChats,
  shortenChatLabel,
  sortProjectAiChats,
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

type OllamaProjectChatResponse = {
  content: string;
  model: string;
  baseUrl: string;
  usedContextItems: number;
  citations: OllamaProjectChatCitation[];
};

type ChatContextKind = "document" | "case" | "code" | "annotation" | "memo";

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

const CITATION_KIND_ORDER: CitationKind[] = [
  "code",
  "annotation",
  "case",
  "uncoded-text",
  "memo",
  "project-description",
  "document",
  "other",
];

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

function sortCitations(citations: OllamaProjectChatCitation[]): OllamaProjectChatCitation[] {
  return [...citations].sort((left, right) => {
    const leftKind = getCitationKind(left);
    const rightKind = getCitationKind(right);
    const kindDiff = CITATION_KIND_ORDER.indexOf(leftKind) - CITATION_KIND_ORDER.indexOf(rightKind);
    if (kindDiff !== 0) return kindDiff;
    return formatCitationTitle(left.title).localeCompare(formatCitationTitle(right.title), undefined, { sensitivity: "base" });
  });
}

function toggleString(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

function annotationPreview(value: string, maxLength = 96): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength - 1)}...`;
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
  } = useStore();
  const canUseAiChat = canCurrentUser("useAiChat");
  const aiAssistEnabledForProject = activeProject ? readProjectAiAssistSettings(activeProject.id).enabled : false;
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
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; chatId: string } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const contextMenuStyle = useViewportContextMenuStyle(contextMenu, contextMenuRef);

  useEffect(() => {
    if (!activeProject) {
      setChats([]);
      setActiveChatId(null);
      return;
    }
    const savedChats = sortProjectAiChats(readProjectAiChats(activeProject.id));
    const savedActiveChatId = readActiveProjectAiChatId(activeProject.id);
    setChats(savedChats);
    setActiveChatId(savedChats.some((chat) => chat.id === savedActiveChatId) ? savedActiveChatId : savedChats[0]?.id ?? null);
  }, [activeProject?.id]);

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
    saveProjectAiChats(activeProject.id, sorted);
    if (resolvedActiveChatId) {
      saveActiveProjectAiChatId(activeProject.id, resolvedActiveChatId);
    }
  }

  function handleNewChat() {
    const now = new Date().toISOString();
    const nextChat: ProjectAiChat = {
      id: createChatId(),
      createdAt: now,
      updatedAt: now,
      messages: [],
    };
    updateChats([nextChat, ...chats], nextChat.id);
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

  function handleDeleteChat(chatId: string) {
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
    const llmSettings = readAppSettings().llm;
    const messageText = draft.trim();
    if (!messageText) return;
    if (!llmSettings.ollamaEnabled) {
      setChatError("Enable Ollama in App Settings before using project chat.");
      return;
    }
    if (!llmSettings.ollamaSelectedModel) {
      setChatError("Choose an Ollama model in App Settings before using project chat.");
      return;
    }

    const now = new Date().toISOString();
    const userMessage = {
      id: createMessageId(),
      role: "user" as const,
      text: messageText,
      createdAt: now,
    };

    let nextChats = chats;
    let nextChatId = activeChatId;
    let conversationForRequest: Array<{ role: string; content: string }> = [];

    if (!activeChat) {
      const createdChat: ProjectAiChat = {
        id: createChatId(),
        createdAt: now,
        updatedAt: userMessage.createdAt,
        messages: [userMessage],
      };
      nextChats = [createdChat, ...chats];
      nextChatId = createdChat.id;
      conversationForRequest = [];
    } else {
      conversationForRequest = activeChat.messages.map((message) => ({
        role: message.role,
        content: message.text,
      }));
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
    setDraft("");
    setSending(true);
    setChatError("");

    try {
      const response = await invoke<OllamaProjectChatResponse>("chat_with_project_ollama", {
        request: {
          projectId: activeProject.id,
          query: messageText,
          conversation: conversationForRequest,
          protocol: llmSettings.ollamaProtocol,
          host: llmSettings.ollamaHost,
          port: llmSettings.ollamaPort,
          model: llmSettings.ollamaSelectedModel,
          timeoutSeconds: llmSettings.ollamaRequestTimeoutSeconds,
          temperature: llmSettings.ollamaTemperature,
          numCtx: llmSettings.ollamaNumCtx,
          keepAliveMinutes: llmSettings.ollamaKeepAliveMinutes,
          prefixQueries: llmSettings.prefixQueries,
          selectedDocumentIds: selectedContext.documentIds,
          selectedCaseIds: selectedContext.caseIds,
          selectedCodeIds: selectedContext.codeIds,
          selectedAnnotationIds: selectedContext.annotationIds,
          selectedMemoIds: selectedContext.memoIds,
        },
      });

      const assistantMessage = {
        id: createMessageId(),
        role: "assistant" as const,
        text: response.content,
        createdAt: new Date().toISOString(),
        metadata: {
          model: response.model,
          usedContextItems: response.usedContextItems,
          source: "ollama",
          citations: response.citations,
        },
      };

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
            <img src={helpIcon} alt="" className="users-help-icon" />
          </button>
        </div>
      </header>

      {helpOpen && (
        <div className="modal-overlay" onClick={() => setHelpOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>AI Assist Chat Help</h2>
            <p className="users-guide-copy">
              Use chat to ask grounded questions about the current project using your local AI Assist index.
            </p>
            <p className="users-guide-copy">
              Citations in responses let you jump back to the supporting project material, including documents, coded text, annotations, and memos.
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
              onClick={() => handleDeleteChat(contextMenu.chatId)}
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
                    <strong>{message.role === "assistant" ? "AI Assist" : "You"}</strong>
                    <span>{formatChatTimestamp(message.createdAt)}</span>
                  </div>
                  <p>{message.text}</p>
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
                    <div className="ai-chat-citations">
                      <strong>Citations</strong>
                      <div className="ai-chat-citation-list">
                        {sortCitations(message.metadata?.citations ?? []).map((citation) => {
                          const kind = getCitationKind(citation);
                          return (
                            <button
                              key={citation.id}
                              type="button"
                              className={`ai-chat-citation-link ai-chat-citation-link--${kind}`}
                              onClick={() => handleOpenCitation(citation)}
                              title={citation.preview}
                            >
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
                    </div>
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
                    onClick={() => setSelectedContext({ documentIds: [], caseIds: [], codeIds: [], annotationIds: [], memoIds: [] })}
                  >
                    Clear Context
                  </button>
                )}
              </div>
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
                placeholder="Ask a question about this project..."
                rows={5}
                disabled={sending}
              />
            </label>
            <div className="form-actions">
              <button type="button" className="btn btn--primary" onClick={() => void handleSendMessage()} disabled={!draft.trim() || sending}>
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
              Selected cases, documents, codes, annotations, and memos will be prioritized when AI Assist retrieves context for your next messages.
            </p>
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
