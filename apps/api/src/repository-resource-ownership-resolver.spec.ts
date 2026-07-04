import type {
  Chat,
  ChatId,
  ChatRepositoryPort,
  Contact,
  ContactId,
  ContactRepositoryPort,
  Group,
  GroupId,
  GroupRepositoryPort,
  InstanceId,
  Jid,
  JobId,
  Message,
  MessageId,
  MessageRepositoryPort,
  Session,
  SessionId,
  SessionRepositoryPort,
  WorkerJob,
  WorkerJobRepositoryPort,
} from "@omniwa/domain";
import type { ApiCredential } from "@omniwa/interface-api";
import { describe, expect, it } from "vitest";

import { RepositoryApiResourceOwnershipResolver } from "./repository-resource-ownership-resolver.js";

const instanceId = opaqueId<InstanceId>("inst_allowed");

describe("Repository API resource ownership resolver", () => {
  it("resolves instance-scoped aggregates from repository ports", async () => {
    const resolver = new RepositoryApiResourceOwnershipResolver({
      sessionRepository: sessionRepository(session("sess_1", instanceId)),
      messageRepository: messageRepository(message("msg_1", instanceId)),
      chatRepository: chatRepository(chat("chat_1", instanceId)),
      contactRepository: contactRepository(contact("contact_1", instanceId)),
      groupRepository: groupRepository(group("group_1", instanceId)),
    });

    await expect(
      resolver.resolve({
        credential: credential(),
        resourceType: "session",
        targetRef: "sess_1",
        operationRef: "GetSession",
      }),
    ).resolves.toEqual({ status: "resolved", instanceRef: "inst_allowed" });
    await expect(
      resolver.resolve({
        credential: credential(),
        resourceType: "message",
        targetRef: "msg_1",
        operationRef: "GetMessage",
      }),
    ).resolves.toEqual({ status: "resolved", instanceRef: "inst_allowed" });
    await expect(
      resolver.resolve({
        credential: credential(),
        resourceType: "chat",
        targetRef: "chat_1",
        operationRef: "GetChat",
      }),
    ).resolves.toEqual({ status: "resolved", instanceRef: "inst_allowed" });
    await expect(
      resolver.resolve({
        credential: credential(),
        resourceType: "contact",
        targetRef: "contact_1",
        operationRef: "GetContact",
      }),
    ).resolves.toEqual({ status: "resolved", instanceRef: "inst_allowed" });
    await expect(
      resolver.resolve({
        credential: credential(),
        resourceType: "group",
        targetRef: "group_1",
        operationRef: "GetGroup",
      }),
    ).resolves.toEqual({ status: "resolved", instanceRef: "inst_allowed" });
  });

  it("resolves worker jobs from safe metadata only", async () => {
    const resolver = new RepositoryApiResourceOwnershipResolver({
      workerJobRepository: workerJobRepository(
        workerJob("job_1", { jobKind: "outbound_message", instanceId: "inst_allowed" }),
      ),
    });

    await expect(
      resolver.resolve({
        credential: credential(),
        resourceType: "job",
        targetRef: "job_1",
        operationRef: "GetWorkerJobStatus",
      }),
    ).resolves.toEqual({ status: "resolved", instanceRef: "inst_allowed" });
  });

  it("fails closed for missing repositories, missing aggregates, unsupported resources, and bad ids", async () => {
    const resolver = new RepositoryApiResourceOwnershipResolver({
      messageRepository: messageRepository(undefined),
      workerJobRepository: workerJobRepository(workerJob("job_missing_owner", undefined)),
    });

    await expect(
      resolver.resolve({
        credential: credential(),
        resourceType: "message",
        targetRef: "msg_missing",
        operationRef: "GetMessage",
      }),
    ).resolves.toEqual({ status: "unresolved" });
    await expect(
      resolver.resolve({
        credential: credential(),
        resourceType: "webhook",
        targetRef: "wh_1",
        operationRef: "GetWebhook",
      }),
    ).resolves.toEqual({ status: "unresolved" });
    await expect(
      resolver.resolve({
        credential: credential(),
        resourceType: "job",
        targetRef: "job_missing_owner",
        operationRef: "GetWorkerJobStatus",
      }),
    ).resolves.toEqual({ status: "unresolved" });
    await expect(
      resolver.resolve({
        credential: credential(),
        resourceType: "message",
        targetRef: "raw/not-safe",
        operationRef: "GetMessage",
      }),
    ).resolves.toEqual({ status: "unresolved" });
  });
});

