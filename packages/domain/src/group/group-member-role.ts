import { createStringUnionValue } from "../common/string-union-value.js";

export const groupMemberRoles = ["member", "admin", "owner"] as const;

export type GroupMemberRole = (typeof groupMemberRoles)[number];

export function createGroupMemberRole(value: string): GroupMemberRole {
  return createStringUnionValue(value, groupMemberRoles, "GroupMemberRole");
}
