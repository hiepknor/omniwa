import {
  activateGroup,
  createGroup,
  createGroupId,
  createGroupMember,
  createInstanceId,
  createJid,
  type Group,
  type GroupId,
  type GroupRepositoryPort,
  type RepositorySaveResult,
} from "@omniwa/domain";
import { createCorrelationId, createRequestContext, createRequestId, ok } from "@omniwa/shared";
import { describe, expect, it } from "vitest";

import { createApplicationCommandEnvelope } from "../../commands/command-model.js";
import type {
  ApplicationPortContext,
  ApplicationPortResult,
} from "../../ports/application-port.js";
import {
  createGroupMutationIntentRef,
  type GroupMutationIntentInput,
  type GroupMutationIntentReceipt,
  type GroupMutationIntentRef,
  type GroupMutationIntentStorePort,
  type StoredGroupMutationIntent,
} from "../../ports/group-mutation-intent-store.js";
import type {
  DomainEventPublicationReceipt,
  DomainEventPublisher,
  DomainEventPublisherInput,
} from "../domain-event-publisher.js";
import {
  createGroupMutationHandler,
  type GroupMutationCommandName,
} from "./group-mutation.handler.js";

const requestContext = createRequestContext({
  requestId: createRequestId("group-mutation-request"),
  correlationId: createCorrelationId("group-mutation-correlation"),
});
const groupId = createGroupId("group_mutation_1");
const instanceId = createInstanceId("inst_group_mutation_1");
const intentRef = createGroupMutationIntentRef("group_mutation_intent_1");

