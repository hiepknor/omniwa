import {
  addGroupMember,
  createGroupAction,
  createGroupActionId,
  createGroupId,
  createGroupMember,
  createJid,
  demoteGroupMember,
  promoteGroupMember,
  removeGroupMember,
  setGroupArchived,
  setGroupMuted,
  setGroupPinned,
  updateGroupMetadata,
  type Group,
  type GroupActionKind,
  type GroupRepositoryPort,
  type Jid,
} from "@omniwa/domain";

import {
  type ApplicationCommandEnvelope,
  type ApplicationCommandOutcome,
  createApplicationCommandOutcome,
} from "../../commands/command-model.js";
import {
  createGroupMutationIntentRef,
  type GroupMutationIntentStorePort,
  type StoredGroupMutationIntent,
} from "../../ports/group-mutation-intent-store.js";
import type { DomainEventPublisher } from "../domain-event-publisher.js";
import type { CommandHandler } from "./command-handler.js";

export type GroupMutationCommandName =
  | "UpdateGroupMetadata"
  | "UpdateGroupLocalState"
  | "AddGroupMember"
  | "RemoveGroupMember"
  | "PromoteGroupMember"
  | "DemoteGroupMember";

export type GroupMutationHandlerOptions = Readonly<{
  commandName: GroupMutationCommandName;
  groupRepository: GroupRepositoryPort;
  groupMutationIntentStore: GroupMutationIntentStorePort;
  domainEventPublisher: DomainEventPublisher;
}>;

export function createGroupMutationHandler(options: GroupMutationHandlerOptions): CommandHandler {
  const handler = new GroupMutationHandler(options);
  return (envelope) => handler.handle(envelope);
}

class GroupMutationHandler {
  private readonly commandName: GroupMutationCommandName;
  private readonly groupRepository: GroupRepositoryPort;
  private readonly groupMutationIntentStore: GroupMutationIntentStorePort;
  private readonly domainEventPublisher: DomainEventPublisher;

  constructor(options: GroupMutationHandlerOptions) {
    this.commandName = options.commandName;
    this.groupRepository = options.groupRepository;
    this.groupMutationIntentStore = options.groupMutationIntentStore;
    this.domainEventPublisher = options.domainEventPublisher;
  }

  async handle(envelope: ApplicationCommandEnvelope): Promise<ApplicationCommandOutcome> {
    const input = this.resolveInput(envelope);

    if (!input.ok) {
      return commandOutcome(envelope, "failed", {
        accepted: false,
        retryable: false,
        reasonCode: input.reasonCode,
      });
    }

    const group = await this.groupRepository.load(input.groupId);

    if (group === undefined || group.status === "deleted") {
      return commandOutcome(envelope, "failed", {
        accepted: false,
        retryable: false,
        reasonCode: "group_mutation_group_not_found",
      });
    }

    if (hasAction(group, input.actionId)) {
      return commandOutcome(envelope, successfulOutcomeForGroupMutation(this.commandName), {
        accepted: true,
        retryable: false,
        resultRef: group.id,
      });
    }

    const intentResult = await this.groupMutationIntentStore.resolveGroupMutationIntent(
      input.intentRef,
      commandContext(envelope),
    );

    if (!intentResult.ok) {
      return commandOutcome(envelope, "failed", {
        accepted: false,
        retryable: intentResult.error.retryable,
        reasonCode: intentResult.error.code,
      });
    }

    if (!intentMatchesCommand(this.commandName, intentResult.value)) {
      return commandOutcome(envelope, "rejected", {
        accepted: false,
        retryable: false,
        reasonCode: "group_mutation_intent_mismatch",
      });
    }

    const baseEventCount = group.domainEvents.length;
    const mutationResult = applyGroupMutation(group, intentResult.value, {
      id: input.actionId,
      actorRef: envelope.actorRef ?? "api_key:unknown",
    });

    if (!mutationResult.ok) {
      return commandOutcome(envelope, "rejected", {
        accepted: false,
        retryable: false,
        reasonCode: mutationResult.reasonCode,
      });
    }

    await this.groupRepository.save(mutationResult.group);
    const publishResult = await this.domainEventPublisher.publishNewEvents({
      aggregateEvents: mutationResult.group.domainEvents,
      baseEventCount,
      executionRef: `${envelope.commandRef}:group`,
      context: commandContext(envelope),
    });

    if (!publishResult.ok) {
      return commandOutcome(envelope, "failed", {
        accepted: true,
        retryable: publishResult.error.retryable,
        reasonCode: publishResult.error.code,
        resultRef: mutationResult.group.id,
      });
    }

    return commandOutcome(envelope, successfulOutcomeForGroupMutation(this.commandName), {
      accepted: true,
      retryable: false,
      resultRef: mutationResult.group.id,
    });
  }

