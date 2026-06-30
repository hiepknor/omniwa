import { transitionStatus, type StatusTransitionMap } from "../aggregates/status-transition.js";
import { appendDomainEvent, type DomainEvent } from "../events/domain-event.js";
import type {
  GroupActionId,
  GroupId,
  InstanceId,
  InviteLinkId,
} from "../identity/aggregate-ids.js";
import type { Jid } from "../references/jid.js";
import type { GroupStatus } from "../status/group-status.js";
import type { GroupMemberRole } from "./group-member-role.js";

const groupTransitions: StatusTransitionMap<GroupStatus> = {
  discovered: ["active", "left", "deleted"],
  active: ["left", "deleted"],
  left: ["active", "deleted"],
  deleted: [],
};

export const groupActionKinds = [
  "send_message",
  "add_member",
  "remove_member",
  "promote_member",
  "demote_member",
  "refresh_invite_link",
  "update_metadata",
  "mute",
  "unmute",
  "archive",
  "unarchive",
  "pin",
  "unpin",
] as const;

export type GroupActionKind = (typeof groupActionKinds)[number];

export type GroupMetadata = Readonly<{
  subject: string;
  description?: string;
}>;

export type GroupMember = Readonly<{
  jid: Jid;
  role: GroupMemberRole;
  joinedAtEpochMilliseconds?: number;
}>;

export type GroupInviteLink = Readonly<{
  id: InviteLinkId;
  urlRef: string;
  active: boolean;
}>;

export type GroupAction = Readonly<{
  id: GroupActionId;
  kind: GroupActionKind;
  actorRef: string;
  auditRequired: boolean;
  targetJid?: Jid;
}>;

export type Group = Readonly<{
  id: GroupId;
  instanceId: InstanceId;
  jid: Jid;
  status: GroupStatus;
  metadata: GroupMetadata;
  members: readonly GroupMember[];
  actions: readonly GroupAction[];
  inviteLink?: GroupInviteLink;
  muted: boolean;
  archived: boolean;
  pinned: boolean;
  domainEvents: readonly DomainEvent[];
}>;

export type GroupInput = Readonly<{
  id: GroupId;
  instanceId: InstanceId;
  jid: Jid;
  metadata: GroupMetadata;
  members?: readonly GroupMember[];
}>;

export function createGroup(input: GroupInput): Group {
  assertGroupJid(input.jid);

  return freezeGroup({
    id: input.id,
    instanceId: input.instanceId,
    jid: input.jid,
    status: "discovered",
    metadata: normalizeMetadata(input.metadata),
    members: freezeMembers(input.members ?? []),
    actions: Object.freeze([]),
    muted: false,
    archived: false,
    pinned: false,
    domainEvents: appendDomainEvent([], "Group", input.id, "GroupDiscovered"),
  });
}

export function activateGroup(group: Group): Group {
  return transitionGroup(group, "active", "GroupStatusUpdated");
}

export function markGroupLeft(group: Group): Group {
  return transitionGroup(group, "left", "GroupStatusUpdated");
}

export function deleteGroup(group: Group): Group {
  return transitionGroup(group, "deleted", "GroupStatusUpdated");
}

export function updateGroupMetadata(
  group: Group,
  metadata: Partial<GroupMetadata>,
  action: GroupAction,
): Group {
  assertActiveGroup(group);

  return patchGroup(group, {
    metadata: normalizeMetadata({
      subject: metadata.subject ?? group.metadata.subject,
      ...(metadata.description === undefined
        ? group.metadata.description === undefined
          ? {}
          : { description: group.metadata.description }
        : { description: metadata.description }),
    }),
    actions: appendAction(group.actions, action),
    domainEvents: appendDomainEvent(group.domainEvents, "Group", group.id, "GroupMetadataUpdated"),
  });
}

