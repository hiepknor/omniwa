import {
  classifyHealthy,
  createChat,
  createChatId,
  createContact,
  createContactDisplayName,
  createContactId,
  createDeadLetterReason,
  createGroup,
  createGroupId,
  createGroupMember,
  createJobId,
  createAttemptNumber,
  createInstanceId,
  createHealthStatus,
  createHealthStatusId,
  createJid,
  createLabelId,
  createMessageId,
  createOutboundMessageIntent,
  createPhoneNumber,
  createRetryPolicy,
  createSession,
  createSessionId,
  createWebhookDeliveryId,
  createWebhookId,
  createWebhookSubscription,
  createWebhookUrl,
  deadLetterWebhookDelivery,
  queueWorkerJob,
  scheduleWebhookDelivery,
  startWebhookDelivery,
  succeedWebhookDelivery,
  type DomainOwnerContext,
  type Chat,
  type ChatId,
  type ChatRepositoryPort,
  type ChatStatus,
  type Contact,
  type ContactId,
  type ContactRepositoryPort,
  type ContactStatus,
  type Group,
  type GroupId,
  type GroupRepositoryPort,
  type GroupStatus,
  type HealthCategory,
  type HealthStatus,
  type HealthStatusId,
  type HealthStatusRepositoryPort,
  type IdempotencyKey,
  type Instance,
  type InstanceId,
  type InstanceRepositoryPort,
  type InstanceStatus,
  type JobId,
  type JobStatus,
  type Jid,
  type LabelId,
  type Message,
  type MessageId,
  type MessageRepositoryPort,
  type MessageStatus,
  type RepositorySaveResult,
  type Session,
  type SessionId,
  type SessionRepositoryPort,
  type SessionStatus,
  type WebhookDelivery,
  type WebhookDeliveryId,
  type WebhookDeliveryRepositoryPort,
  type WebhookDeliveryStatus,
  type WebhookId,
  type WebhookSubscription,
  type WebhookSubscriptionRepositoryPort,
  type WebhookSubscriptionStatus,
  type WorkerJob,
  type WorkerJobRepositoryPort,
} from "@omniwa/domain";
import {
  createCorrelationId,
  createRequestContext,
  createRequestId,
  createUuid,
  ok,
  toIsoTimestamp,
  type Clock,
  type UUIDGenerator,
} from "@omniwa/shared";
import { describe, expect, it } from "vitest";

import { createApplicationCommandEnvelope } from "../commands/command-model.js";
import type { ApplicationPortContext, ApplicationPortResult } from "../ports/application-port.js";
import {
  createWebhookDeliveryOperationIntentRef,
  type StoredWebhookDeliveryOperationIntent,
  type WebhookDeliveryOperationIntentInput,
  type WebhookDeliveryOperationIntentReceipt,
  type WebhookDeliveryOperationIntentRef,
  type WebhookDeliveryOperationIntentStorePort,
} from "../ports/webhook-delivery-operation-intent-store.js";
import type {
  EventLogReplayPort,
  EventLogReplayResult,
  PlatformEventRecord,
} from "../ports/event-log.js";
import type {
  QueueProviderPort,
  QueueReservation,
  QueueVisibilityReceipt,
  QueueWorkRequest,
  QueueWorkType,
} from "../ports/queue-provider.js";
import { createApplicationQueryEnvelope } from "../queries/query-model.js";
import { createApplicationDispatcher } from "./application-dispatcher.js";

const requestContext = createRequestContext({
  requestId: createRequestId("dispatcher-request"),
  correlationId: createCorrelationId("dispatcher-correlation"),
});

const fixedClock: Clock = {
  now: () => new Date("2026-07-01T00:00:00.000Z"),
  epochMilliseconds: () => 1_782_864_000_000,
  isoNow: () => toIsoTimestamp(new Date("2026-07-01T00:00:00.000Z")),
};

const fixedUuidGenerator: UUIDGenerator = {
  random: () => createUuid("550e8400-e29b-41d4-a716-446655440000"),
};

const retryPolicy = createRetryPolicy({
  maxAttempts: 3,
  initialDelayMilliseconds: 100,
  backoffMultiplier: 2,
});

