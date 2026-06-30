import { describe, expect, it } from "vitest";

import {
  activateGroup,
  addGroupMember,
  createGroup,
  createGroupAction,
  createGroupInviteLink,
  createGroupMember,
  demoteGroupMember,
  promoteGroupMember,
  removeGroupMember,
  setGroupArchived,
  setGroupInviteLink,
  updateGroupMetadata,
} from "./group.js";
import { createGroupMemberRole } from "./group-member-role.js";
import { createGroupProviderCapability } from "./group-provider-capability.js";
import {
  createGroupActionId,
  createGroupId,
  createInstanceId,
  createInviteLinkId,
} from "../identity/aggregate-ids.js";
import { createJid } from "../references/jid.js";
import { createProviderProfileAggregate } from "../factories/domain-factories.js";
import {
  evaluateGroupProviderCapabilityPolicy,
  evaluateProviderCapabilityPolicy,
} from "../policies/domain-policies.js";
import { createProviderId } from "../identity/aggregate-ids.js";
import { createMessageType } from "../messaging/message-type.js";

describe("Group domain", () => {
  it("protects group lifecycle, metadata, members, invite links, and audit actions", () => {
    const group = activateGroup(
      createGroup({
        id: createGroupId("group_1"),
        instanceId: createInstanceId("instance_1"),
        jid: createJid("12345@g.us"),
        metadata: {
          subject: "Engineering Team",
        },
      }),
    );
    const memberJid = createJid("12025550123@s.whatsapp.net");
    const adminAction = createGroupAction({
      id: createGroupActionId("group_action_1"),
      kind: "add_member",
      actorRef: "api_key:test",
      targetJid: memberJid,
    });

    const withMember = addGroupMember(
      group,
      createGroupMember({
        jid: memberJid,
        role: createGroupMemberRole("member"),
      }),
      adminAction,
    );
    const promoted = promoteGroupMember(
      withMember,
      memberJid,
      createGroupAction({
        id: createGroupActionId("group_action_2"),
        kind: "promote_member",
        actorRef: "api_key:test",
        targetJid: memberJid,
      }),
    );
    const updated = updateGroupMetadata(
      promoted,
      { description: "Platform delivery group" },
      createGroupAction({
        id: createGroupActionId("group_action_3"),
        kind: "update_metadata",
        actorRef: "api_key:test",
      }),
    );
    const withInvite = setGroupInviteLink(
      updated,
      createGroupInviteLink({
        id: createInviteLinkId("invite_1"),
        urlRef: "https://chat.whatsapp.com/safe-ref",
      }),
      createGroupAction({
        id: createGroupActionId("group_action_4"),
        kind: "refresh_invite_link",
        actorRef: "api_key:test",
      }),
    );
    const archived = setGroupArchived(
      withInvite,
      true,
      createGroupAction({
        id: createGroupActionId("group_action_5"),
        kind: "archive",
        actorRef: "api_key:test",
      }),
    );
    const demoted = demoteGroupMember(
      archived,
      memberJid,
      createGroupAction({
        id: createGroupActionId("group_action_6"),
        kind: "demote_member",
        actorRef: "api_key:test",
        targetJid: memberJid,
      }),
    );
    const withoutMember = removeGroupMember(
      demoted,
      memberJid,
      createGroupAction({
        id: createGroupActionId("group_action_7"),
        kind: "remove_member",
        actorRef: "api_key:test",
        targetJid: memberJid,
      }),
    );

    expect(group.status).toBe("active");
    expect(withMember.members).toHaveLength(1);
    expect(promoted.members[0]?.role).toBe("admin");
    expect(updated.metadata.description).toBe("Platform delivery group");
    expect(withInvite.inviteLink?.active).toBe(true);
    expect(archived.archived).toBe(true);
    expect(withoutMember.members).toHaveLength(0);
    expect(withoutMember.actions.filter((action) => action.auditRequired)).toHaveLength(6);
    expect(withoutMember.domainEvents.map((event) => event.name)).toContain(
      "GroupMemberRoleChanged",
    );
  });

  it("keeps group provider capability checks product-safe and outside provider adapters", () => {
    const supported = createProviderProfileAggregate({
      id: createProviderId("provider_group_1"),
      providerKind: "baileys",
      status: "supported",
      supportedMessageTypes: [createMessageType("text")],
      supportedGroupCapabilities: [createGroupProviderCapability("group_list")],
    });

    const rejected = evaluateGroupProviderCapabilityPolicy(supported, "group_member_admin");

    expect(evaluateProviderCapabilityPolicy(supported, createMessageType("text")).outcome).toBe(
      "allow",
    );
    expect(rejected.outcome).toBe("reject");
    expect(rejected.specification).toMatchObject({
      passed: false,
      error: {
        ownerContext: "group",
        reasonCode: "group_provider_capability_not_supported",
      },
    });
  });

  it("rejects non-group JIDs and owner mutation shortcuts", () => {
    expect(() =>
      createGroup({
        id: createGroupId("group_invalid_jid"),
        instanceId: createInstanceId("instance_invalid_jid"),
        jid: createJid("12025550123@s.whatsapp.net"),
        metadata: {
          subject: "Not a group",
        },
      }),
    ).toThrow(TypeError);

    const ownerJid = createJid("12025550124@s.whatsapp.net");
    const group = activateGroup(
      createGroup({
        id: createGroupId("group_owner_1"),
        instanceId: createInstanceId("instance_owner_1"),
        jid: createJid("67890@g.us"),
        metadata: {
          subject: "Owner Group",
        },
        members: [
          createGroupMember({
            jid: ownerJid,
            role: "owner",
          }),
        ],
      }),
    );

    expect(() =>
      removeGroupMember(
        group,
        ownerJid,
        createGroupAction({
          id: createGroupActionId("group_action_owner"),
          kind: "remove_member",
          actorRef: "api_key:test",
          targetJid: ownerJid,
        }),
      ),
    ).toThrow(TypeError);
  });
});