export function addGroupMember(group: Group, member: GroupMember, action: GroupAction): Group {
  assertActiveGroup(group);

  if (findMember(group, member.jid) !== undefined) {
    throw new TypeError("Group member already exists.");
  }

  return patchGroup(group, {
    members: freezeMembers([...group.members, member]),
    actions: appendAction(group.actions, action),
    domainEvents: appendDomainEvent(group.domainEvents, "Group", group.id, "GroupMemberAdded"),
  });
}

export function removeGroupMember(group: Group, memberJid: Jid, action: GroupAction): Group {
  assertActiveGroup(group);
  const member = requireMember(group, memberJid);

  if (member.role === "owner") {
    throw new TypeError("Group owner cannot be removed by a member action.");
  }

  return patchGroup(group, {
    members: freezeMembers(group.members.filter((entry) => entry.jid !== memberJid)),
    actions: appendAction(group.actions, action),
    domainEvents: appendDomainEvent(group.domainEvents, "Group", group.id, "GroupMemberRemoved"),
  });
}

export function promoteGroupMember(group: Group, memberJid: Jid, action: GroupAction): Group {
  assertActiveGroup(group);
  const member = requireMember(group, memberJid);

  if (member.role === "owner") {
    throw new TypeError("Group owner role cannot be changed.");
  }

  return replaceMemberRole(group, member, "admin", action);
}

export function demoteGroupMember(group: Group, memberJid: Jid, action: GroupAction): Group {
  assertActiveGroup(group);
  const member = requireMember(group, memberJid);

  if (member.role === "owner") {
    throw new TypeError("Group owner role cannot be changed.");
  }

  return replaceMemberRole(group, member, "member", action);
}

export function setGroupInviteLink(
  group: Group,
  inviteLink: GroupInviteLink,
  action: GroupAction,
): Group {
  assertActiveGroup(group);

  return patchGroup(group, {
    inviteLink: normalizeInviteLink(inviteLink),
    actions: appendAction(group.actions, action),
    domainEvents: appendDomainEvent(
      group.domainEvents,
      "Group",
      group.id,
      "GroupInviteLinkUpdated",
    ),
  });
}

export function setGroupMuted(group: Group, muted: boolean, action: GroupAction): Group {
  return patchLocalState(group, { muted }, action);
}

export function setGroupArchived(group: Group, archived: boolean, action: GroupAction): Group {
  return patchLocalState(group, { archived }, action);
}

export function setGroupPinned(group: Group, pinned: boolean, action: GroupAction): Group {
  return patchLocalState(group, { pinned }, action);
}

export function createGroupMember(input: {
  jid: Jid;
  role?: GroupMemberRole;
  joinedAtEpochMilliseconds?: number;
}): GroupMember {
  return Object.freeze({
    jid: input.jid,
    role: input.role ?? "member",
    ...(input.joinedAtEpochMilliseconds === undefined
      ? {}
      : { joinedAtEpochMilliseconds: input.joinedAtEpochMilliseconds }),
  });
}

export function createGroupAction(input: {
  id: GroupActionId;
  kind: GroupActionKind;
  actorRef: string;
  targetJid?: Jid;
}): GroupAction {
  if (!groupActionKinds.includes(input.kind)) {
    throw new TypeError("Group action kind is not approved.");
  }

  const actorRef = normalizeNonEmpty(input.actorRef, "GroupAction.actorRef");

  return Object.freeze({
    id: input.id,
    kind: input.kind,
    actorRef,
    auditRequired: isAuditRequiredGroupAction(input.kind),
    ...(input.targetJid === undefined ? {} : { targetJid: input.targetJid }),
  });
}

export function createGroupInviteLink(input: {
  id: InviteLinkId;
  urlRef: string;
  active?: boolean;
}): GroupInviteLink {
  return normalizeInviteLink({
    id: input.id,
    urlRef: input.urlRef,
    active: input.active ?? true,
  });
}

export function isAuditRequiredGroupAction(kind: GroupActionKind): boolean {
  return !["send_message", "mute", "unmute", "archive", "unarchive", "pin", "unpin"].includes(kind);
}

