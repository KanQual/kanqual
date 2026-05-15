import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";
import type { AppRole, Role } from "../types";

export const PROJECT_AI_CHAT_COLLECTION = "project_ai_chats";
export const PROJECT_AI_CHAT_MESSAGE_COLLECTION = "project_ai_chat_messages";

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

function parseMessageMetadata(record: RecordModel): ProjectAiChatMessage["metadata"] | undefined {
  const raw = record.metadata_json;
  if (!raw) return undefined;
  if (typeof raw === "object") return raw as ProjectAiChatMessage["metadata"];
  if (typeof raw !== "string") return undefined;
  try {
    return JSON.parse(raw) as ProjectAiChatMessage["metadata"];
  } catch {
    return undefined;
  }
}

function toProjectAiChatMessage(record: RecordModel): ProjectAiChatMessage {
  return {
    id: record.id,
    chatId: String(record.chat ?? ""),
    role: record.role === "assistant" ? "assistant" : "user",
    text: String(record.text ?? ""),
    createdAt: record.created,
    createdById: record.created_by || undefined,
    createdByName: typeof record.created_by_name === "string" ? record.created_by_name : undefined,
    metadata: parseMessageMetadata(record),
  };
}

function toProjectAiChat(record: RecordModel, messages: ProjectAiChatMessage[]): ProjectAiChat {
  return {
    id: record.id,
    projectId: String(record.project ?? ""),
    title: String(record.title ?? ""),
    createdAt: record.created,
    updatedAt: String(record.last_message_at ?? record.updated ?? record.created),
    createdById: String(record.created_by ?? ""),
    createdByName: String(record.created_by_name ?? ""),
    participantUserIds: Array.isArray(record.participant_users)
      ? record.participant_users.map((value: unknown) => String(value)).filter(Boolean)
      : [],
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

export async function loadProjectAiChats(
  pb: PocketBase,
  args: {
    projectId: string;
    appRole: AppRole;
    projectRole: Role | null;
    currentUserId: string;
  },
): Promise<ProjectAiChat[]> {
  const canSeeAll = args.appRole === "administrator" || args.projectRole === "owner" || args.projectRole === "editor";
  const chatFilter = canSeeAll
    ? `project="${args.projectId}"&&deleted_at=""`
    : `project="${args.projectId}"&&created_by="${args.currentUserId}"&&deleted_at=""`;

  const [chatRecords, messageRecords] = await Promise.all([
    pb.collection(PROJECT_AI_CHAT_COLLECTION).getFullList({
      filter: chatFilter,
      sort: "-last_message_at,-created",
    }),
    pb.collection(PROJECT_AI_CHAT_MESSAGE_COLLECTION).getFullList({
      filter: `project="${args.projectId}"&&deleted_at=""`,
      sort: "created",
    }),
  ]);

  const chatIds = new Set(chatRecords.map((record) => record.id));
  const messagesByChat = new Map<string, ProjectAiChatMessage[]>();
  for (const record of messageRecords) {
    if (!chatIds.has(String(record.chat ?? ""))) continue;
    const message = toProjectAiChatMessage(record);
    const list = messagesByChat.get(message.chatId) ?? [];
    list.push(message);
    messagesByChat.set(message.chatId, list);
  }

  return sortProjectAiChats(
    chatRecords.map((record) => toProjectAiChat(record, messagesByChat.get(record.id) ?? [])),
  );
}

export async function createProjectAiChat(
  pb: PocketBase,
  args: {
    projectId: string;
    createdById: string;
    createdByIdentifier: string;
    createdByName: string;
    initialTitle: string;
  },
): Promise<ProjectAiChat> {
  const record = await pb.collection(PROJECT_AI_CHAT_COLLECTION).create({
    project: args.projectId,
    created_by: args.createdById,
    created_by_identifier: args.createdByIdentifier,
    created_by_name: args.createdByName,
    participant_users: [args.createdById],
    participant_identifiers_json: JSON.stringify(args.createdByIdentifier ? [args.createdByIdentifier] : []),
    title: args.initialTitle,
    last_message_at: new Date().toISOString(),
  });
  return toProjectAiChat(record, []);
}

export async function createProjectAiChatMessage(
  pb: PocketBase,
  args: {
    chatId: string;
    projectId: string;
    role: "user" | "assistant";
    text: string;
    createdById?: string;
    createdByIdentifier?: string;
    createdByName?: string;
    metadata?: ProjectAiChatMessage["metadata"];
  },
): Promise<ProjectAiChatMessage> {
  const record = await pb.collection(PROJECT_AI_CHAT_MESSAGE_COLLECTION).create({
    chat: args.chatId,
    project: args.projectId,
    role: args.role,
    text: args.text,
    metadata_json: args.metadata ? JSON.stringify(args.metadata) : "",
    created_by: args.createdById ?? "",
    created_by_identifier: args.createdByIdentifier ?? "",
    created_by_name: args.createdByName ?? "",
  });
  return toProjectAiChatMessage(record);
}

export async function touchProjectAiChat(
  pb: PocketBase,
  args: {
    chatId: string;
    lastMessageAt: string;
    title?: string;
  },
): Promise<void> {
  const payload: Record<string, unknown> = {
    last_message_at: args.lastMessageAt,
  };
  if (args.title) payload.title = args.title;
  await pb.collection(PROJECT_AI_CHAT_COLLECTION).update(args.chatId, payload);
}

export async function deleteProjectAiChat(pb: PocketBase, chatId: string): Promise<void> {
  const deletedAt = new Date().toISOString();
  await Promise.all([
    pb.collection(PROJECT_AI_CHAT_COLLECTION).update(chatId, { deleted_at: deletedAt }),
    pb.collection(PROJECT_AI_CHAT_MESSAGE_COLLECTION).getFullList({
      filter: `chat="${chatId}"&&deleted_at=""`,
    }).then((records) =>
      Promise.all(records.map((record) => pb.collection(PROJECT_AI_CHAT_MESSAGE_COLLECTION).update(record.id, { deleted_at: deletedAt }))),
    ),
  ]);
}

export async function migrateLegacyProjectAiChatsToBackend(
  pb: PocketBase,
  args: {
    projectId: string;
    currentUserId: string;
    currentUserIdentifier: string;
    currentUserName: string;
    appRole: AppRole;
    projectRole: Role | null;
  },
): Promise<void> {
  const legacyChats = readLegacyProjectAiChats(args.projectId);
  if (legacyChats.length === 0) return;

  const existingChats = await loadProjectAiChats(pb, args);
  const hasCurrentUserBackendChats = existingChats.some((chat) => chat.createdById === args.currentUserId);
  if (hasCurrentUserBackendChats) {
    clearLegacyProjectAiChats(args.projectId);
    return;
  }

  for (const legacyChat of legacyChats) {
    const firstUserMessage = getFirstUserMessage(legacyChat);
    const createdChat = await createProjectAiChat(pb, {
      projectId: args.projectId,
      createdById: args.currentUserId,
      createdByIdentifier: args.currentUserIdentifier,
      createdByName: args.currentUserName,
      initialTitle: shortenChatLabel(firstUserMessage?.text ?? legacyChat.title ?? "Untitled chat"),
    });

    for (const message of legacyChat.messages) {
      await createProjectAiChatMessage(pb, {
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
    await touchProjectAiChat(pb, {
      chatId: createdChat.id,
      lastMessageAt: lastCreatedAt,
      title: shortenChatLabel(firstUserMessage?.text ?? legacyChat.title ?? "Untitled chat"),
    });
  }

  clearLegacyProjectAiChats(args.projectId);
}