describe("application dispatcher", () => {
  it("executes CreateInstance through the Instance repository", async () => {
    const instanceRepository = new FakeInstanceRepository();
    const dispatcher = createApplicationDispatcher({
      repositories: { instanceRepository },
      uuidGenerator: fixedUuidGenerator,
      clock: fixedClock,
    });

    const outcome = await dispatcher.executeCommand(
      createApplicationCommandEnvelope({
        name: "CreateInstance",
        commandRef: "cmd-create-instance",
        requestContext,
        actorRef: "api_key:test",
        idempotencyKey: "idem-create-instance",
        safeInput: {
          displayName: "Primary Demo Instance",
        },
      }),
    );

    expect(outcome).toEqual({
      kind: "command_outcome",
      commandRef: "cmd-create-instance",
      outcome: "completed",
      accepted: true,
      retryable: false,
      resultRef: "inst:550e8400-e29b-41d4-a716-446655440000",
    });
    expect(instanceRepository.list()).toHaveLength(1);
    expect(instanceRepository.list()[0]?.status).toBe("created");
    expect(instanceRepository.list()[0]?.metadata.displayName).toBe("Primary Demo Instance");
  });

  it("rejects invalid CreateInstance displayName without saving an instance", async () => {
    const instanceRepository = new FakeInstanceRepository();
    const dispatcher = createApplicationDispatcher({
      repositories: { instanceRepository },
      uuidGenerator: fixedUuidGenerator,
      clock: fixedClock,
    });

    const outcome = await dispatcher.executeCommand(
      createApplicationCommandEnvelope({
        name: "CreateInstance",
        commandRef: "cmd-create-instance-invalid-name",
        requestContext,
        actorRef: "api_key:test",
        idempotencyKey: "idem-create-instance-invalid-name",
        safeInput: {
          displayName: "x".repeat(121),
        },
      }),
    );

    expect(outcome).toEqual({
      kind: "command_outcome",
      commandRef: "cmd-create-instance-invalid-name",
      outcome: "failed",
      accepted: false,
      retryable: false,
      reasonCode: "create_instance_display_name_invalid",
    });
    expect(instanceRepository.list()).toHaveLength(0);
  });

  it("executes ListInstances as a side-effect free repository query", async () => {
    const instanceRepository = new FakeInstanceRepository();
    const dispatcher = createApplicationDispatcher({
      repositories: { instanceRepository },
      uuidGenerator: fixedUuidGenerator,
      clock: fixedClock,
    });

    await dispatcher.executeCommand(
      createApplicationCommandEnvelope({
        name: "CreateInstance",
        commandRef: "cmd-create-instance",
        requestContext,
        actorRef: "api_key:test",
        idempotencyKey: "idem-create-instance",
        safeInput: {
          displayName: "Dispatcher Demo",
        },
      }),
    );
    const outcome = await dispatcher.executeQuery(
      createApplicationQueryEnvelope({
        name: "ListInstances",
        queryRef: "qry-list-instances",
        requestContext,
        actorRef: "api_key:test",
        requestedConsistency: "eventual_projection",
      }),
    );

    expect(outcome).toEqual({
      kind: "query_outcome",
      queryRef: "qry-list-instances",
      outcome: "result",
      consistency: "eventual_projection",
      freshness: {
        stale: false,
        refreshedAtEpochMilliseconds: 1_782_864_000_000,
      },
      resultRef: "instances:list:1",
      items: [
        {
          id: "inst:550e8400-e29b-41d4-a716-446655440000",
          status: "created",
          displayName: "Dispatcher Demo",
        },
      ],
    });
    expect(instanceRepository.list()).toHaveLength(1);
    expect(JSON.stringify(outcome)).not.toContain("domainEvents");
  });

  it("executes GetInstanceStatus as a side-effect free repository query", async () => {
    const instanceRepository = new FakeInstanceRepository();
    const dispatcher = createApplicationDispatcher({
      repositories: { instanceRepository },
      uuidGenerator: fixedUuidGenerator,
      clock: fixedClock,
    });

    await dispatcher.executeCommand(
      createApplicationCommandEnvelope({
        name: "CreateInstance",
        commandRef: "cmd-create-instance",
        requestContext,
        actorRef: "api_key:test",
        idempotencyKey: "idem-create-instance",
        safeInput: {
          displayName: "Dispatcher Detail",
        },
      }),
    );
    const outcome = await dispatcher.executeQuery(
      createApplicationQueryEnvelope({
        name: "GetInstanceStatus",
        queryRef: "qry-get-instance",
        requestContext,
        actorRef: "api_key:test",
        targetRef: "inst:550e8400-e29b-41d4-a716-446655440000",
        requestedConsistency: "strong_owner",
      }),
    );

    expect(outcome).toEqual({
      kind: "query_outcome",
      queryRef: "qry-get-instance",
      outcome: "result",
      consistency: "strong_owner",
      freshness: {
        stale: false,
        refreshedAtEpochMilliseconds: 1_782_864_000_000,
      },
      resultRef: "instance:inst:550e8400-e29b-41d4-a716-446655440000:created",
      resource: {
        id: "inst:550e8400-e29b-41d4-a716-446655440000",
        status: "created",
        displayName: "Dispatcher Detail",
      },
    });
    expect(JSON.stringify(outcome)).not.toContain("domainEvents");
  });

  it("returns empty for missing instance status queries", async () => {
    const dispatcher = createApplicationDispatcher({
      repositories: { instanceRepository: new FakeInstanceRepository() },
      clock: fixedClock,
    });

    const outcome = await dispatcher.executeQuery(
      createApplicationQueryEnvelope({
        name: "GetInstanceStatus",
        queryRef: "qry-get-missing-instance",
        requestContext,
        actorRef: "api_key:test",
        targetRef: "inst_missing",
        requestedConsistency: "strong_owner",
      }),
    );

    expect(outcome).toEqual({
      kind: "query_outcome",
      queryRef: "qry-get-missing-instance",
      outcome: "empty",
      consistency: "strong_owner",
      freshness: {
        stale: false,
        refreshedAtEpochMilliseconds: 1_782_864_000_000,
      },
      resultRef: "instance:inst_missing:empty",
    });
  });

  it("executes ListInstanceSessions as a side-effect free repository query", async () => {
    const session = createSession(createSessionId("sess:one"), createInstanceId("inst:one"));
    const dispatcher = createApplicationDispatcher({
      repositories: {
        instanceRepository: new FakeInstanceRepository(),
        sessionRepository: new FakeSessionRepository([session]),
      },
      clock: fixedClock,
    });

    const outcome = await dispatcher.executeQuery(
      createApplicationQueryEnvelope({
        name: "ListInstanceSessions",
        queryRef: "qry-list-instance-sessions",
        requestContext,
        actorRef: "api_key:test",
        targetRef: "inst:one",
        requestedConsistency: "eventual_projection",
      }),
    );

    expect(outcome).toEqual({
      kind: "query_outcome",
      queryRef: "qry-list-instance-sessions",
      outcome: "result",
      consistency: "eventual_projection",
      freshness: {
        stale: false,
        refreshedAtEpochMilliseconds: 1_782_864_000_000,
      },
      resultRef: "sessions:inst:one:list:1",
      items: [
        {
          id: "sess:one",
          instanceId: "inst:one",
          status: "empty",
        },
      ],
    });
    expect(JSON.stringify(outcome)).not.toContain("domainEvents");
  });

  it("executes ListInstanceMessages through the Message repository without leaking payloads", async () => {
    const message = createOutboundMessageIntent({
      id: createMessageId("msg:one"),
      instanceId: createInstanceId("inst:one"),
      type: "text",
    });
    const otherMessage = createOutboundMessageIntent({
      id: createMessageId("msg:other"),
      instanceId: createInstanceId("inst:other"),
      type: "text",
    });
    const dispatcher = createApplicationDispatcher({
      repositories: {
        instanceRepository: new FakeInstanceRepository(),
        messageRepository: new FakeMessageRepository([message, otherMessage]),
      },
      clock: fixedClock,
    });

    const outcome = await dispatcher.executeQuery(
      createApplicationQueryEnvelope({
        name: "ListInstanceMessages",
        queryRef: "qry-list-instance-messages",
        requestContext,
        actorRef: "api_key:test",
        targetRef: "inst:one",
        requestedConsistency: "retention_bound",
      }),
    );

    expect(outcome).toEqual({
      kind: "query_outcome",
      queryRef: "qry-list-instance-messages",
      outcome: "result",
      consistency: "retention_bound",
      freshness: {
        stale: false,
        refreshedAtEpochMilliseconds: 1_782_864_000_000,
      },
      resultRef: "messages:inst:one:1",
      items: [
        {
          id: "msg:one",
          instanceId: "inst:one",
          direction: "outbound",
          type: "text",
          status: "created",
        },
      ],
    });
    expect(JSON.stringify(outcome)).not.toContain("raw");
    expect(JSON.stringify(outcome)).not.toContain("jid");
    expect(JSON.stringify(outcome)).not.toContain("outboundIntentRef");
    expect(JSON.stringify(outcome)).not.toContain("domainEvents");
  });

  it("executes GetMessageStatus through the Message repository without leaking payloads", async () => {
    const message = createOutboundMessageIntent({
      id: createMessageId("msg:detail"),
      instanceId: createInstanceId("inst:detail"),
      type: "text",
    });
    const dispatcher = createApplicationDispatcher({
      repositories: {
        instanceRepository: new FakeInstanceRepository(),
        messageRepository: new FakeMessageRepository([message]),
      },
      clock: fixedClock,
    });

    const outcome = await dispatcher.executeQuery(
      createApplicationQueryEnvelope({
        name: "GetMessageStatus",
        queryRef: "qry-get-message-status",
        requestContext,
        actorRef: "api_key:test",
        targetRef: "msg:detail",
        requestedConsistency: "strong_owner",
      }),
    );

    expect(outcome).toEqual({
      kind: "query_outcome",
      queryRef: "qry-get-message-status",
      outcome: "result",
      consistency: "strong_owner",
      freshness: {
        stale: false,
        refreshedAtEpochMilliseconds: 1_782_864_000_000,
      },
      resultRef: "message:msg:detail:created",
      resource: {
        id: "msg:detail",
        instanceId: "inst:detail",
        direction: "outbound",
        type: "text",
        status: "created",
      },
    });
    expect(JSON.stringify(outcome)).not.toContain("raw");
    expect(JSON.stringify(outcome)).not.toContain("jid");
    expect(JSON.stringify(outcome)).not.toContain("outboundIntentRef");
    expect(JSON.stringify(outcome)).not.toContain("domainEvents");
  });

  it("executes ListChats through the Chat repository without leaking JIDs", async () => {
    const labelId = createLabelId("label:priority");
    const chat = createChat({
      id: createChatId("chat:one"),
      instanceId: createInstanceId("inst:one"),
      jid: createJid("12025550123@s.whatsapp.net"),
      labelIds: [labelId],
      unreadCount: 2,
      muted: true,
      pinned: true,
    });
    const dispatcher = createApplicationDispatcher({
      repositories: {
        instanceRepository: new FakeInstanceRepository(),
        chatRepository: new FakeChatRepository([chat]),
      },
      clock: fixedClock,
    });

    const outcome = await dispatcher.executeQuery(
      createApplicationQueryEnvelope({
        name: "ListChats",
        queryRef: "qry-list-chats",
        requestContext,
        actorRef: "api_key:test",
        requestedConsistency: "eventual_projection",
      }),
    );

    expect(outcome).toEqual({
      kind: "query_outcome",
      queryRef: "qry-list-chats",
      outcome: "result",
      consistency: "eventual_projection",
      freshness: {
        stale: false,
        refreshedAtEpochMilliseconds: 1_782_864_000_000,
      },
      resultRef: "chats:list:1",
      items: [
        {
          id: "chat:one",
          instanceId: "inst:one",
          status: "open",
          type: "direct",
          unreadCount: 2,
          labelIds: ["label:priority"],
          muted: true,
          pinned: true,
        },
      ],
    });
    expect(JSON.stringify(outcome)).not.toContain("@s.whatsapp.net");
    expect(JSON.stringify(outcome)).not.toContain("12025550123");
    expect(JSON.stringify(outcome)).not.toContain("jid");
    expect(JSON.stringify(outcome)).not.toContain("domainEvents");
  });

  it("executes ListInstanceChats through the Chat repository", async () => {
    const chat = createChat({
      id: createChatId("chat:instance"),
      instanceId: createInstanceId("inst:one"),
      jid: createJid("12345@g.us"),
      unreadCount: 1,
    });
    const otherChat = createChat({
      id: createChatId("chat:other"),
      instanceId: createInstanceId("inst:other"),
      jid: createJid("12025550124@s.whatsapp.net"),
    });
    const dispatcher = createApplicationDispatcher({
      repositories: {
        instanceRepository: new FakeInstanceRepository(),
        chatRepository: new FakeChatRepository([chat, otherChat]),
      },
      clock: fixedClock,
    });

    const outcome = await dispatcher.executeQuery(
      createApplicationQueryEnvelope({
        name: "ListInstanceChats",
        queryRef: "qry-list-instance-chats",
        requestContext,
        actorRef: "api_key:test",
        targetRef: "inst:one",
        requestedConsistency: "eventual_projection",
      }),
    );

    expect(outcome).toEqual({
      kind: "query_outcome",
      queryRef: "qry-list-instance-chats",
      outcome: "result",
      consistency: "eventual_projection",
      freshness: {
        stale: false,
        refreshedAtEpochMilliseconds: 1_782_864_000_000,
      },
      resultRef: "chats:inst:one:list:1",
      items: [
        {
          id: "chat:instance",
          instanceId: "inst:one",
          status: "open",
          type: "group",
          unreadCount: 1,
          labelIds: [],
          muted: false,
          pinned: false,
        },
      ],
    });
    expect(JSON.stringify(outcome)).not.toContain("@g.us");
    expect(JSON.stringify(outcome)).not.toContain("@s.whatsapp.net");
  });

  it("executes GetChatStatus through the Chat repository without leaking JIDs", async () => {
    const chat = createChat({
      id: createChatId("chat:detail"),
      instanceId: createInstanceId("inst:detail"),
      jid: createJid("12025550125@s.whatsapp.net"),
      unreadCount: 4,
    });
    const dispatcher = createApplicationDispatcher({
      repositories: {
        instanceRepository: new FakeInstanceRepository(),
        chatRepository: new FakeChatRepository([chat]),
      },
      clock: fixedClock,
    });

    const outcome = await dispatcher.executeQuery(
      createApplicationQueryEnvelope({
        name: "GetChatStatus",
        queryRef: "qry-get-chat-status",
        requestContext,
        actorRef: "api_key:test",
        targetRef: "chat:detail",
        requestedConsistency: "strong_owner",
      }),
    );

    expect(outcome).toEqual({
      kind: "query_outcome",
      queryRef: "qry-get-chat-status",
      outcome: "result",
      consistency: "strong_owner",
      freshness: {
        stale: false,
        refreshedAtEpochMilliseconds: 1_782_864_000_000,
      },
      resultRef: "chat:chat:detail:open",
      resource: {
        id: "chat:detail",
        instanceId: "inst:detail",
        status: "open",
        type: "direct",
        unreadCount: 4,
        labelIds: [],
        muted: false,
        pinned: false,
      },
    });
    expect(JSON.stringify(outcome)).not.toContain("@s.whatsapp.net");
    expect(JSON.stringify(outcome)).not.toContain("12025550125");
    expect(JSON.stringify(outcome)).not.toContain("jid");
  });

  it("executes ListContacts through the Contact repository without leaking JIDs or phone numbers", async () => {
    const contact = createContact({
      id: createContactId("contact:one"),
      instanceId: createInstanceId("inst:one"),
      jid: createJid("12025550123@s.whatsapp.net"),
      displayName: createContactDisplayName("Demo Contact"),
      phoneNumber: createPhoneNumber("+12025550123"),
    });
    const dispatcher = createApplicationDispatcher({
      repositories: {
        instanceRepository: new FakeInstanceRepository(),
        contactRepository: new FakeContactRepository([contact]),
      },
      clock: fixedClock,
    });

    const outcome = await dispatcher.executeQuery(
      createApplicationQueryEnvelope({
        name: "ListContacts",
        queryRef: "qry-list-contacts",
        requestContext,
        actorRef: "api_key:test",
        requestedConsistency: "eventual_projection",
      }),
    );

    expect(outcome).toEqual({
      kind: "query_outcome",
      queryRef: "qry-list-contacts",
      outcome: "result",
      consistency: "eventual_projection",
      freshness: {
        stale: false,
        refreshedAtEpochMilliseconds: 1_782_864_000_000,
      },
      resultRef: "contacts:list:1",
      items: [
        {
          id: "contact:one",
          instanceId: "inst:one",
          status: "discovered",
          displayName: "Demo Contact",
        },
      ],
    });
    expect(JSON.stringify(outcome)).not.toContain("@s.whatsapp.net");
    expect(JSON.stringify(outcome)).not.toContain("12025550123");
    expect(JSON.stringify(outcome)).not.toContain("phoneNumber");
    expect(JSON.stringify(outcome)).not.toContain("jid");
    expect(JSON.stringify(outcome)).not.toContain("domainEvents");
  });

  it("executes ListInstanceContacts through the Contact repository", async () => {
    const contact = createContact({
      id: createContactId("contact:instance"),
      instanceId: createInstanceId("inst:one"),
      jid: createJid("12025550124@s.whatsapp.net"),
      displayName: createContactDisplayName("Instance Contact"),
    });
    const otherContact = createContact({
      id: createContactId("contact:other"),
      instanceId: createInstanceId("inst:other"),
      jid: createJid("12025550125@s.whatsapp.net"),
    });
    const dispatcher = createApplicationDispatcher({
      repositories: {
        instanceRepository: new FakeInstanceRepository(),
        contactRepository: new FakeContactRepository([contact, otherContact]),
      },
      clock: fixedClock,
    });

    const outcome = await dispatcher.executeQuery(
      createApplicationQueryEnvelope({
        name: "ListInstanceContacts",
        queryRef: "qry-list-instance-contacts",
        requestContext,
        actorRef: "api_key:test",
        targetRef: "inst:one",
        requestedConsistency: "eventual_projection",
      }),
    );

    expect(outcome).toEqual({
      kind: "query_outcome",
      queryRef: "qry-list-instance-contacts",
      outcome: "result",
      consistency: "eventual_projection",
      freshness: {
        stale: false,
        refreshedAtEpochMilliseconds: 1_782_864_000_000,
      },
      resultRef: "contacts:inst:one:list:1",
      items: [
        {
          id: "contact:instance",
          instanceId: "inst:one",
          status: "discovered",
          displayName: "Instance Contact",
        },
      ],
    });
    expect(JSON.stringify(outcome)).not.toContain("@s.whatsapp.net");
    expect(JSON.stringify(outcome)).not.toContain("12025550124");
    expect(JSON.stringify(outcome)).not.toContain("12025550125");
  });

  it("executes GetContactStatus through the Contact repository without leaking JIDs or phone numbers", async () => {
    const contact = createContact({
      id: createContactId("contact:detail"),
      instanceId: createInstanceId("inst:detail"),
      jid: createJid("12025550126@s.whatsapp.net"),
      displayName: createContactDisplayName("Detail Contact"),
      phoneNumber: createPhoneNumber("+12025550126"),
    });
    const dispatcher = createApplicationDispatcher({
      repositories: {
        instanceRepository: new FakeInstanceRepository(),
        contactRepository: new FakeContactRepository([contact]),
      },
      clock: fixedClock,
    });

    const outcome = await dispatcher.executeQuery(
      createApplicationQueryEnvelope({
        name: "GetContactStatus",
        queryRef: "qry-get-contact-status",
        requestContext,
        actorRef: "api_key:test",
        targetRef: "contact:detail",
        requestedConsistency: "strong_owner",
      }),
    );

    expect(outcome).toEqual({
      kind: "query_outcome",
      queryRef: "qry-get-contact-status",
      outcome: "result",
      consistency: "strong_owner",
      freshness: {
        stale: false,
        refreshedAtEpochMilliseconds: 1_782_864_000_000,
      },
      resultRef: "contact:contact:detail:discovered",
      resource: {
        id: "contact:detail",
        instanceId: "inst:detail",
        status: "discovered",
        displayName: "Detail Contact",
      },
    });
    expect(JSON.stringify(outcome)).not.toContain("@s.whatsapp.net");
    expect(JSON.stringify(outcome)).not.toContain("12025550126");
    expect(JSON.stringify(outcome)).not.toContain("phoneNumber");
    expect(JSON.stringify(outcome)).not.toContain("jid");
  });

  it("executes ListInstanceGroups through the Group repository without leaking group JIDs", async () => {
    const group = createGroup({
      id: createGroupId("group:one"),
      instanceId: createInstanceId("inst:one"),
      jid: createJid("12345@g.us"),
      metadata: {
        subject: "Demo Group",
        description: "A group for demos",
      },
      members: [
        createGroupMember({
          jid: createJid("12025550123@s.whatsapp.net"),
          role: "admin",
        }),
        createGroupMember({
          jid: createJid("12025550124@s.whatsapp.net"),
          role: "member",
        }),
      ],
    });
    const otherGroup = createGroup({
      id: createGroupId("group:other"),
      instanceId: createInstanceId("inst:other"),
      jid: createJid("67890@g.us"),
      metadata: {
        subject: "Other Group",
      },
    });
    const dispatcher = createApplicationDispatcher({
      repositories: {
        instanceRepository: new FakeInstanceRepository(),
        groupRepository: new FakeGroupRepository([group, otherGroup]),
      },
      clock: fixedClock,
    });

    const outcome = await dispatcher.executeQuery(
      createApplicationQueryEnvelope({
        name: "ListInstanceGroups",
        queryRef: "qry-list-instance-groups",
        requestContext,
        actorRef: "api_key:test",
        targetRef: "inst:one",
        requestedConsistency: "eventual_projection",
      }),
    );

    expect(outcome).toEqual({
      kind: "query_outcome",
      queryRef: "qry-list-instance-groups",
      outcome: "result",
      consistency: "eventual_projection",
      freshness: {
        stale: false,
        refreshedAtEpochMilliseconds: 1_782_864_000_000,
      },
      resultRef: "groups:inst:one:list:1",
      items: [
        {
          id: "group:one",
          instanceId: "inst:one",
          status: "discovered",
          subject: "Demo Group",
          description: "A group for demos",
          memberCount: 2,
          adminCount: 1,
          muted: false,
          archived: false,
          pinned: false,
        },
      ],
    });
    expect(JSON.stringify(outcome)).not.toContain("@g.us");
    expect(JSON.stringify(outcome)).not.toContain("@s.whatsapp.net");
    expect(JSON.stringify(outcome)).not.toContain("12025550123");
    expect(JSON.stringify(outcome)).not.toContain("domainEvents");
  });

  it("executes GetGroupStatus through the Group repository without exposing invite links or actions", async () => {
    const group = {
      ...createGroup({
        id: createGroupId("group:detail"),
        instanceId: createInstanceId("inst:detail"),
        jid: createJid("98765@g.us"),
        metadata: {
          subject: "Detail Group",
          description: "Visible description",
        },
        members: [
          createGroupMember({
            jid: createJid("12025550125@s.whatsapp.net"),
            role: "owner",
          }),
        ],
      }),
      inviteLink: {
        id: "invite:secret",
        urlRef: "https://chat.whatsapp.com/secret",
        active: true,
      },
    } as Group;
    const dispatcher = createApplicationDispatcher({
      repositories: {
        instanceRepository: new FakeInstanceRepository(),
        groupRepository: new FakeGroupRepository([group]),
      },
      clock: fixedClock,
    });

    const outcome = await dispatcher.executeQuery(
      createApplicationQueryEnvelope({
        name: "GetGroupStatus",
        queryRef: "qry-get-group-status",
        requestContext,
        actorRef: "api_key:test",
        targetRef: "group:detail",
        requestedConsistency: "strong_owner",
      }),
    );

    expect(outcome).toEqual({
      kind: "query_outcome",
      queryRef: "qry-get-group-status",
      outcome: "result",
      consistency: "strong_owner",
      freshness: {
        stale: false,
        refreshedAtEpochMilliseconds: 1_782_864_000_000,
      },
      resultRef: "group:group:detail:discovered",
      resource: {
        id: "group:detail",
        instanceId: "inst:detail",
        status: "discovered",
        subject: "Detail Group",
        description: "Visible description",
        memberCount: 1,
        adminCount: 1,
        muted: false,
        archived: false,
        pinned: false,
      },
    });
    expect(JSON.stringify(outcome)).not.toContain("@g.us");
    expect(JSON.stringify(outcome)).not.toContain("chat.whatsapp.com");
    expect(JSON.stringify(outcome)).not.toContain("inviteLink");
    expect(JSON.stringify(outcome)).not.toContain("actions");
    expect(JSON.stringify(outcome)).not.toContain("domainEvents");
  });

  it("executes ListGroupMembers through the Group repository with safe member refs", async () => {
    const group = createGroup({
      id: createGroupId("group:members"),
      instanceId: createInstanceId("inst:members"),
      jid: createJid("22222@g.us"),
      metadata: {
        subject: "Members Group",
      },
      members: [
        createGroupMember({
          jid: createJid("12025550126@s.whatsapp.net"),
          role: "admin",
          joinedAtEpochMilliseconds: 1_782_864_000_000,
        }),
        createGroupMember({
          jid: createJid("12025550127@s.whatsapp.net"),
          role: "member",
        }),
      ],
    });
    const dispatcher = createApplicationDispatcher({
      repositories: {
        instanceRepository: new FakeInstanceRepository(),
        groupRepository: new FakeGroupRepository([group]),
      },
      clock: fixedClock,
    });

    const outcome = await dispatcher.executeQuery(
      createApplicationQueryEnvelope({
        name: "ListGroupMembers",
        queryRef: "qry-list-group-members",
        requestContext,
        actorRef: "api_key:test",
        targetRef: "group:members",
        requestedConsistency: "eventual_projection",
      }),
    );

    expect(outcome).toEqual({
      kind: "query_outcome",
      queryRef: "qry-list-group-members",
      outcome: "result",
      consistency: "eventual_projection",
      freshness: {
        stale: false,
        refreshedAtEpochMilliseconds: 1_782_864_000_000,
      },
      resultRef: "group-members:group:members:list:2",
      items: [
        {
          id: "group:members:member:1",
          groupId: "group:members",
          memberRef: "group:members:member:1",
          role: "admin",
          status: "active",
          joinedAt: "2026-07-01T00:00:00.000Z",
        },
        {
          id: "group:members:member:2",
          groupId: "group:members",
          memberRef: "group:members:member:2",
          role: "member",
          status: "active",
        },
      ],
    });
    expect(JSON.stringify(outcome)).not.toContain("@g.us");
    expect(JSON.stringify(outcome)).not.toContain("@s.whatsapp.net");
    expect(JSON.stringify(outcome)).not.toContain("12025550126");
    expect(JSON.stringify(outcome)).not.toContain("jid");
  });

  it("executes ListEvents through the EventLog replay port", async () => {
    const dispatcher = createApplicationDispatcher({
      repositories: { instanceRepository: new FakeInstanceRepository() },
      clock: fixedClock,
      eventLog: new FakeEventLogReplayPort([
        platformEvent({
          id: "event_demo",
          type: "message.sent.v1",
          source: "domain:Message",
          resourceRef: "msg_demo",
          correlationId: "corr_demo",
          timestamp: "2026-07-01T00:00:00.000Z",
          payload: {
            raw: "hidden",
          },
        }),
      ]),
    });

    const outcome = await dispatcher.executeQuery(
      createApplicationQueryEnvelope({
        name: "ListEvents",
        queryRef: "qry-list-events",
        requestContext,
        actorRef: "api_key:test",
        requestedConsistency: "retention_bound",
      }),
    );

    expect(outcome).toEqual({
      kind: "query_outcome",
      queryRef: "qry-list-events",
      outcome: "result",
      consistency: "retention_bound",
      freshness: {
        stale: false,
        refreshedAtEpochMilliseconds: 1_782_864_000_000,
      },
      resultRef: "events:list:1",
      items: [
        {
          id: "event_demo",
          type: "message.sent.v1",
          source: "domain:Message",
          resourceRef: "msg_demo",
          correlationId: "corr_demo",
          timestamp: "2026-07-01T00:00:00.000Z",
        },
      ],
    });
    expect(JSON.stringify(outcome)).not.toContain("payload");
    expect(JSON.stringify(outcome)).not.toContain("hidden");
  });

  it("executes ListWorkerJobs through the WorkerJob repository", async () => {
    const workerJob = queueWorkerJob(
      createJobId("job:one"),
      "operations",
      "outbound_message",
      retryPolicy,
      {
        jobKind: "outbound_message",
        instanceId: "inst:one",
        messageId: "msg:one",
        outboundIntentRef: "intent:secret-ref",
      },
    );
    const dispatcher = createApplicationDispatcher({
      repositories: {
        instanceRepository: new FakeInstanceRepository(),
        workerJobRepository: new FakeWorkerJobRepository([workerJob]),
      },
      clock: fixedClock,
    });

    const outcome = await dispatcher.executeQuery(
      createApplicationQueryEnvelope({
        name: "ListWorkerJobs",
        queryRef: "qry-list-worker-jobs",
        requestContext,
        actorRef: "api_key:test",
        requestedConsistency: "eventual_projection",
      }),
    );

    expect(outcome).toEqual({
      kind: "query_outcome",
      queryRef: "qry-list-worker-jobs",
      outcome: "result",
      consistency: "eventual_projection",
      freshness: {
        stale: false,
        refreshedAtEpochMilliseconds: 1_782_864_000_000,
      },
      resultRef: "jobs:list:1",
      items: [
        {
          id: "job:one",
          status: "queued",
          workType: "outbound_message",
          ownerContext: "operations",
          resourceRef: "msg:one",
        },
      ],
    });
    expect(JSON.stringify(outcome)).not.toContain("outboundIntentRef");
    expect(JSON.stringify(outcome)).not.toContain("secret-ref");
    expect(JSON.stringify(outcome)).not.toContain("domainEvents");
  });

  it("executes GetWorkerJobStatus through the WorkerJob repository", async () => {
    const workerJob = queueWorkerJob(
      createJobId("job:detail"),
      "operations",
      "outbound_message",
      retryPolicy,
      {
        jobKind: "outbound_message",
        instanceId: "inst:detail",
      },
    );
    const dispatcher = createApplicationDispatcher({
      repositories: {
        instanceRepository: new FakeInstanceRepository(),
        workerJobRepository: new FakeWorkerJobRepository([workerJob]),
      },
      clock: fixedClock,
    });

    const outcome = await dispatcher.executeQuery(
      createApplicationQueryEnvelope({
        name: "GetWorkerJobStatus",
        queryRef: "qry-get-worker-job",
        requestContext,
        actorRef: "api_key:test",
        targetRef: "job:detail",
        requestedConsistency: "strong_owner",
      }),
    );

    expect(outcome).toEqual({
      kind: "query_outcome",
      queryRef: "qry-get-worker-job",
      outcome: "result",
      consistency: "strong_owner",
      freshness: {
        stale: false,
        refreshedAtEpochMilliseconds: 1_782_864_000_000,
      },
      resultRef: "job:job:detail:queued",
      resource: {
        id: "job:detail",
        status: "queued",
        workType: "outbound_message",
        ownerContext: "operations",
        resourceRef: "inst:detail",
      },
    });
    expect(JSON.stringify(outcome)).not.toContain("domainEvents");
  });

  it("executes GetQueueMetricsSnapshot through the WorkerJob repository", async () => {
    const queuedJob = queueWorkerJob(
      createJobId("job:queue-summary"),
      "operations",
      "outbound_message",
      retryPolicy,
      {
        jobKind: "outbound_message",
        instanceId: "inst:queue-summary",
        messageId: "msg:queue-summary",
        outboundIntentRef: "intent:secret-ref",
      },
    );
    const dispatcher = createApplicationDispatcher({
      repositories: {
        instanceRepository: new FakeInstanceRepository(),
        workerJobRepository: new FakeWorkerJobRepository([queuedJob]),
      },
      clock: fixedClock,
    });

    const outcome = await dispatcher.executeQuery(
      createApplicationQueryEnvelope({
        name: "GetQueueMetricsSnapshot",
        queryRef: "qry-get-queue",
        requestContext,
        actorRef: "api_key:test",
        requestedConsistency: "eventual_projection",
      }),
    );

    expect(outcome).toEqual({
      kind: "query_outcome",
      queryRef: "qry-get-queue",
      outcome: "result",
      consistency: "eventual_projection",
      freshness: {
        stale: false,
        refreshedAtEpochMilliseconds: 1_782_864_000_000,
      },
      resultRef: "queue:active:1",
      resource: {
        id: "queue",
        status: "active",
        totalJobCount: 1,
        queuedJobCount: 1,
        reservedJobCount: 0,
        runningJobCount: 0,
        retryingJobCount: 0,
        completedJobCount: 0,
        deadJobCount: 0,
        activeJobCount: 1,
      },
    });
    expect(JSON.stringify(outcome)).not.toContain("outboundIntentRef");
    expect(JSON.stringify(outcome)).not.toContain("secret-ref");
    expect(JSON.stringify(outcome)).not.toContain("safeMetadata");
    expect(JSON.stringify(outcome)).not.toContain("domainEvents");
  });

  it("executes ListWebhookSubscriptions through the Webhook repository", async () => {
    const webhook = createWebhookSubscription(
      createWebhookId("webhook:one"),
      createWebhookUrl("https://webhook.example.test/one"),
    );
    const dispatcher = createApplicationDispatcher({
      repositories: {
        instanceRepository: new FakeInstanceRepository(),
        webhookSubscriptionRepository: new FakeWebhookSubscriptionRepository([webhook]),
      },
      clock: fixedClock,
    });

    const outcome = await dispatcher.executeQuery(
      createApplicationQueryEnvelope({
        name: "ListWebhookSubscriptions",
        queryRef: "qry-list-webhooks",
        requestContext,
        actorRef: "api_key:test",
        requestedConsistency: "eventual_projection",
      }),
    );

    expect(outcome).toEqual({
      kind: "query_outcome",
      queryRef: "qry-list-webhooks",
      outcome: "result",
      consistency: "eventual_projection",
      freshness: {
        stale: false,
        refreshedAtEpochMilliseconds: 1_782_864_000_000,
      },
      resultRef: "webhooks:list:1",
      items: [
        {
          id: "webhook:one",
          status: "proposed",
        },
      ],
    });
    expect(JSON.stringify(outcome)).not.toContain("targetUrl");
    expect(JSON.stringify(outcome)).not.toContain("webhook.example.test");
    expect(JSON.stringify(outcome)).not.toContain("domainEvents");
  });

  it("executes GetWebhookStatus through the Webhook repository", async () => {
    const webhook = createWebhookSubscription(
      createWebhookId("webhook:detail"),
      createWebhookUrl("https://webhook.example.test/detail"),
    );
    const dispatcher = createApplicationDispatcher({
      repositories: {
        instanceRepository: new FakeInstanceRepository(),
        webhookSubscriptionRepository: new FakeWebhookSubscriptionRepository([webhook]),
      },
      clock: fixedClock,
    });

    const outcome = await dispatcher.executeQuery(
      createApplicationQueryEnvelope({
        name: "GetWebhookStatus",
        queryRef: "qry-get-webhook",
        requestContext,
        actorRef: "api_key:test",
        targetRef: "webhook:detail",
        requestedConsistency: "strong_owner",
      }),
    );

    expect(outcome).toEqual({
      kind: "query_outcome",
      queryRef: "qry-get-webhook",
      outcome: "result",
      consistency: "strong_owner",
      freshness: {
        stale: false,
        refreshedAtEpochMilliseconds: 1_782_864_000_000,
      },
      resultRef: "webhook:webhook:detail:proposed",
      resource: {
        id: "webhook:detail",
        status: "proposed",
      },
    });
    expect(JSON.stringify(outcome)).not.toContain("targetUrl");
    expect(JSON.stringify(outcome)).not.toContain("webhook.example.test");
    expect(JSON.stringify(outcome)).not.toContain("domainEvents");
  });

  it("executes ListWebhookDeliveries through the Webhook delivery repository", async () => {
    const delivery = scheduleWebhookDelivery(
      createWebhookDeliveryId("webhook-delivery:one"),
      createWebhookId("webhook:one"),
      "message.accepted.v1",
      retryPolicy,
    );
    const dispatcher = createApplicationDispatcher({
      repositories: {
        instanceRepository: new FakeInstanceRepository(),
        webhookDeliveryRepository: new FakeWebhookDeliveryRepository([delivery]),
      },
      clock: fixedClock,
    });

    const outcome = await dispatcher.executeQuery(
      createApplicationQueryEnvelope({
        name: "ListWebhookDeliveries",
        queryRef: "qry-list-webhook-deliveries",
        requestContext,
        actorRef: "api_key:test",
        requestedConsistency: "retention_bound",
      }),
    );

    expect(outcome).toEqual({
      kind: "query_outcome",
      queryRef: "qry-list-webhook-deliveries",
      outcome: "result",
      consistency: "retention_bound",
      freshness: {
        stale: false,
        refreshedAtEpochMilliseconds: 1_782_864_000_000,
      },
      resultRef: "webhook-deliveries:list:1",
      items: [
        {
          id: "webhook-delivery:one",
          webhookId: "webhook:one",
          status: "pending",
          eventType: "message.accepted.v1",
        },
      ],
    });
    expect(JSON.stringify(outcome)).not.toContain("domainEvents");
    expect(JSON.stringify(outcome)).not.toContain("retryPolicy");
  });

  it("exposes safe webhook delivery remediation codes for dead-letter operator views", async () => {
    const delivery = deadLetterWebhookDelivery(
      startWebhookDelivery(
        scheduleWebhookDelivery(
          createWebhookDeliveryId("webhook-delivery:dead-letter"),
          createWebhookId("webhook:dead-letter"),
          "message.failed.v1",
          retryPolicy,
        ),
        createAttemptNumber(3, retryPolicy),
      ),
      createDeadLetterReason({
        code: "receiver_terminal_failure",
        category: "webhook",
      }),
    );
    const dispatcher = createApplicationDispatcher({
      repositories: {
        instanceRepository: new FakeInstanceRepository(),
        webhookDeliveryRepository: new FakeWebhookDeliveryRepository([delivery]),
      },
      clock: fixedClock,
    });

    const outcome = await dispatcher.executeQuery(
      createApplicationQueryEnvelope({
        name: "ListWebhookDeliveries",
        queryRef: "qry-list-webhook-deliveries-dead-letter",
        requestContext,
        actorRef: "api_key:test",
        requestedConsistency: "retention_bound",
      }),
    );

    expect(outcome).toMatchObject({
      outcome: "result",
      items: [
        {
          id: "webhook-delivery:dead-letter",
          webhookId: "webhook:dead-letter",
          status: "dead_letter",
          eventType: "message.failed.v1",
          attemptCount: 3,
          failureCategory: "webhook",
          reasonCode: "receiver_terminal_failure",
        },
      ],
    });
    expect(JSON.stringify(outcome)).not.toContain("domainEvents");
    expect(JSON.stringify(outcome)).not.toContain("retryPolicy");
  });

  it("executes GetWebhookDeliveryHistory through the Webhook delivery repository", async () => {
    const delivery = scheduleWebhookDelivery(
      createWebhookDeliveryId("webhook-delivery:detail"),
      createWebhookId("webhook:detail"),
      "message.delivered.v1",
      retryPolicy,
    );
    const dispatcher = createApplicationDispatcher({
      repositories: {
        instanceRepository: new FakeInstanceRepository(),
        webhookDeliveryRepository: new FakeWebhookDeliveryRepository([delivery]),
      },
      clock: fixedClock,
    });

    const outcome = await dispatcher.executeQuery(
      createApplicationQueryEnvelope({
        name: "GetWebhookDeliveryHistory",
        queryRef: "qry-get-webhook-delivery",
        requestContext,
        actorRef: "api_key:test",
        targetRef: "webhook-delivery:detail",
        requestedConsistency: "retention_bound",
      }),
    );

    expect(outcome).toEqual({
      kind: "query_outcome",
      queryRef: "qry-get-webhook-delivery",
      outcome: "result",
      consistency: "retention_bound",
      freshness: {
        stale: false,
        refreshedAtEpochMilliseconds: 1_782_864_000_000,
      },
      resultRef: "webhook-delivery:webhook-delivery:detail:pending",
      resource: {
        id: "webhook-delivery:detail",
        webhookId: "webhook:detail",
        status: "pending",
        eventType: "message.delivered.v1",
      },
    });
    expect(JSON.stringify(outcome)).not.toContain("domainEvents");
    expect(JSON.stringify(outcome)).not.toContain("retryPolicy");
  });

  it("executes RetryWebhookDelivery through the queue boundary", async () => {
    const delivery = scheduleWebhookDelivery(
      createWebhookDeliveryId("webhook-delivery:retry"),
      createWebhookId("webhook:retry"),
      "message.delivered.v1",
      retryPolicy,
    );
    const queueProvider = new FakeQueueProvider();
    const dispatcher = createApplicationDispatcher({
      repositories: {
        instanceRepository: new FakeInstanceRepository(),
        webhookDeliveryRepository: new FakeWebhookDeliveryRepository([delivery]),
      },
      queueProvider,
      clock: fixedClock,
    });

    const outcome = await dispatcher.executeCommand(
      createApplicationCommandEnvelope({
        name: "RetryWebhookDelivery",
        commandRef: "cmd-retry-webhook-delivery",
        requestContext,
        actorRef: "api_key:test",
        targetRef: "webhook-delivery:retry",
        idempotencyKey: "idem-retry-webhook-delivery",
      }),
    );

    expect(outcome).toEqual({
      kind: "command_outcome",
      commandRef: "cmd-retry-webhook-delivery",
      outcome: "queued",
      accepted: true,
      retryable: false,
      resultRef: "webhook-delivery:retry",
    });
    expect(queueProvider.enqueued).toHaveLength(1);
    expect(queueProvider.enqueued[0]).toMatchObject({
      jobId: "webhook-delivery:retry",
      ownerContext: "webhook_delivery",
      ownerRef: "webhook-delivery:retry",
      workType: "webhook_delivery",
      idempotencyKey: "retry_webhook_delivery:idem-retry-webhook-delivery",
    });
    expect(JSON.stringify(outcome)).not.toContain("targetUrl");
    expect(JSON.stringify(outcome)).not.toContain("retryPolicy");
  });

  it("keeps RetryWebhookDelivery idempotent through the queue boundary", async () => {
    const delivery = scheduleWebhookDelivery(
      createWebhookDeliveryId("webhook-delivery:retry-idem"),
      createWebhookId("webhook:retry-idem"),
      "message.failed.v1",
      retryPolicy,
    );
    const queueProvider = new FakeQueueProvider();
    const dispatcher = createApplicationDispatcher({
      repositories: {
        instanceRepository: new FakeInstanceRepository(),
        webhookDeliveryRepository: new FakeWebhookDeliveryRepository([delivery]),
      },
      queueProvider,
      clock: fixedClock,
    });
    const envelope = createApplicationCommandEnvelope({
      name: "RetryWebhookDelivery",
      commandRef: "cmd-retry-webhook-idem",
      requestContext,
      actorRef: "api_key:test",
      targetRef: "webhook-delivery:retry-idem",
      idempotencyKey: "idem-retry-webhook-idem",
    });

    const first = await dispatcher.executeCommand(envelope);
    const second = await dispatcher.executeCommand(envelope);

    expect(first.outcome).toBe("queued");
    expect(second.outcome).toBe("queued");
    expect(queueProvider.enqueued).toHaveLength(1);
  });

  it("rejects RetryWebhookDelivery for terminal deliveries", async () => {
    const delivering = startWebhookDelivery(
      scheduleWebhookDelivery(
        createWebhookDeliveryId("webhook-delivery:terminal"),
        createWebhookId("webhook:terminal"),
        "message.read.v1",
        retryPolicy,
      ),
      createAttemptNumber(1, retryPolicy),
    );
    const delivered = succeedWebhookDelivery(delivering);
    const queueProvider = new FakeQueueProvider();
    const dispatcher = createApplicationDispatcher({
      repositories: {
        instanceRepository: new FakeInstanceRepository(),
        webhookDeliveryRepository: new FakeWebhookDeliveryRepository([delivered]),
      },
      queueProvider,
      clock: fixedClock,
    });

    const outcome = await dispatcher.executeCommand(
      createApplicationCommandEnvelope({
        name: "RetryWebhookDelivery",
        commandRef: "cmd-retry-webhook-terminal",
        requestContext,
        actorRef: "api_key:test",
        targetRef: "webhook-delivery:terminal",
        idempotencyKey: "idem-retry-webhook-terminal",
      }),
    );

    expect(outcome).toEqual({
      kind: "command_outcome",
      commandRef: "cmd-retry-webhook-terminal",
      outcome: "rejected",
      accepted: false,
      retryable: false,
      resultRef: "webhook-delivery:terminal",
      reasonCode: "webhook_delivery_retry_not_allowed",
    });
    expect(queueProvider.enqueued).toHaveLength(0);
  });

  it("executes RedriveWebhookDelivery by creating a new delivery from a dead letter", async () => {
    const original = deadLetterWebhookDelivery(
      startWebhookDelivery(
        scheduleWebhookDelivery(
          createWebhookDeliveryId("webhook-delivery:redrive-source"),
          createWebhookId("webhook:redrive-source"),
          "message.failed.v1",
          retryPolicy,
        ),
        createAttemptNumber(1, retryPolicy),
      ),
      createDeadLetterReason({
        code: "receiver_terminal_failure",
        category: "webhook",
      }),
    );
    const repository = new FakeWebhookDeliveryRepository([original]);
    const queueProvider = new FakeQueueProvider();
    const dispatcher = createApplicationDispatcher({
      repositories: {
        instanceRepository: new FakeInstanceRepository(),
        webhookDeliveryRepository: repository,
      },
      queueProvider,
      clock: fixedClock,
    });

    const outcome = await dispatcher.executeCommand(
      createApplicationCommandEnvelope({
        name: "RedriveWebhookDelivery",
        commandRef: "cmd-redrive-webhook-delivery",
        requestContext,
        actorRef: "api_key:test",
        targetRef: "webhook-delivery:redrive-source",
        idempotencyKey: "idem-redrive-webhook-delivery",
      }),
    );

    expect(outcome).toMatchObject({
      kind: "command_outcome",
      commandRef: "cmd-redrive-webhook-delivery",
      outcome: "queued",
      accepted: true,
      retryable: false,
    });
    expect(outcome.resultRef).not.toBe(original.id);
    expect(await repository.load(original.id)).toMatchObject({ status: "dead_letter" });
    expect(await repository.load(createWebhookDeliveryId(String(outcome.resultRef)))).toMatchObject(
      {
        webhookId: original.webhookId,
        sourceSignalRef: original.sourceSignalRef,
        status: "pending",
      },
    );
    expect(queueProvider.enqueued).toHaveLength(1);
    expect(queueProvider.enqueued[0]).toMatchObject({
      jobId: outcome.resultRef,
      ownerContext: "webhook_delivery",
      ownerRef: outcome.resultRef,
      workType: "webhook_delivery",
      idempotencyKey: "redrive_webhook_delivery:idem-redrive-webhook-delivery",
    });
    expect(JSON.stringify(outcome)).not.toContain("targetUrl");
    expect(JSON.stringify(outcome)).not.toContain("retryPolicy");
  });

  it("keeps RedriveWebhookDelivery idempotent through the delivery and queue boundaries", async () => {
    const original = deadLetterWebhookDelivery(
      startWebhookDelivery(
        scheduleWebhookDelivery(
          createWebhookDeliveryId("webhook-delivery:redrive-idem"),
          createWebhookId("webhook:redrive-idem"),
          "message.failed.v1",
          retryPolicy,
        ),
        createAttemptNumber(1, retryPolicy),
      ),
      createDeadLetterReason({
        code: "receiver_terminal_failure",
        category: "webhook",
      }),
    );
    const repository = new FakeWebhookDeliveryRepository([original]);
    const queueProvider = new FakeQueueProvider();
    const dispatcher = createApplicationDispatcher({
      repositories: {
        instanceRepository: new FakeInstanceRepository(),
        webhookDeliveryRepository: repository,
      },
      queueProvider,
      clock: fixedClock,
    });
    const envelope = createApplicationCommandEnvelope({
      name: "RedriveWebhookDelivery",
      commandRef: "cmd-redrive-webhook-idem",
      requestContext,
      actorRef: "api_key:test",
      targetRef: "webhook-delivery:redrive-idem",
      idempotencyKey: "idem-redrive-webhook-idem",
    });

    const first = await dispatcher.executeCommand(envelope);
    const second = await dispatcher.executeCommand(envelope);

    expect(first.outcome).toBe("queued");
    expect(second.outcome).toBe("queued");
    expect(second.resultRef).toBe(first.resultRef);
    expect(queueProvider.enqueued).toHaveLength(1);
  });

  it("executes BulkRedriveWebhookDeliveries for eligible dead-letter deliveries", async () => {
    const firstOriginal = deadLetterWebhookDelivery(
      startWebhookDelivery(
        scheduleWebhookDelivery(
          createWebhookDeliveryId("webhook-delivery:bulk-redrive-one"),
          createWebhookId("webhook:bulk-redrive"),
          "message.failed.v1",
          retryPolicy,
        ),
        createAttemptNumber(1, retryPolicy),
      ),
      createDeadLetterReason({
        code: "receiver_terminal_failure",
        category: "webhook",
      }),
    );
    const secondOriginal = deadLetterWebhookDelivery(
      startWebhookDelivery(
        scheduleWebhookDelivery(
          createWebhookDeliveryId("webhook-delivery:bulk-redrive-two"),
          createWebhookId("webhook:bulk-redrive"),
          "message.failed.v1",
          retryPolicy,
        ),
        createAttemptNumber(1, retryPolicy),
      ),
      createDeadLetterReason({
        code: "receiver_terminal_failure",
        category: "webhook",
      }),
    );
    const ineligible = scheduleWebhookDelivery(
      createWebhookDeliveryId("webhook-delivery:bulk-redrive-pending"),
      createWebhookId("webhook:bulk-redrive"),
      "message.pending.v1",
      retryPolicy,
    );
    const repository = new FakeWebhookDeliveryRepository([
      firstOriginal,
      secondOriginal,
      ineligible,
    ]);
    const queueProvider = new FakeQueueProvider();
    const operationIntentStore = new FakeWebhookDeliveryOperationIntentStore([
      "webhook-delivery:bulk-redrive-one",
      "webhook-delivery:bulk-redrive-two",
      "webhook-delivery:bulk-redrive-pending",
    ]);
    const dispatcher = createApplicationDispatcher({
      repositories: {
        instanceRepository: new FakeInstanceRepository(),
        webhookDeliveryRepository: repository,
      },
      queueProvider,
      webhookDeliveryOperationIntentStore: operationIntentStore,
      clock: fixedClock,
    });
    const envelope = createApplicationCommandEnvelope({
      name: "BulkRedriveWebhookDeliveries",
      commandRef: "cmd-bulk-redrive-webhook-deliveries",
      requestContext,
      actorRef: "api_key:test",
      safeInputRef: "webhook_bulk_redrive_intent_1",
      idempotencyKey: "idem-bulk-redrive-webhooks",
    });

    const first = await dispatcher.executeCommand(envelope);
    const second = await dispatcher.executeCommand(envelope);

    expect(first).toMatchObject({
      kind: "command_outcome",
      commandRef: "cmd-bulk-redrive-webhook-deliveries",
      outcome: "queued",
      accepted: true,
      retryable: false,
      resultRef: "webhook_delivery_bulk_redrive:webhook_bulk_redrive_intent_1",
    });
    expect(second.outcome).toBe("queued");
    expect(second.resultRef).toBe(first.resultRef);
    expect(queueProvider.enqueued).toHaveLength(2);
    expect(queueProvider.enqueued.map((work) => work.ownerRef).sort()).toEqual([
      "webhook-delivery:bulk-redrive-one:redrive:bulk_redrive_webhook_delivery:bulk_redrive_webhook_deliveries:idem-bulk-redrive-webhooks:webhook-delivery:bulk-redrive-one",
      "webhook-delivery:bulk-redrive-two:redrive:bulk_redrive_webhook_delivery:bulk_redrive_webhook_deliveries:idem-bulk-redrive-webhooks:webhook-delivery:bulk-redrive-two",
    ]);
    expect(JSON.stringify(first)).not.toContain("targetUrl");
    expect(JSON.stringify(first)).not.toContain("retryPolicy");
  });

  it("rejects RedriveWebhookDelivery unless the delivery is dead-lettered", async () => {
    const delivery = scheduleWebhookDelivery(
      createWebhookDeliveryId("webhook-delivery:redrive-not-allowed"),
      createWebhookId("webhook:redrive-not-allowed"),
      "message.failed.v1",
      retryPolicy,
    );
    const queueProvider = new FakeQueueProvider();
    const dispatcher = createApplicationDispatcher({
      repositories: {
        instanceRepository: new FakeInstanceRepository(),
        webhookDeliveryRepository: new FakeWebhookDeliveryRepository([delivery]),
      },
      queueProvider,
      clock: fixedClock,
    });

    const outcome = await dispatcher.executeCommand(
      createApplicationCommandEnvelope({
        name: "RedriveWebhookDelivery",
        commandRef: "cmd-redrive-webhook-not-allowed",
        requestContext,
        actorRef: "api_key:test",
        targetRef: "webhook-delivery:redrive-not-allowed",
        idempotencyKey: "idem-redrive-webhook-not-allowed",
      }),
    );

    expect(outcome).toEqual({
      kind: "command_outcome",
      commandRef: "cmd-redrive-webhook-not-allowed",
      outcome: "rejected",
      accepted: false,
      retryable: false,
      resultRef: "webhook-delivery:redrive-not-allowed",
      reasonCode: "webhook_delivery_redrive_not_allowed",
    });
    expect(queueProvider.enqueued).toHaveLength(0);
  });

  it("executes GetHealthStatus through the Health repository", async () => {
    const healthStatus = classifyHealthy(
      createHealthStatus(createHealthStatusId("health-platform"), "platform"),
    );
    const dispatcher = createApplicationDispatcher({
      repositories: {
        instanceRepository: new FakeInstanceRepository(),
        healthStatusRepository: new FakeHealthStatusRepository([healthStatus]),
      },
      clock: fixedClock,
    });

    const outcome = await dispatcher.executeQuery(
      createApplicationQueryEnvelope({
        name: "GetHealthStatus",
        queryRef: "qry-health",
        requestContext,
        actorRef: "api_key:test",
        requestedConsistency: "eventual_projection",
      }),
    );

    expect(outcome).toEqual({
      kind: "query_outcome",
      queryRef: "qry-health",
      outcome: "result",
      consistency: "eventual_projection",
      freshness: {
        stale: false,
        refreshedAtEpochMilliseconds: 1_782_864_000_000,
      },
      resultRef: "health:health-platform:healthy",
    });
  });

  it("returns safe unavailable outcomes for handlers not implemented in this slice", async () => {
    const dispatcher = createApplicationDispatcher({
      repositories: { instanceRepository: new FakeInstanceRepository() },
      clock: fixedClock,
    });

    const outcome = await dispatcher.executeQuery(
      createApplicationQueryEnvelope({
        name: "GetMessageDeliveryHistory",
        queryRef: "qry-message-delivery-history",
        requestContext,
        actorRef: "api_key:test",
        targetRef: "msg_1",
      }),
    );

    expect(outcome).toEqual({
      kind: "query_outcome",
      queryRef: "qry-message-delivery-history",
      outcome: "unavailable",
      consistency: "retention_bound",
      freshness: {
        stale: false,
        refreshedAtEpochMilliseconds: 1_782_864_000_000,
      },
      reasonCode: "application_handler_not_implemented",
    });
  });

  it("returns safe failed outcomes for commands not implemented in this slice", async () => {
    const dispatcher = createApplicationDispatcher({
      repositories: { instanceRepository: new FakeInstanceRepository() },
      clock: fixedClock,
    });

    const outcome = await dispatcher.executeCommand(
      createApplicationCommandEnvelope({
        name: "SendTextMessage",
        commandRef: "cmd-send-text",
        requestContext,
        actorRef: "api_key:test",
        targetRef: "inst_1",
        idempotencyKey: "idem-send-text",
      }),
    );

    expect(outcome).toEqual({
      kind: "command_outcome",
      commandRef: "cmd-send-text",
      outcome: "failed",
      accepted: false,
      retryable: false,
      reasonCode: "application_handler_not_implemented",
    });
  });
});