  private resolveInput(envelope: ApplicationCommandEnvelope):
    | Readonly<{
        ok: true;
        groupId: ReturnType<typeof createGroupId>;
        intentRef: ReturnType<typeof createGroupMutationIntentRef>;
        actionId: ReturnType<typeof createGroupActionId>;
      }>
    | Readonly<{ ok: false; reasonCode: string }> {
    if (envelope.name !== this.commandName) {
      return { ok: false, reasonCode: "group_mutation_wrong_command" };
    }

    if (envelope.targetRef === undefined) {
      return { ok: false, reasonCode: "group_mutation_group_required" };
    }

    if (envelope.safeInputRef === undefined) {
      return { ok: false, reasonCode: "group_mutation_input_ref_required" };
    }

    if (envelope.idempotencyKey === undefined) {
      return { ok: false, reasonCode: "group_mutation_idempotency_required" };
    }

    try {
      return {
        ok: true,
        groupId: createGroupId(envelope.targetRef),
        intentRef: createGroupMutationIntentRef(envelope.safeInputRef),
        actionId: createGroupActionId(
          `group_action:${stableToken(
            `${this.commandName}:${envelope.targetRef}:${envelope.idempotencyKey}`,
          )}`,
        ),
      };
    } catch {
      return { ok: false, reasonCode: "group_mutation_input_invalid" };
    }
  }
}

type GroupMutationActionBase = Readonly<{
  id: ReturnType<typeof createGroupActionId>;
  actorRef: string;
}>;

type GroupMutationResult =
  Readonly<{ ok: true; group: Group }> | Readonly<{ ok: false; reasonCode: string }>;

function applyGroupMutation(
  group: Group,
  intent: StoredGroupMutationIntent,
  actionBase: GroupMutationActionBase,
): GroupMutationResult {
  try {
    switch (intent.kind) {
      case "metadata":
        return okGroup(
          updateGroupMetadata(
            group,
            {
              ...(intent.subject === undefined ? {} : { subject: intent.subject }),
              ...(intent.description === undefined ? {} : { description: intent.description }),
            },
            action(actionBase, "update_metadata"),
          ),
        );
      case "local_state":
        return applyLocalStateMutation(group, intent, actionBase);
      case "add_member": {
        const memberJid = createJid(intent.memberJid);
        return okGroup(
          addGroupMember(
            group,
            createGroupMember({ jid: memberJid }),
            action(actionBase, "add_member", memberJid),
          ),
        );
      }
      case "remove_member": {
        const memberJid = resolveExistingMemberJid(group, intent.memberRef);
        return okGroup(
          removeGroupMember(group, memberJid, action(actionBase, "remove_member", memberJid)),
        );
      }
      case "promote_member": {
        const memberJid = resolveExistingMemberJid(group, intent.memberRef);
        return okGroup(
          promoteGroupMember(group, memberJid, action(actionBase, "promote_member", memberJid)),
        );
      }
      case "demote_member": {
        const memberJid = resolveExistingMemberJid(group, intent.memberRef);
        return okGroup(
          demoteGroupMember(group, memberJid, action(actionBase, "demote_member", memberJid)),
        );
      }
    }
  } catch {
    return { ok: false, reasonCode: "group_mutation_rejected" };
  }
}

