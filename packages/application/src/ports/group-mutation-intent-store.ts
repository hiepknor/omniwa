import { createOpaqueString, type OpaqueString } from "@omniwa/shared";

import type { ApplicationPortContext, ApplicationPortResult } from "./application-port.js";

export type GroupMutationIntentRef = OpaqueString<"GroupMutationIntentRef">;

export const groupMutationKinds = [
  "metadata",
  "local_state",
  "add_member",
  "remove_member",
  "promote_member",
  "demote_member",
] as const;

export type GroupMutationKind = (typeof groupMutationKinds)[number];

export type GroupMetadataMutationInput = Readonly<{
  groupMutationIntentRef?: GroupMutationIntentRef;
  kind: "metadata";
  subject?: string;
  description?: string;
  expiresAtEpochMilliseconds?: number;
}>;

export type GroupLocalStateMutationInput = Readonly<{
  groupMutationIntentRef?: GroupMutationIntentRef;
  kind: "local_state";
  muted?: boolean;
  archived?: boolean;
  pinned?: boolean;
  expiresAtEpochMilliseconds?: number;
}>;

export type AddGroupMemberMutationInput = Readonly<{
  groupMutationIntentRef?: GroupMutationIntentRef;
  kind: "add_member";
  memberJid: string;
  expiresAtEpochMilliseconds?: number;
}>;

export type ExistingGroupMemberMutationInput = Readonly<{
  groupMutationIntentRef?: GroupMutationIntentRef;
  kind: "remove_member" | "promote_member" | "demote_member";
  memberRef: string;
  expiresAtEpochMilliseconds?: number;
}>;

export type GroupMutationIntentInput =
  | GroupMetadataMutationInput
  | GroupLocalStateMutationInput
  | AddGroupMemberMutationInput
  | ExistingGroupMemberMutationInput;

export type StoredGroupMutationIntent = GroupMutationIntentInput &
  Readonly<{
    groupMutationIntentRef: GroupMutationIntentRef;
    createdAtEpochMilliseconds: number;
  }>;

export type GroupMutationIntentReceipt = Readonly<{
  groupMutationIntentRef: GroupMutationIntentRef;
  kind: GroupMutationKind;
  createdAtEpochMilliseconds: number;
  expiresAtEpochMilliseconds?: number;
}>;

export interface GroupMutationIntentStorePort {
  storeGroupMutationIntent(
    intent: GroupMutationIntentInput,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<GroupMutationIntentReceipt>>;

  resolveGroupMutationIntent(
    groupMutationIntentRef: GroupMutationIntentRef,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<StoredGroupMutationIntent>>;
}

const groupMutationIntentRefPattern = /^[A-Za-z0-9_.:-]+$/u;

export function createGroupMutationIntentRef(value: string): GroupMutationIntentRef {
  const normalized = value.trim();

  if (!groupMutationIntentRefPattern.test(normalized)) {
    throw new TypeError("GroupMutationIntentRef must be a safe opaque reference.");
  }

  return createOpaqueString(normalized, "GroupMutationIntentRef");
}

export function createGroupMutationIntentInput(
  input: GroupMutationIntentInput,
): GroupMutationIntentInput {
  assertSafeExpiry(input.expiresAtEpochMilliseconds);

  switch (input.kind) {
    case "metadata":
      return freezeMetadataInput(input);
    case "local_state":
      return freezeLocalStateInput(input);
    case "add_member":
      assertNonEmpty(input.memberJid, "Group member reference");
      return Object.freeze({ ...input, memberJid: input.memberJid.trim() });
    case "remove_member":
    case "promote_member":
    case "demote_member":
      assertNonEmpty(input.memberRef, "Group member reference");
      return Object.freeze({ ...input, memberRef: input.memberRef.trim() });
  }
}

function freezeMetadataInput(input: GroupMetadataMutationInput): GroupMetadataMutationInput {
  const subject = input.subject?.trim();
  const description = input.description?.trim();

  if ((subject === undefined || subject.length === 0) && description === undefined) {
    throw new TypeError("Group metadata mutation requires subject or description.");
  }

  if (description !== undefined && description.length === 0) {
    throw new TypeError("Group metadata description must not be empty.");
  }

  return Object.freeze({
    ...input,
    ...(subject === undefined || subject.length === 0 ? {} : { subject }),
    ...(description === undefined ? {} : { description }),
  });
}

function freezeLocalStateInput(input: GroupLocalStateMutationInput): GroupLocalStateMutationInput {
  if (input.muted === undefined && input.archived === undefined && input.pinned === undefined) {
    throw new TypeError("Group local state mutation requires a boolean field.");
  }

  return Object.freeze({ ...input });
}

function assertSafeExpiry(value: number | undefined): void {
  if (value !== undefined && !Number.isSafeInteger(value)) {
    throw new TypeError("Group mutation intent expiry must be a safe integer.");
  }
}

function assertNonEmpty(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new TypeError(`${label} must not be empty.`);
  }
}