class FakeInstanceRepository implements InstanceRepositoryPort {
  private readonly records = new Map<string, Instance>();

  load(id: InstanceId): Promise<Instance | undefined> {
    return Promise.resolve(this.records.get(String(id)));
  }

  save(aggregate: Instance): Promise<RepositorySaveResult> {
    this.records.set(String(aggregate.id), aggregate);
    return Promise.resolve({ saved: true });
  }

  exists(id: InstanceId): Promise<boolean> {
    return Promise.resolve(this.records.has(String(id)));
  }

  findByStatus(status: InstanceStatus): Promise<readonly Instance[]> {
    return Promise.resolve(this.list().filter((instance) => instance.status === status));
  }

  findNonTerminal(): Promise<readonly Instance[]> {
    return Promise.resolve(this.list().filter((instance) => instance.status !== "destroyed"));
  }

  getCurrentSessionId(instanceId: InstanceId): Promise<SessionId | undefined> {
    return Promise.resolve(this.records.get(String(instanceId))?.currentSessionId);
  }

  list(): readonly Instance[] {
    return Object.freeze([...this.records.values()]);
  }
}

class FakeHealthStatusRepository implements HealthStatusRepositoryPort {
  private readonly records = new Map<string, HealthStatus>();

  constructor(initialRecords: readonly HealthStatus[]) {
    for (const record of initialRecords) {
      this.records.set(String(record.id), record);
    }
  }

