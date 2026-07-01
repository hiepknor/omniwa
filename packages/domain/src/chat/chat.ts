import type { ChatId, InstanceId, LabelId } from "../identity/aggregate-ids.js";
import type { Jid } from "../references/jid.js";
import type { ChatStatus } from "../status/chat-status.js";

export const chatKinds = ["direct", "group"] as const;

export type ChatKind = (typeof chatKinds)[number];

export type Chat = Readonly<{
  id: ChatId;
  instanceId: InstanceId;
  jid: Jid;
  kind: ChatKind;
  status: ChatStatus;
  labelIds: readonly LabelId[];
  unreadCount: number;
  muted: boolean;
  pinned: boolean;
}>;

export type ChatInput = Readonly<{
  id: ChatId;
  instanceId: InstanceId;
  jid: Jid;
  kind?: ChatKind;
  labelIds?: readonly LabelId[];
  unreadCount?: number;
  muted?: boolean;
  pinned?: boolean;
}>;

export function createChat(input: ChatInput): Chat {
  const kind = input.kind ?? inferChatKind(input.jid);
  assertKindMatchesJid(kind, input.jid);

  return freezeChat({
    id: input.id,
    instanceId: input.instanceId,
    jid: input.jid,
    kind,
    status: "open",
    labelIds: freezeUniqueLabelIds(input.labelIds ?? []),
    unreadCount: normalizeUnreadCount(input.unreadCount ?? 0),
    muted: input.muted ?? false,
    pinned: input.pinned ?? false,
  });
}

export function archiveChat(chat: Chat): Chat {
  return patchChat(chat, { status: "archived" });
}

export function reopenChat(chat: Chat): Chat {
  return patchChat(chat, { status: "open" });
}

export function deleteChat(chat: Chat): Chat {
  return patchChat(chat, { status: "deleted" });
}

export function setChatUnreadCount(chat: Chat, unreadCount: number): Chat {
  return patchChat(chat, { unreadCount: normalizeUnreadCount(unreadCount) });
}

export function setChatMuted(chat: Chat, muted: boolean): Chat {
  return patchChat(chat, { muted });
}

export function setChatPinned(chat: Chat, pinned: boolean): Chat {
  return patchChat(chat, { pinned });
}

export function assignChatLabel(chat: Chat, labelId: LabelId): Chat {
  return patchChat(chat, { labelIds: freezeUniqueLabelIds([...chat.labelIds, labelId]) });
}

export function removeChatLabel(chat: Chat, labelId: LabelId): Chat {
  return patchChat(chat, {
    labelIds: freezeUniqueLabelIds(chat.labelIds.filter((entry) => entry !== labelId)),
  });
}

function inferChatKind(jid: Jid): ChatKind {
  return String(jid).endsWith("@g.us") ? "group" : "direct";
}

function assertKindMatchesJid(kind: ChatKind, jid: Jid): void {
  const isGroupJid = String(jid).endsWith("@g.us");

  if ((kind === "group") !== isGroupJid) {
    throw new TypeError("Chat kind must match the translated JID namespace.");
  }
}

function normalizeUnreadCount(value: number): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError("Chat unread count must be a non-negative integer.");
  }

  return value;
}

function freezeUniqueLabelIds(labelIds: readonly LabelId[]): readonly LabelId[] {
  const labels = Object.freeze([...new Set(labelIds)]);

  if (labels.length !== labelIds.length) {
    throw new TypeError("Chat labels must be unique.");
  }

  return labels;
}

function patchChat(chat: Chat, patch: Partial<Chat>): Chat {
  return freezeChat({
    id: chat.id,
    instanceId: chat.instanceId,
    jid: chat.jid,
    kind: chat.kind,
    status: patch.status ?? chat.status,
    labelIds: patch.labelIds ?? chat.labelIds,
    unreadCount: patch.unreadCount ?? chat.unreadCount,
    muted: patch.muted ?? chat.muted,
    pinned: patch.pinned ?? chat.pinned,
  });
}

function freezeChat(chat: Chat): Chat {
  return Object.freeze(chat);
}
