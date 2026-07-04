import type {
  ChatId,
  ChatRepositoryPort,
  ContactId,
  ContactRepositoryPort,
  GroupId,
  GroupRepositoryPort,
  InstanceId,
  JobId,
  MessageId,
  MessageRepositoryPort,
  SessionId,
  SessionRepositoryPort,
  WorkerJobRepositoryPort,
} from "@omniwa/domain";

import type {
  ApiResourceOwnershipRequest,
  ApiResourceOwnershipResolution,
  ApiResourceOwnershipResolver,
} from "./resource-ownership.js";

export type RepositoryApiResourceOwnershipResolverOptions = Readonly<{
  sessionRepository?: SessionRepositoryPort;
  messageRepository?: MessageRepositoryPort;
  chatRepository?: ChatRepositoryPort;
  contactRepository?: ContactRepositoryPort;
  groupRepository?: GroupRepositoryPort;
  workerJobRepository?: WorkerJobRepositoryPort;
}>;

export class RepositoryApiResourceOwnershipResolver implements ApiResourceOwnershipResolver {
  constructor(private readonly repositories: RepositoryApiResourceOwnershipResolverOptions) {}

  async resolve(request: ApiResourceOwnershipRequest): Promise<ApiResourceOwnershipResolution> {
    if (request.targetRef === undefined) {
      return unresolved();
    }

    try {
      switch (request.resourceType) {
        case "instance":
          return request.targetRef.startsWith("inst_")
            ? resolved(opaqueDomainId<InstanceId>(request.targetRef))
            : unresolved();
        case "session":
          return await this.resolveSession(request.targetRef);
        case "message":
          return await this.resolveMessage(request.targetRef);
        case "chat":
          return await this.resolveChat(request.targetRef);
        case "contact":
          return await this.resolveContact(request.targetRef);
        case "group":
          return await this.resolveGroup(request.targetRef);
        case "job":
          return await this.resolveWorkerJob(request.targetRef);
        default:
          return unresolved();
      }
    } catch {
      return unresolved();
    }
  }

  private async resolveSession(sessionRef: string): Promise<ApiResourceOwnershipResolution> {
    const session = await this.repositories.sessionRepository?.load(
      opaqueDomainId<SessionId>(sessionRef),
    );

    return session === undefined ? unresolved() : resolved(session.instanceId);
  }

  private async resolveMessage(messageRef: string): Promise<ApiResourceOwnershipResolution> {
    const message = await this.repositories.messageRepository?.load(
      opaqueDomainId<MessageId>(messageRef),
    );

    return message === undefined ? unresolved() : resolved(message.instanceId);
  }

  private async resolveChat(chatRef: string): Promise<ApiResourceOwnershipResolution> {
    const chat = await this.repositories.chatRepository?.load(opaqueDomainId<ChatId>(chatRef));

    return chat === undefined ? unresolved() : resolved(chat.instanceId);
  }

  private async resolveContact(contactRef: string): Promise<ApiResourceOwnershipResolution> {
    const contact = await this.repositories.contactRepository?.load(
      opaqueDomainId<ContactId>(contactRef),
    );

    return contact === undefined ? unresolved() : resolved(contact.instanceId);
  }

  private async resolveGroup(groupRef: string): Promise<ApiResourceOwnershipResolution> {
    const group = await this.repositories.groupRepository?.load(opaqueDomainId<GroupId>(groupRef));

    return group === undefined ? unresolved() : resolved(group.instanceId);
  }

  private async resolveWorkerJob(jobRef: string): Promise<ApiResourceOwnershipResolution> {
    const job = await this.repositories.workerJobRepository?.load(opaqueDomainId<JobId>(jobRef));
    const instanceId = job?.safeMetadata?.instanceId;

    return instanceId === undefined || !instanceId.startsWith("inst_")
      ? unresolved()
      : resolved(opaqueDomainId<InstanceId>(instanceId));
  }
}

function resolved(instanceId: InstanceId): ApiResourceOwnershipResolution {
  return Object.freeze({
    status: "resolved",
    instanceRef: String(instanceId),
  });
}

function unresolved(): ApiResourceOwnershipResolution {
  return Object.freeze({ status: "unresolved" });
}

function opaqueDomainId<TId>(value: string): TId {
  if (!/^[A-Za-z0-9._:-]+$/u.test(value)) {
    throw new TypeError("Resource reference must be an opaque safe token.");
  }

  return value as TId;
}