  load(id: HealthStatusId): Promise<HealthStatus | undefined> {
    return Promise.resolve(this.records.get(String(id)));
  }

  save(aggregate: HealthStatus): Promise<RepositorySaveResult> {
    this.records.set(String(aggregate.id), aggregate);
    return Promise.resolve({ saved: true });
  }

  exists(id: HealthStatusId): Promise<boolean> {
    return Promise.resolve(this.records.has(String(id)));
  }

  findBySubject(subjectRef: string): Promise<HealthStatus | undefined> {
    return Promise.resolve(this.list().find((health) => health.subjectRef === subjectRef));
  }

  findByCategory(category: HealthCategory): Promise<readonly HealthStatus[]> {
    return Promise.resolve(this.list().filter((health) => health.category === category));
  }

  private list(): readonly HealthStatus[] {
    return Object.freeze([...this.records.values()]);
  }
}

class FakeSessionRepository implements SessionRepositoryPort {
  private readonly records = new Map<string, Session>();

  constructor(initialRecords: readonly Session[] = []) {
    for (const record of initialRecords) {
      this.records.set(String(record.id), record);
    }
  }

  load(id: SessionId): Promise<Session | undefined> {
    return Promise.resolve(this.records.get(String(id)));
  }

  save(aggregate: Session): Promise<RepositorySaveResult> {
    this.records.set(String(aggregate.id), aggregate);
    return Promise.resolve({ saved: true });
  }

