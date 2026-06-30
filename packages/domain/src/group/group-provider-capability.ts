import { createStringUnionValue } from "../common/string-union-value.js";

export const groupProviderCapabilities = [
  "group_list",
  "group_detail",
  "group_message_send",
  "group_member_admin",
  "group_invite_link",
  "group_metadata_update",
  "group_local_state",
] as const;

export type GroupProviderCapability = (typeof groupProviderCapabilities)[number];

export function createGroupProviderCapability(value: string): GroupProviderCapability {
  return createStringUnionValue(value, groupProviderCapabilities, "GroupProviderCapability");
}
