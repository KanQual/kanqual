import type { AppRole, Role } from "../types";
import {
  createPostgresProjectAiChat,
  createPostgresProjectAiChatMessage,
  deletePostgresProjectAiChat,
  getPostgresAuthStatus,
  listPostgresProjectAiChatMessages,
  listPostgresProjectAiChats,
  listPostgresProjectUsers,
  touchPostgresProjectAiChat,
  type PostgresProjectAiChat,
  type PostgresProjectAiChatMessage,
} from "./postgres";

export type ProjectAiChatMessage = {
  id: string;
  chatId: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  createdById?: string;
  createdByName?: string;
  metadata?: {
    model?: string;
    usedContextItems?: number;
    source?: string;
    citations?: Array<{
      id: string;
      itemType: string;
      title: string;
      preview: string;
      sourceId?: string | null;
      objectId?: string | null;
      documentId?: string | null;
      caseId?: string | null;
      codeId?: string | null;
      annotationId?: string | null;
      memoId?: string | null;
      startOffset?: number | null;
      endOffset?: number | null;
    }>;
  };
};

export type ProjectAiChat = {
  id: string;
  projectId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  createdById: string;
  createdByName: string;
  participantUserIds: string[];
  messages: ProjectAiChatMessage[];
};

export type CurrentProjectAiChatUser = {
  id: string;
  name: string;
  appRole: AppRole;
  projectRole: Role | null;
};

function projectAiChatsKey(projectId: string): string {
  return `kq_project_ai_chats_${projectId}`;
}

function projectAiActiveChatKey(projectId: string): string {
  return `kq_project_ai_active_chat_${projectId}`;
}

export function shortenChatLabel(text: string, maxLength = 56): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "Untitled chat";
  return clean.length > maxLength ? `${clean.slice(0, maxLength - 1)}...` : clean;
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

function parseJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.map((item) => String(item)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function parseMessageMetadata(value: string): ProjectAiChatMessage["metadata"] | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as ProjectAiChatMessage["metadata"];
  } catch {
    return undefined;
  }
}

function toProjectAiChatMessage(record: PostgresProjectAiChatMessage): ProjectAiChatMessage {
  return {
    id: record.id,
    chatId: record.chatId,
    role: record.role === "assistant" ? "assistant" : "user",
    text: record.text,
    createdAt: record.createdAt,
    createdById: record.createdByProjectUserId || undefined,
    createdByName: record.createdByName || undefined,
    metadata: parseMessageMetadata(record.metadataJson),
  };
}

function toProjectAiChat(record: PostgresProjectAiChat, messages: ProjectAiChatMessage[]): ProjectAiChat {
  return {
    id: record.id,
    projectId: record.projectId,
    title: record.title,
    createdAt: record.createdAt,
    updatedAt: record.lastMessageAt ?? record.updatedAt ?? record.createdAt,
    createdById: record.createdByProjectUserId,
    createdByName: record.createdByName,
    participantUserIds: parseJsonArray(record.participantProjectUserIdsJson),
    messages,
  };
}

export function readActiveProjectAiChatId(projectId: string): string | null {
  return localStorage.getItem(projectAiActiveChatKey(projectId));
}

export function saveActiveProjectAiChatId(projectId: string, chatId: string): void {
  localStorage.setItem(projectAiActiveChatKey(projectId), chatId);
}

export function clearActiveProjectAiChatId(projectId: string): void {
  localStorage.removeItem(projectAiActiveChatKey(projectId));
}