function transitionGroup(
  group: Group,
  status: GroupStatus,
  eventName: Parameters<typeof appendDomainEvent>[3],
): Group {
  return patchGroup(group, {
    status: transitionStatus(group.status, status, groupTransitions, "Group"),
    domainEvents: appendDomainEvent(group.domainEvents, "Group", group.id, eventName),
  });
}

function replaceMemberRole(
  group: Group,
  member: GroupMember,
  role: GroupMemberRole,
  action: GroupAction,
): Group {
  return patchGroup(group, {
    members: freezeMembers(
      group.members.map((entry) => (entry.jid === member.jid ? { ...entry, role } : entry)),
    ),
    actions: appendAction(group.actions, action),
    domainEvents: appendDomainEvent(
      group.domainEvents,
      "Group",
      group.id,
      "GroupMemberRoleChanged",
    ),
  });
}

function patchLocalState(
  group: Group,
  state: Partial<Pick<Group, "muted" | "archived" | "pinned">>,
  action: GroupAction,
): Group {
  assertActiveGroup(group);

  return patchGroup(group, {
    ...state,
    actions: appendAction(group.actions, action),
    domainEvents: appendDomainEvent(
      group.domainEvents,
      "Group",
      group.id,
      "GroupLocalStateUpdated",
    ),
  });
}

function patchGroup(group: Group, patch: Partial<Group>): Group {
  const inviteLink = "inviteLink" in patch ? patch.inviteLink : group.inviteLink;

  return freezeGroup({
    id: group.id,
    instanceId: group.instanceId,
    jid: group.jid,
    status: patch.status ?? group.status,
    metadata: patch.metadata ?? group.metadata,
    members: patch.members ?? group.members,
    actions: patch.actions ?? group.actions,
    ...(inviteLink === undefined ? {} : { inviteLink }),
    muted: patch.muted ?? group.muted,
    archived: patch.archived ?? group.archived,
    pinned: patch.pinned ?? group.pinned,
    domainEvents: patch.domainEvents ?? group.domainEvents,
  });
}

function normalizeMetadata(metadata: GroupMetadata): GroupMetadata {
  return Object.freeze({
    subject: normalizeNonEmpty(metadata.subject, "GroupMetadata.subject"),
    ...(metadata.description === undefined
      ? {}
      : { description: normalizeNonEmpty(metadata.description, "GroupMetadata.description") }),
  });
}

function normalizeInviteLink(inviteLink: GroupInviteLink): GroupInviteLink {
  return Object.freeze({
    id: inviteLink.id,
    urlRef: normalizeNonEmpty(inviteLink.urlRef, "GroupInviteLink.urlRef"),
    active: inviteLink.active,
  });
}

function freezeMembers(members: readonly GroupMember[]): readonly GroupMember[] {
  const seen = new Set<string>();
  const normalized = members.map((member) => {
    const key = String(member.jid);

    if (seen.has(key)) {
      throw new TypeError("Group members must be unique by JID.");
    }

    seen.add(key);
    return Object.freeze({ ...member });
  });

  return Object.freeze(normalized);
}

function appendAction(
  actions: readonly GroupAction[],
  action: GroupAction,
): readonly GroupAction[] {
  return Object.freeze([...actions, action]);
}

function requireMember(group: Group, memberJid: Jid): GroupMember {
  const member = findMember(group, memberJid);

  if (member === undefined) {
    throw new TypeError("Group member does not exist.");
  }

  return member;
}

function findMember(group: Group, memberJid: Jid): GroupMember | undefined {
  return group.members.find((member) => member.jid === memberJid);
}

function assertActiveGroup(group: Group): void {
  if (group.status !== "active") {
    throw new TypeError("Group operation requires active Group status.");
  }
}

function assertGroupJid(jid: Jid): void {
  if (!String(jid).endsWith("@g.us")) {
    throw new TypeError("Group JID must be a WhatsApp group JID.");
  }
}

function normalizeNonEmpty(value: string, label: string): string {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new TypeError(`${label} must not be empty.`);
  }

  return normalized;
}

function freezeGroup(group: Group): Group {
  return Object.freeze(group);
}