  exists(id: SessionId): Promise<boolean> {
    return Promise.resolve(this.records.has(String(id)));
  }

  findByInstance(instanceId: InstanceId): Promise<readonly Session[]> {
    return Promise.resolve(this.list().filter((session) => session.instanceId === instanceId));
  }

  findByStatusForInstance(
    instanceId: InstanceId,
    status: SessionStatus,
  ): Promise<readonly Session[]> {
    return Promise.resolve(
      this.list().filter(
        (session) => session.instanceId === instanceId && session.status === status,
      ),
    );
  }

  findRecoveryRequired(): Promise<readonly Session[]> {
    return Promise.resolve(this.list().filter((session) => session.requiresRecovery));
  }

  private list(): readonly Session[] {
    return Object.freeze([...this.records.values()]);
  }
}

class FakeMessageRepository implements MessageRepositoryPort {
  private readonly records = new Map<string, Message>();

  constructor(initialRecords: readonly Message[] = []) {
    for (const record of initialRecords) {
      this.records.set(String(record.id), record);
    }
  }

  load(id: MessageId): Promise<Message | undefined> {
    return Promise.resolve(this.records.get(String(id)));
  }

  save(aggregate: Message): Promise<RepositorySaveResult> {
    this.records.set(String(aggregate.id), aggregate);
    return Promise.resolve({ saved: true });
  }