function readLegacyProjectAiChats(projectId: string): ProjectAiChat[] {
  try {
    const raw = localStorage.getItem(projectAiChatsKey(projectId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ProjectAiChat[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((chat) => chat && typeof chat.id === "string" && Array.isArray(chat.messages))
      .map((chat) => ({
        id: chat.id,
        projectId,
        title: typeof chat.title === "string" ? chat.title : shortenChatLabel(getLastUserMessage(chat)?.text ?? "Untitled chat"),
        createdAt: chat.createdAt || new Date().toISOString(),
        updatedAt: chat.updatedAt || chat.createdAt || new Date().toISOString(),
        createdById: typeof chat.createdById === "string" ? chat.createdById : "",
        createdByName: typeof chat.createdByName === "string" ? chat.createdByName : "",
        participantUserIds: Array.isArray(chat.participantUserIds) ? chat.participantUserIds : [],
        messages: chat.messages
          .filter((message) => message && typeof message.text === "string" && (message.role === "user" || message.role === "assistant"))
          .map((message) => ({
            id: message.id || `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
            chatId: chat.id,
            role: message.role,
            text: message.text,
            createdAt: message.createdAt || new Date().toISOString(),
            createdById: message.createdById,
            createdByName: message.createdByName,
            metadata: message.metadata,
          })),
      }));
  } catch {
    return [];
  }
}

function clearLegacyProjectAiChats(projectId: string): void {
  localStorage.removeItem(projectAiChatsKey(projectId));
}

function getFirstUserMessage(chat: ProjectAiChat): ProjectAiChatMessage | null {
  return chat.messages.find((message) => message.role === "user") ?? null;
}

function stringifyMetadata(metadata: ProjectAiChatMessage["metadata"] | undefined): string {
  if (!metadata) return "";
  try {
    return JSON.stringify(metadata);
  } catch {
    return "";
  }
}

export async function loadCurrentProjectAiChatUser(projectId: string): Promise<CurrentProjectAiChatUser | null> {
  const authStatus = await getPostgresAuthStatus();
  const session = authStatus.currentSession;
  if (!session) return null;

  const users = await listPostgresProjectUsers(projectId);
  const projectUser = users.find((user) => user.appUserId === session.user.id || user.email.toLowerCase() === session.user.email.toLowerCase());
  return {
    id: projectUser?.id ?? "",
    name: projectUser?.name || session.user.name || session.user.email || "You",
    appRole: session.user.role === "administrator" ? "administrator" : "standard",
    projectRole: projectUser?.role === "owner" || projectUser?.role === "editor" || projectUser?.role === "coder" || projectUser?.role === "viewer"
      ? projectUser.role
      : null,
  };
}

export async function loadProjectAiChats(args: {
  projectId: string;
  appRole: AppRole;
  projectRole: Role | null;
  currentUserId: string;
}): Promise<ProjectAiChat[]> {
  const [chatRecords, messageRecords] = await Promise.all([
    listPostgresProjectAiChats(args.projectId),
    listPostgresProjectAiChatMessages(args.projectId),
  ]);

  const chatIds = new Set(chatRecords.map((record) => record.id));
  const messagesByChat = new Map<string, ProjectAiChatMessage[]>();
  for (const record of messageRecords) {
    if (!chatIds.has(record.chatId)) continue;
    const message = toProjectAiChatMessage(record);
    const list = messagesByChat.get(message.chatId) ?? [];
    list.push(message);
    messagesByChat.set(message.chatId, list);
  }

  return sortProjectAiChats(
    chatRecords.map((record) => toProjectAiChat(record, messagesByChat.get(record.id) ?? [])),
  );
}

export async function createProjectAiChat(args: {
  projectId: string;
  createdById: string;
  createdByIdentifier: string;
  createdByName: string;
  initialTitle: string;
}): Promise<ProjectAiChat> {
  const record = await createPostgresProjectAiChat({
    projectId: args.projectId,
    title: args.initialTitle,
    participantProjectUserIds: args.createdById ? [args.createdById] : [],
  });
  return toProjectAiChat(record, []);
}

export async function createProjectAiChatMessage(args: {
  chatId: string;
  projectId: string;
  role: "user" | "assistant";
  text: string;
  createdById?: string;
  createdByIdentifier?: string;
  createdByName?: string;
  metadata?: ProjectAiChatMessage["metadata"];
}): Promise<ProjectAiChatMessage> {
  const record = await createPostgresProjectAiChatMessage({
    chatId: args.chatId,
    projectId: args.projectId,
    role: args.role,
    text: args.text,
    metadataJson: stringifyMetadata(args.metadata),
  });
  return toProjectAiChatMessage(record);
}

export async function touchProjectAiChat(args: {
  projectId: string;
  chatId: string;
  lastMessageAt: string;
  title?: string;
}): Promise<void> {
  await touchPostgresProjectAiChat({
    projectId: args.projectId,
    chatId: args.chatId,
    lastMessageAt: args.lastMessageAt,
    title: args.title,
  });
}

export async function deleteProjectAiChat(projectId: string, chatId: string): Promise<void> {
  await deletePostgresProjectAiChat(projectId, chatId);
}

export async function migrateLegacyProjectAiChatsToBackend(args: {
  projectId: string;
  currentUserId: string;
  currentUserIdentifier: string;
  currentUserName: string;
  appRole: AppRole;
  projectRole: Role | null;
}): Promise<void> {
  const legacyChats = readLegacyProjectAiChats(args.projectId);
  if (legacyChats.length === 0) return;

  const existingChats = await loadProjectAiChats(args);
  const hasCurrentUserBackendChats = existingChats.some((chat) => chat.createdById === args.currentUserId);
  if (hasCurrentUserBackendChats) {
    clearLegacyProjectAiChats(args.projectId);
    return;
  }

  for (const legacyChat of legacyChats) {
    const firstUserMessage = getFirstUserMessage(legacyChat);
    const createdChat = await createProjectAiChat({
      projectId: args.projectId,
      createdById: args.currentUserId,
      createdByIdentifier: args.currentUserIdentifier,
      createdByName: args.currentUserName,
      initialTitle: shortenChatLabel(firstUserMessage?.text ?? legacyChat.title ?? "Untitled chat"),
    });

    for (const message of legacyChat.messages) {
      await createProjectAiChatMessage({
        chatId: createdChat.id,
        projectId: args.projectId,
        role: message.role,
        text: message.text,
        createdById: message.role === "user" ? args.currentUserId : undefined,
        createdByIdentifier: message.role === "user" ? args.currentUserIdentifier : undefined,
        createdByName: message.role === "user" ? args.currentUserName : undefined,
        metadata: message.metadata,
      });
    }

    const lastCreatedAt = legacyChat.messages[legacyChat.messages.length - 1]?.createdAt ?? legacyChat.updatedAt ?? legacyChat.createdAt;
    await touchProjectAiChat({
      projectId: args.projectId,
      chatId: createdChat.id,
      lastMessageAt: lastCreatedAt,
      title: shortenChatLabel(firstUserMessage?.text ?? legacyChat.title ?? "Untitled chat"),
    });
  }

  clearLegacyProjectAiChats(args.projectId);
}