describe("group mutation handler", () => {
  it("updates group metadata, records audit action evidence, and publishes only new events", async () => {
    const groupRepository = new FakeGroupRepository([activeGroup()]);
    const publisher = new FakeDomainEventPublisher();
    const handler = createGroupMutationHandler({
      commandName: "UpdateGroupMetadata",
      groupRepository,
      groupMutationIntentStore: new FakeGroupMutationIntentStore({
        groupMutationIntentRef: intentRef,
        kind: "metadata",
        subject: "New subject",
        createdAtEpochMilliseconds: 1,
      }),
      domainEventPublisher: publisher,
    });

    const outcome = await handler(
      command("UpdateGroupMetadata", "cmd-update-group-metadata", "idem-update-group-metadata"),
    );
    const saved = await groupRepository.load(groupId);

    expect(outcome).toEqual({
      kind: "command_outcome",
      commandRef: "cmd-update-group-metadata",
      outcome: "completed",
      accepted: true,
      retryable: false,
      resultRef: "group_mutation_1",
    });
    expect(saved?.metadata.subject).toBe("New subject");
    expect(saved?.actions).toEqual([
      expect.objectContaining({
        kind: "update_metadata",
        actorRef: "api_key:test",
        auditRequired: true,
      }),
    ]);
    expect(publisher.publishedNames()).toEqual(["GroupMetadataUpdated"]);
    expect(JSON.stringify(outcome)).not.toContain("@g.us");
    expect(JSON.stringify(publisher.inputs)).not.toContain("@g.us");
  });

  it("does not duplicate actions or events for the same idempotency key", async () => {
    const groupRepository = new FakeGroupRepository([activeGroup()]);
    const publisher = new FakeDomainEventPublisher();
    const handler = createGroupMutationHandler({
      commandName: "UpdateGroupMetadata",
      groupRepository,
      groupMutationIntentStore: new FakeGroupMutationIntentStore({
        groupMutationIntentRef: intentRef,
        kind: "metadata",
        subject: "Idempotent subject",
        createdAtEpochMilliseconds: 1,
      }),
      domainEventPublisher: publisher,
    });
    const envelope = command(
      "UpdateGroupMetadata",
      "cmd-update-group-metadata-duplicate",
      "idem-update-group-metadata-duplicate",
    );

    await handler(envelope);
    const second = await handler(envelope);
    const saved = await groupRepository.load(groupId);

    expect(second).toEqual({
      kind: "command_outcome",
      commandRef: "cmd-update-group-metadata-duplicate",
      outcome: "completed",
      accepted: true,
      retryable: false,
      resultRef: "group_mutation_1",
    });
    expect(saved?.actions).toHaveLength(1);
    expect(publisher.inputs).toHaveLength(1);
  });

  it("adds a group member without leaking the raw member JID through outcome or events", async () => {
    const rawMemberJid = "12025550123@s.whatsapp.net";
    const groupRepository = new FakeGroupRepository([activeGroup()]);
    const publisher = new FakeDomainEventPublisher();
    const handler = createGroupMutationHandler({
      commandName: "AddGroupMember",
      groupRepository,
      groupMutationIntentStore: new FakeGroupMutationIntentStore({
        groupMutationIntentRef: intentRef,
        kind: "add_member",
        memberJid: rawMemberJid,
        createdAtEpochMilliseconds: 1,
      }),
      domainEventPublisher: publisher,
    });

    const outcome = await handler(command("AddGroupMember", "cmd-add-member", "idem-add-member"));
    const replay = await handler(command("AddGroupMember", "cmd-add-member", "idem-add-member"));
    const saved = await groupRepository.load(groupId);
    const serializedPublicSurface = JSON.stringify({ outcome, published: publisher.inputs });

    expect(outcome).toMatchObject({
      outcome: "accepted",
      accepted: true,
      retryable: false,
    });
    expect(replay).toMatchObject({
      outcome: "accepted",
      accepted: true,
      retryable: false,
    });
    expect(saved?.members).toHaveLength(1);
    expect(saved?.actions[0]).toMatchObject({
      kind: "add_member",
      auditRequired: true,
    });
    expect(publisher.inputs).toHaveLength(1);
    expect(serializedPublicSurface).not.toContain(rawMemberJid);
    expect(serializedPublicSurface).not.toContain("12025550123");
  });

  it("promotes, demotes, and removes an existing member by safe memberRef", async () => {
    const groupRepository = new FakeGroupRepository([activeGroupWithMember()]);
    const publisher = new FakeDomainEventPublisher();
    const promote = createGroupMutationHandler({
      commandName: "PromoteGroupMember",
      groupRepository,
      groupMutationIntentStore: new FakeGroupMutationIntentStore({
        groupMutationIntentRef: intentRef,
        kind: "promote_member",
        memberRef: `${String(groupId)}:member:1`,
        createdAtEpochMilliseconds: 1,
      }),
      domainEventPublisher: publisher,
    });
    const demote = createGroupMutationHandler({
      commandName: "DemoteGroupMember",
      groupRepository,
      groupMutationIntentStore: new FakeGroupMutationIntentStore({
        groupMutationIntentRef: intentRef,
        kind: "demote_member",
        memberRef: "member_1",
        createdAtEpochMilliseconds: 1,
      }),
      domainEventPublisher: publisher,
    });
    const remove = createGroupMutationHandler({
      commandName: "RemoveGroupMember",
      groupRepository,
      groupMutationIntentStore: new FakeGroupMutationIntentStore({
        groupMutationIntentRef: intentRef,
        kind: "remove_member",
        memberRef: `${String(groupId)}:member:1`,
        createdAtEpochMilliseconds: 1,
      }),
      domainEventPublisher: publisher,
    });

    const promoted = await promote(command("PromoteGroupMember", "cmd-promote", "idem-promote"));
    expect(promoted.outcome).toBe("accepted");
    expect((await groupRepository.load(groupId))?.members[0]?.role).toBe("admin");

    const demoted = await demote(command("DemoteGroupMember", "cmd-demote", "idem-demote"));
    expect(demoted.outcome).toBe("accepted");
    expect((await groupRepository.load(groupId))?.members[0]?.role).toBe("member");

    const removed = await remove(command("RemoveGroupMember", "cmd-remove", "idem-remove"));
    expect(removed.outcome).toBe("accepted");
    const saved = await groupRepository.load(groupId);

    expect(saved?.members).toHaveLength(0);
    expect(saved?.actions.map((action) => action.kind)).toEqual([
      "promote_member",
      "demote_member",
      "remove_member",
    ]);
    expect(saved?.actions.every((action) => action.auditRequired)).toBe(true);
    expect(JSON.stringify(publisher.inputs)).not.toContain("@s.whatsapp.net");
  });

  it("fails safely when the intent kind does not match the command", async () => {
    const groupRepository = new FakeGroupRepository([activeGroup()]);
    const handler = createGroupMutationHandler({
      commandName: "UpdateGroupMetadata",
      groupRepository,
      groupMutationIntentStore: new FakeGroupMutationIntentStore({
        groupMutationIntentRef: intentRef,
        kind: "add_member",
        memberJid: "12025550123@s.whatsapp.net",
        createdAtEpochMilliseconds: 1,
      }),
      domainEventPublisher: new FakeDomainEventPublisher(),
    });

    const outcome = await handler(command("UpdateGroupMetadata", "cmd-mismatch", "idem-mismatch"));

    expect(outcome).toMatchObject({
      outcome: "rejected",
      accepted: false,
      retryable: false,
      reasonCode: "group_mutation_intent_mismatch",
    });
    expect(JSON.stringify(outcome)).not.toContain("12025550123");
  });
});