  exists(id: MessageId): Promise<boolean> {
    return Promise.resolve(this.records.has(String(id)));
  }

  findByStatus(status: MessageStatus): Promise<readonly Message[]> {
    return Promise.resolve(this.list().filter((message) => message.status === status));
  }

  findByIdempotencyKey(): Promise<Message | undefined> {
    return Promise.resolve(undefined);
  }

  findRecoverableByOwner(ownerContext: DomainOwnerContext): Promise<readonly Message[]> {
    if (ownerContext !== "messaging") {
      return Promise.resolve(Object.freeze([]));
    }

    return Promise.resolve(
      this.list().filter((message) => ["queued", "processing", "failed"].includes(message.status)),
    );
  }

  private list(): readonly Message[] {
    return Object.freeze([...this.records.values()]);
  }
}

class FakeChatRepository implements ChatRepositoryPort {
  private readonly records = new Map<string, Chat>();

  constructor(initialRecords: readonly Chat[] = []) {
    for (const record of initialRecords) {
      this.records.set(String(record.id), record);
    }
  }

  load(id: ChatId): Promise<Chat | undefined> {
    return Promise.resolve(this.records.get(String(id)));
  }

  save(aggregate: Chat): Promise<RepositorySaveResult> {
    this.records.set(String(aggregate.id), aggregate);
    return Promise.resolve({ saved: true });
  }

