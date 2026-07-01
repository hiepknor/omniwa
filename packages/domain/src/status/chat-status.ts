import { createStringUnionValue } from "../common/string-union-value.js";

export const chatStatuses = ["open", "archived", "deleted"] as const;

export type ChatStatus = (typeof chatStatuses)[number];

export function createChatStatus(value: string): ChatStatus {
  return createStringUnionValue(value, chatStatuses, "ChatStatus");
}