function applyLocalStateMutation(
  group: Group,
  intent: Extract<StoredGroupMutationIntent, { kind: "local_state" }>,
  actionBase: GroupMutationActionBase,
): GroupMutationResult {
  let next = group;

  try {
    if (intent.muted !== undefined) {
      next = setGroupMuted(
        next,
        intent.muted,
        action(actionBase, intent.muted ? "mute" : "unmute"),
      );
    }

    if (intent.archived !== undefined) {
      next = setGroupArchived(
        next,
        intent.archived,
        action(actionBase, intent.archived ? "archive" : "unarchive"),
      );
    }

    if (intent.pinned !== undefined) {
      next = setGroupPinned(
        next,
        intent.pinned,
        action(actionBase, intent.pinned ? "pin" : "unpin"),
      );
    }

    return okGroup(next);
  } catch {
    return { ok: false, reasonCode: "group_mutation_rejected" };
  }
}

function action(
  input: GroupMutationActionBase,
  kind: GroupActionKind,
  targetJid?: Jid,
): ReturnType<typeof createGroupAction> {
  return createGroupAction({
    id: input.id,
    kind,
    actorRef: input.actorRef,
    ...(targetJid === undefined ? {} : { targetJid }),
  });
}

function okGroup(group: Group): GroupMutationResult {
  return { ok: true, group };
}

function resolveExistingMemberJid(group: Group, memberRef: string): Jid {
  const normalized = memberRef.trim();
  const exact = group.members.find(
    (_member, index) =>
      normalized === `${String(group.id)}:member:${index + 1}` ||
      normalized === `member_${index + 1}`,
  );

  if (exact === undefined) {
    throw new TypeError("Group member reference was not found.");
  }

  return exact.jid;
}

function intentMatchesCommand(
  commandName: GroupMutationCommandName,
  intent: StoredGroupMutationIntent,
): boolean {
  return (
    (commandName === "UpdateGroupMetadata" && intent.kind === "metadata") ||
    (commandName === "UpdateGroupLocalState" && intent.kind === "local_state") ||
    (commandName === "AddGroupMember" && intent.kind === "add_member") ||
    (commandName === "RemoveGroupMember" && intent.kind === "remove_member") ||
    (commandName === "PromoteGroupMember" && intent.kind === "promote_member") ||
    (commandName === "DemoteGroupMember" && intent.kind === "demote_member")
  );
}

function successfulOutcomeForGroupMutation(
  commandName: GroupMutationCommandName,
): ApplicationCommandOutcome["outcome"] {
  return isMemberMutationCommand(commandName) ? "accepted" : "completed";
}

function isMemberMutationCommand(commandName: GroupMutationCommandName): boolean {
  return [
    "AddGroupMember",
    "RemoveGroupMember",
    "PromoteGroupMember",
    "DemoteGroupMember",
  ].includes(commandName);
}

function hasAction(group: Group, actionId: ReturnType<typeof createGroupActionId>): boolean {
  return group.actions.some((candidate) => candidate.id === actionId);
}

function commandContext(
  envelope: ApplicationCommandEnvelope,
): Parameters<DomainEventPublisher["publishNewEvents"]>[0]["context"] {
  return {
    requestContext: envelope.requestContext,
    ...(envelope.actorRef === undefined ? {} : { actorRef: envelope.actorRef }),
    ...(envelope.idempotencyKey === undefined ? {} : { idempotencyKey: envelope.idempotencyKey }),
    ...(envelope.dataClassification === undefined
      ? {}
      : { dataClassification: envelope.dataClassification }),
  };
}

function commandOutcome(
  envelope: ApplicationCommandEnvelope,
  outcome: ApplicationCommandOutcome["outcome"],
  patch: Omit<ApplicationCommandOutcome, "kind" | "commandRef" | "outcome">,
): ApplicationCommandOutcome {
  return createApplicationCommandOutcome({
    commandRef: envelope.commandRef,
    outcome,
    ...patch,
  });
}

function stableToken(value: string): string {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}