  exists(id: ChatId): Promise<boolean> {
    return Promise.resolve(this.records.has(String(id)));
  }

  findByInstance(instanceId: InstanceId): Promise<readonly Chat[]> {
    return Promise.resolve(this.list().filter((chat) => chat.instanceId === instanceId));
  }

  findByStatus(status: ChatStatus): Promise<readonly Chat[]> {
    return Promise.resolve(this.list().filter((chat) => chat.status === status));
  }

  findByJid(jid: Jid): Promise<Chat | undefined> {
    return Promise.resolve(this.list().find((chat) => chat.jid === jid));
  }

  findByLabel(labelId: LabelId): Promise<readonly Chat[]> {
    return Promise.resolve(this.list().filter((chat) => chat.labelIds.includes(labelId)));
  }

  private list(): readonly Chat[] {
    return Object.freeze([...this.records.values()]);
  }
}

class FakeContactRepository implements ContactRepositoryPort {
  private readonly records = new Map<string, Contact>();

  constructor(initialRecords: readonly Contact[] = []) {
    for (const record of initialRecords) {
      this.records.set(String(record.id), record);
    }
  }

  load(id: ContactId): Promise<Contact | undefined> {
    return Promise.resolve(this.records.get(String(id)));
  }

  save(aggregate: Contact): Promise<RepositorySaveResult> {
    this.records.set(String(aggregate.id), aggregate);
    return Promise.resolve({ saved: true });
  }

  exists(id: ContactId): Promise<boolean> {
    return Promise.resolve(this.records.has(String(id)));
  }

  findByInstance(instanceId: InstanceId): Promise<readonly Contact[]> {
    return Promise.resolve(this.list().filter((contact) => contact.instanceId === instanceId));
  }