function command(name: GroupMutationCommandName, commandRef: string, idempotencyKey: string) {
  return createApplicationCommandEnvelope({
    name,
    commandRef,
    requestContext,
    actorRef: "api_key:test",
    targetRef: String(groupId),
    safeInputRef: String(intentRef),
    idempotencyKey,
    dataClassification: "confidential",
  });
}

function activeGroup(): Group {
  return activateGroup(
    createGroup({
      id: groupId,
      instanceId,
      jid: createJid("12345@g.us"),
      metadata: {
        subject: "Original subject",
      },
    }),
  );
}

function activeGroupWithMember(): Group {
  return activateGroup(
    createGroup({
      id: groupId,
      instanceId,
      jid: createJid("12345@g.us"),
      metadata: {
        subject: "Original subject",
      },
      members: [
        createGroupMember({
          jid: createJid("12025550124@s.whatsapp.net"),
          role: "member",
        }),
      ],
    }),
  );
}

class FakeGroupRepository implements GroupRepositoryPort {
  private readonly records = new Map<string, Group>();

  constructor(initialRecords: readonly Group[]) {
    for (const record of initialRecords) {
      this.records.set(String(record.id), record);
    }
  }

  load(id: GroupId): Promise<Group | undefined> {
    return Promise.resolve(this.records.get(String(id)));
  }

  save(aggregate: Group): Promise<RepositorySaveResult> {
    this.records.set(String(aggregate.id), aggregate);
    return Promise.resolve({ saved: true });
  }

  exists(id: GroupId): Promise<boolean> {
    return Promise.resolve(this.records.has(String(id)));
  }

  findByInstance(): Promise<readonly Group[]> {
    return Promise.resolve([...this.records.values()]);
  }

  findByStatus(): Promise<readonly Group[]> {
    return Promise.resolve([...this.records.values()]);
  }

  findByJid(): Promise<Group | undefined> {
    return Promise.resolve(undefined);
  }
}

class FakeGroupMutationIntentStore implements GroupMutationIntentStorePort {
  constructor(private readonly intent: StoredGroupMutationIntent) {}

  storeGroupMutationIntent(
    intent: GroupMutationIntentInput,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<GroupMutationIntentReceipt>> {
    void intent;
    void context;

    return Promise.resolve(
      ok({
        groupMutationIntentRef: this.intent.groupMutationIntentRef,
        kind: this.intent.kind,
        createdAtEpochMilliseconds: this.intent.createdAtEpochMilliseconds,
      }),
    );
  }

  resolveGroupMutationIntent(
    groupMutationIntentRef: GroupMutationIntentRef,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<StoredGroupMutationIntent>> {
    void groupMutationIntentRef;
    void context;

    return Promise.resolve(ok(this.intent));
  }
}

class FakeDomainEventPublisher implements DomainEventPublisher {
  readonly inputs: DomainEventPublisherInput[] = [];

  publishNewEvents(
    input: DomainEventPublisherInput,
  ): Promise<ApplicationPortResult<DomainEventPublicationReceipt>> {
    this.inputs.push(input);

    return Promise.resolve(
      ok({
        publishedEvents: Object.freeze([]),
      }),
    );
  }

  publishedNames(): readonly string[] {
    return this.inputs.flatMap((input) =>
      input.aggregateEvents.slice(input.baseEventCount).map((event) => event.name),
    );
  }
}
