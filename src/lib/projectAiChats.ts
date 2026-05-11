export type ProjectAiChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  metadata?: {
    model?: string;
    usedContextItems?: number;
    source?: string;
    citations?: Array<{
      id: string;
      itemType: string;
      title: string;
      preview: string;
      documentId?: string | null;
      codeId?: string | null;
      annotationId?: string | null;
      startOffset?: number | null;
      endOffset?: number | null;
    }>;
  };
};

export type ProjectAiChat = {
  id: string;
  createdAt: string;
  updatedAt: string;
  messages: ProjectAiChatMessage[];
};

function projectAiChatsKey(projectId: string): string {
  return `kq_project_ai_chats_${projectId}`;
}

function projectAiActiveChatKey(projectId: string): string {
  return `kq_project_ai_active_chat_${projectId}`;
}

export function createChatId(): string {
  return `chat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createMessageId(): string {
  return `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function readProjectAiChats(projectId: string): ProjectAiChat[] {
  try {
    const raw = localStorage.getItem(projectAiChatsKey(projectId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ProjectAiChat[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((chat) => chat && typeof chat.id === "string" && Array.isArray(chat.messages))
      .map((chat) => ({
        id: chat.id,
        createdAt: chat.createdAt || new Date().toISOString(),
        updatedAt: chat.updatedAt || chat.createdAt || new Date().toISOString(),
        messages: chat.messages
          .filter((message) => message && typeof message.text === "string" && (message.role === "user" || message.role === "assistant"))
          .map((message) => ({
            id: message.id || createMessageId(),
            role: message.role,
            text: message.text,
            createdAt: message.createdAt || new Date().toISOString(),
            metadata: message.metadata,
          })),
      }));
  } catch {
    return [];
  }
}

export function saveProjectAiChats(projectId: string, chats: ProjectAiChat[]): void {
  localStorage.setItem(projectAiChatsKey(projectId), JSON.stringify(chats));
}

export function readActiveProjectAiChatId(projectId: string): string | null {
  return localStorage.getItem(projectAiActiveChatKey(projectId));
}

export function saveActiveProjectAiChatId(projectId: string, chatId: string): void {
  localStorage.setItem(projectAiActiveChatKey(projectId), chatId);
}

export function shortenChatLabel(text: string, maxLength = 56): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "Untitled chat";
  return clean.length > maxLength ? `${clean.slice(0, maxLength - 1)}…` : clean;
}

export function getLastUserMessage(chat: ProjectAiChat): ProjectAiChatMessage | null {
  for (let index = chat.messages.length - 1; index >= 0; index -= 1) {
    if (chat.messages[index]?.role === "user") return chat.messages[index];
  }
  return null;
}

export function getChatSortTimestamp(chat: ProjectAiChat): number {
  const lastUserMessage = getLastUserMessage(chat);
  const raw = lastUserMessage?.createdAt ?? chat.updatedAt ?? chat.createdAt;
  const time = new Date(raw).getTime();
  return Number.isFinite(time) ? time : 0;
}

export function sortProjectAiChats(chats: ProjectAiChat[]): ProjectAiChat[] {
  return [...chats].sort((a, b) => getChatSortTimestamp(b) - getChatSortTimestamp(a));
}