  findByStatus(status: ContactStatus): Promise<readonly Contact[]> {
    return Promise.resolve(this.list().filter((contact) => contact.status === status));
  }

  findByJid(jid: Jid): Promise<Contact | undefined> {
    return Promise.resolve(this.list().find((contact) => contact.jid === jid));
  }

  private list(): readonly Contact[] {
    return Object.freeze([...this.records.values()]);
  }
}

class FakeGroupRepository implements GroupRepositoryPort {
  private readonly records = new Map<string, Group>();

  constructor(initialRecords: readonly Group[] = []) {
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

  findByInstance(instanceId: InstanceId): Promise<readonly Group[]> {
    return Promise.resolve(this.list().filter((group) => group.instanceId === instanceId));
  }

  findByStatus(status: GroupStatus): Promise<readonly Group[]> {
    return Promise.resolve(this.list().filter((group) => group.status === status));
  }

  findByJid(jid: Jid): Promise<Group | undefined> {
    return Promise.resolve(this.list().find((group) => group.jid === jid));
  }

  private list(): readonly Group[] {
    return Object.freeze([...this.records.values()]);
  }
}

class FakeEventLogReplayPort implements EventLogReplayPort {
  constructor(private readonly events: readonly PlatformEventRecord[]) {}

  replayEvents(): ApplicationPortResult<EventLogReplayResult> {
    return ok({
      events: this.events,
      cursorStatus: "no_cursor",
      ...optional("oldestCursor", this.events[0]?.cursor),
      ...optional("latestCursor", this.events.at(-1)?.cursor),
    });
  }
}

class FakeWorkerJobRepository implements WorkerJobRepositoryPort {
  private readonly records = new Map<string, WorkerJob>();

  constructor(initialRecords: readonly WorkerJob[] = []) {
    for (const record of initialRecords) {
      this.records.set(String(record.id), record);
    }
  }

  load(id: JobId): Promise<WorkerJob | undefined> {
    return Promise.resolve(this.records.get(String(id)));
  }

  save(aggregate: WorkerJob): Promise<RepositorySaveResult> {
    this.records.set(String(aggregate.id), aggregate);
    return Promise.resolve({ saved: true });
  }

  exists(id: JobId): Promise<boolean> {
    return Promise.resolve(this.records.has(String(id)));
  }

  findByStatus(status: JobStatus): Promise<readonly WorkerJob[]> {
    return Promise.resolve(this.list().filter((job) => job.status === status));
  }

  findByOwnerContext(ownerContext: DomainOwnerContext): Promise<readonly WorkerJob[]> {
    return Promise.resolve(this.list().filter((job) => job.ownerContext === ownerContext));
  }

  findByIdempotencyKey(): Promise<WorkerJob | undefined> {
    return Promise.resolve(undefined);
  }

  private list(): readonly WorkerJob[] {
    return Object.freeze([...this.records.values()]);
  }
}

class FakeQueueProvider implements QueueProviderPort {
  readonly enqueued: QueueWorkRequest[] = [];
  private readonly receiptByIdempotencyKey = new Map<string, QueueVisibilityReceipt>();

  enqueue(
    work: QueueWorkRequest,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<QueueVisibilityReceipt>> {
    void context;

    const existing = this.receiptByIdempotencyKey.get(work.idempotencyKey);

    if (existing !== undefined) {
      return Promise.resolve(ok(existing));
    }

    const receipt = Object.freeze({
      jobId: work.jobId,
      visible: true,
      queueRef: `queue:${work.jobId}`,
    });

    this.enqueued.push(work);
    this.receiptByIdempotencyKey.set(work.idempotencyKey, receipt);

    return Promise.resolve(ok(receipt));
  }

  reserve(
    workType: QueueWorkType,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<QueueReservation | undefined>> {
    void workType;
    void context;
    return Promise.resolve(ok(undefined));
  }

  acknowledge(
    reservation: QueueReservation,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<QueueVisibilityReceipt>> {
    void context;
    return Promise.resolve(ok(this.receiptFor(reservation.jobId)));
  }

  releaseForRetry(
    reservation: QueueReservation,
    delayMilliseconds: number,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<QueueVisibilityReceipt>> {
    void delayMilliseconds;
    void context;
    return Promise.resolve(ok(this.receiptFor(reservation.jobId)));
  }

  moveToDeadLetter(
    reservation: QueueReservation,
    reasonCode: string,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<QueueVisibilityReceipt>> {
    void reasonCode;
    void context;
    return Promise.resolve(ok(this.receiptFor(reservation.jobId)));
  }

  private receiptFor(jobId: QueueVisibilityReceipt["jobId"]): QueueVisibilityReceipt {
    return Object.freeze({
      jobId,
      visible: true,
      queueRef: `queue:${jobId}`,
    });
  }
}

class FakeWebhookSubscriptionRepository implements WebhookSubscriptionRepositoryPort {
  private readonly records = new Map<string, WebhookSubscription>();

  constructor(initialRecords: readonly WebhookSubscription[] = []) {
    for (const record of initialRecords) {
      this.records.set(String(record.id), record);
    }
  }

  load(id: WebhookId): Promise<WebhookSubscription | undefined> {
    return Promise.resolve(this.records.get(String(id)));
  }

  save(aggregate: WebhookSubscription): Promise<RepositorySaveResult> {
    this.records.set(String(aggregate.id), aggregate);
    return Promise.resolve({ saved: true });
  }

  exists(id: WebhookId): Promise<boolean> {
    return Promise.resolve(this.records.has(String(id)));
  }

  findByStatus(status: WebhookSubscriptionStatus): Promise<readonly WebhookSubscription[]> {
    return Promise.resolve(this.list().filter((webhook) => webhook.status === status));
  }

  findActiveForSignal(): Promise<readonly WebhookSubscription[]> {
    return Promise.resolve(this.list().filter((webhook) => webhook.status === "active"));
  }

  private list(): readonly WebhookSubscription[] {
    return Object.freeze([...this.records.values()]);
  }
}

class FakeWebhookDeliveryRepository implements WebhookDeliveryRepositoryPort {
  private readonly records = new Map<string, WebhookDelivery>();
  private readonly deliveryIdByIdempotencyKey = new Map<string, WebhookDeliveryId>();

  constructor(initialRecords: readonly WebhookDelivery[] = []) {
    for (const record of initialRecords) {
      this.records.set(String(record.id), record);
    }
  }

  load(id: WebhookDeliveryId): Promise<WebhookDelivery | undefined> {
    return Promise.resolve(this.records.get(String(id)));
  }

  save(aggregate: WebhookDelivery): Promise<RepositorySaveResult> {
    this.records.set(String(aggregate.id), aggregate);
    return Promise.resolve({ saved: true });
  }

  exists(id: WebhookDeliveryId): Promise<boolean> {
    return Promise.resolve(this.records.has(String(id)));
  }

  findByStatus(status: WebhookDeliveryStatus): Promise<readonly WebhookDelivery[]> {
    return Promise.resolve(this.list().filter((delivery) => delivery.status === status));
  }

  findBySourceSignal(sourceSignalRef: string): Promise<readonly WebhookDelivery[]> {
    return Promise.resolve(
      this.list().filter((delivery) => delivery.sourceSignalRef === sourceSignalRef),
    );
  }

  findByIdempotencyKey(idempotencyKey: IdempotencyKey): Promise<WebhookDelivery | undefined> {
    const deliveryId = this.deliveryIdByIdempotencyKey.get(String(idempotencyKey));
    return Promise.resolve(
      deliveryId === undefined ? undefined : this.records.get(String(deliveryId)),
    );
  }

  recordIdempotencyKey(idempotencyKey: IdempotencyKey, deliveryId: WebhookDeliveryId): void {
    this.deliveryIdByIdempotencyKey.set(String(idempotencyKey), deliveryId);
  }

  private list(): readonly WebhookDelivery[] {
    return Object.freeze([...this.records.values()]);
  }
}

class FakeWebhookDeliveryOperationIntentStore implements WebhookDeliveryOperationIntentStorePort {
  private readonly deliveryRefs: readonly string[];

  constructor(deliveryRefs: readonly string[]) {
    this.deliveryRefs = Object.freeze([...deliveryRefs]);
  }

  storeWebhookDeliveryOperationIntent(
    intent: WebhookDeliveryOperationIntentInput,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<WebhookDeliveryOperationIntentReceipt>> {
    void context;

    return Promise.resolve(
      ok({
        webhookDeliveryOperationIntentRef:
          intent.webhookDeliveryOperationIntentRef ??
          createWebhookDeliveryOperationIntentRef("webhook_operation_intent_generated"),
        kind: intent.kind,
        deliveryCount: intent.kind === "bulk_redrive" ? intent.deliveryRefs.length : 0,
        createdAtEpochMilliseconds: 1,
      }),
    );
  }

  resolveWebhookDeliveryOperationIntent(
    webhookDeliveryOperationIntentRef: WebhookDeliveryOperationIntentRef,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<StoredWebhookDeliveryOperationIntent>> {
    void context;

    return Promise.resolve(
      ok({
        webhookDeliveryOperationIntentRef,
        kind: "bulk_redrive",
        deliveryRefs: this.deliveryRefs,
        createdAtEpochMilliseconds: 1,
      }),
    );
  }
}

function platformEvent(
  input: Readonly<{
    id: string;
    type: string;
    source: string;
    timestamp: string;
    payload?: PlatformEventRecord["payload"];
    resourceRef?: string;
    correlationId?: string;
  }>,
): PlatformEventRecord {
  return Object.freeze({
    id: input.id,
    cursor: `eventlog:${input.id}`,
    type: input.type,
    version: "v1",
    timestamp: input.timestamp,
    dataClassification: "internal",
    source: input.source,
    payload: Object.freeze(input.payload ?? {}),
    ...optional("resourceRef", input.resourceRef),
    ...optional("correlationId", input.correlationId),
  });
}

function optional<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Record<TKey, TValue>);
}