function sessionRepository(aggregate: Session | undefined): SessionRepositoryPort {
  return aggregateRepository<Session>(aggregate) as unknown as SessionRepositoryPort;
}

function messageRepository(aggregate: Message | undefined): MessageRepositoryPort {
  return aggregateRepository<Message>(aggregate) as unknown as MessageRepositoryPort;
}

function chatRepository(aggregate: Chat | undefined): ChatRepositoryPort {
  return aggregateRepository<Chat>(aggregate) as unknown as ChatRepositoryPort;
}

function contactRepository(aggregate: Contact | undefined): ContactRepositoryPort {
  return aggregateRepository<Contact>(aggregate) as unknown as ContactRepositoryPort;
}

function groupRepository(aggregate: Group | undefined): GroupRepositoryPort {
  return aggregateRepository<Group>(aggregate) as unknown as GroupRepositoryPort;
}

function workerJobRepository(aggregate: WorkerJob | undefined): WorkerJobRepositoryPort {
  return aggregateRepository<WorkerJob>(aggregate) as unknown as WorkerJobRepositoryPort;
}

function aggregateRepository<TAggregate>(aggregate: TAggregate | undefined) {
  return {
    load: () => Promise.resolve(aggregate),
    save: () => Promise.resolve({ saved: true }),
    exists: () => Promise.resolve(aggregate !== undefined),
  };
}

function credential(): ApiCredential {
  return {
    kind: "api_key",
    keyId: "ownership-repository-key",
    scopes: ["instances:read"] as const,
    allowedInstanceRefs: ["inst_allowed"],
  };
}

function session(id: string, owner: InstanceId): Session {
  return Object.freeze({
    id: opaqueId<SessionId>(id),
    instanceId: owner,
    status: "active",
    requiresRecovery: false,
    domainEvents: [],
  });
}

function message(id: string, owner: InstanceId): Message {
  return Object.freeze({
    id: opaqueId<MessageId>(id),
    instanceId: owner,
    direction: "outbound",
    type: "text",
    status: "sent",
    domainEvents: [],
  });
}

function chat(id: string, owner: InstanceId): Chat {
  return Object.freeze({
    id: opaqueId<ChatId>(id),
    instanceId: owner,
    jid: "chat@s.whatsapp.net" as Jid,
    kind: "direct",
    status: "open",
    labelIds: [],
    unreadCount: 0,
    muted: false,
    pinned: false,
  });
}

function contact(id: string, owner: InstanceId): Contact {
  return Object.freeze({
    id: opaqueId<ContactId>(id),
    instanceId: owner,
    jid: "contact@s.whatsapp.net" as Jid,
    status: "active",
  });
}

function group(id: string, owner: InstanceId): Group {
  return Object.freeze({
    id: opaqueId<GroupId>(id),
    instanceId: owner,
    jid: "group@g.us" as Jid,
    status: "active",
    metadata: Object.freeze({ subject: "Group" }),
    members: [],
    actions: [],
    muted: false,
    archived: false,
    pinned: false,
    domainEvents: [],
  });
}

function workerJob(id: string, safeMetadata: WorkerJob["safeMetadata"] | undefined): WorkerJob {
  return Object.freeze({
    id: opaqueId<JobId>(id),
    ownerContext: "operations",
    workType: "outbound_message",
    ...(safeMetadata === undefined ? {} : { safeMetadata }),
    status: "queued",
    retryPolicy: Object.freeze({
      maxAttempts: 3,
      initialDelayMilliseconds: 1000,
      backoffMultiplier: 2,
    }),
    recoveryActionRequired: false,
    domainEvents: [],
  });
}

function opaqueId<TId>(value: string): TId {
  return value as TId;
}
