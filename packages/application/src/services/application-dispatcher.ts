import {
  type Chat,
  type ChatRepositoryPort,
  chatStatuses,
  createChatId,
  type Contact,
  type ContactRepositoryPort,
  contactStatuses,
  createContactId,
  type Group,
  type GroupMember,
  type GroupRepositoryPort,
  createInstance,
  createGroupId,
  createInstanceId,
  createMessageId,
  createWebhookDeliveryId,
  createWebhookId,
  type GuardrailDecisionRepositoryPort,
  type HealthStatusRepositoryPort,
  type Instance,
  type InstanceRepositoryPort,
  createJobId,
  jobStatuses,
  type Message,
  type MessageRepositoryPort,
  messageStatuses,
  type Session,
  type SessionRepositoryPort,
  type WebhookDelivery,
  type WebhookDeliveryRepositoryPort,
  webhookDeliveryStatuses,
  type WebhookSubscription,
  type WebhookSubscriptionRepositoryPort,
  webhookSubscriptionStatuses,
  type WorkerJob,
  type WorkerJobRepositoryPort,
} from "@omniwa/domain";
import { cryptoUUIDGenerator, systemClock, type Clock, type UUIDGenerator } from "@omniwa/shared";

import {
  type ApplicationCommandEnvelope,
  type ApplicationCommandOutcome,
  createApplicationCommandOutcome,
} from "../commands/command-model.js";
import type { ApplicationCommandName } from "../commands/command-catalog.js";
import { getApplicationQueryDefinition } from "../queries/query-catalog.js";
import type { ApplicationQueryName } from "../queries/query-catalog.js";
import {
  type ApplicationQueryEnvelope,
  type ApplicationQueryOutcome,
  createApplicationQueryOutcome,
} from "../queries/query-model.js";
import type { EventLogReplayPort, PlatformEventRecord } from "../ports/event-log.js";
import type { GroupMutationIntentStorePort } from "../ports/group-mutation-intent-store.js";
import type {
  CommandHandler,
  CommandHandlerRegistry,
  QueryHandler,
  QueryHandlerRegistry,
} from "./handlers/command-handler.js";
import {
  createActiveSessionResolver,
  type ActiveSessionResolver,
} from "./active-session-resolver.js";
import type { OutboundMessageIntentStorePort } from "../ports/outbound-message-intent-store.js";
import type { QueueProviderPort } from "../ports/queue-provider.js";
import type { MessagingProviderPort } from "../ports/messaging-provider.js";
import type { WebhookDeliveryOperationIntentStorePort } from "../ports/webhook-delivery-operation-intent-store.js";
import type { DomainEventPublisher } from "./domain-event-publisher.js";
import {
  createMinimalMessageGuardrailService,
  type MinimalMessageGuardrailService,
} from "./minimal-message-guardrail.js";
import { createCancelMessageHandler } from "./handlers/cancel-message.handler.js";
import {
  createGroupMutationHandler,
  type GroupMutationCommandName,
} from "./handlers/group-mutation.handler.js";
import { createProcessOutboundMessageWorkHandler } from "./handlers/process-outbound-message-work.handler.js";
import { createRetryMessageSendHandler } from "./handlers/retry-message-send.handler.js";
import { createRetryWebhookDeliveryHandler } from "./handlers/retry-webhook-delivery.handler.js";
import { createSendTextMessageHandler } from "./handlers/send-text-message.handler.js";

const groupMutationCommands: readonly GroupMutationCommandName[] = Object.freeze([
  "UpdateGroupMetadata",
  "UpdateGroupLocalState",
  "AddGroupMember",
  "RemoveGroupMember",
  "PromoteGroupMember",
  "DemoteGroupMember",
]);

export type ApplicationDispatcherRepositories = Readonly<{
  instanceRepository: InstanceRepositoryPort;
  healthStatusRepository?: HealthStatusRepositoryPort;
  sessionRepository?: SessionRepositoryPort;
  messageRepository?: MessageRepositoryPort;
  chatRepository?: ChatRepositoryPort;
  contactRepository?: ContactRepositoryPort;
  groupRepository?: GroupRepositoryPort;
  guardrailDecisionRepository?: GuardrailDecisionRepositoryPort;
  workerJobRepository?: WorkerJobRepositoryPort;
  webhookSubscriptionRepository?: WebhookSubscriptionRepositoryPort;
  webhookDeliveryRepository?: WebhookDeliveryRepositoryPort;
}>;

export type ApplicationDispatcherOptions = Readonly<{
  repositories: ApplicationDispatcherRepositories;
  uuidGenerator?: UUIDGenerator;
  clock?: Clock;
  healthSubjectRef?: string;
  activeSessionResolver?: ActiveSessionResolver;
  outboundMessageIntentStore?: OutboundMessageIntentStorePort;
  groupMutationIntentStore?: GroupMutationIntentStorePort;
  webhookDeliveryOperationIntentStore?: WebhookDeliveryOperationIntentStorePort;
  guardrailService?: MinimalMessageGuardrailService;
  queueProvider?: QueueProviderPort;
  messagingProvider?: MessagingProviderPort;
  domainEventPublisher?: DomainEventPublisher;
  eventLog?: EventLogReplayPort;
}>;

export type ApplicationDispatcher = Readonly<{
  executeCommand(envelope: ApplicationCommandEnvelope): Promise<ApplicationCommandOutcome>;
  executeQuery(envelope: ApplicationQueryEnvelope): Promise<ApplicationQueryOutcome>;
}>;

export function createApplicationDispatcher(
  options: ApplicationDispatcherOptions,
): ApplicationDispatcher {
  return new DefaultApplicationDispatcher(options);
}

class DefaultApplicationDispatcher implements ApplicationDispatcher {
  private readonly repositories: ApplicationDispatcherRepositories;
  private readonly uuidGenerator: UUIDGenerator;
  private readonly clock: Clock;
  private readonly healthSubjectRef: string;
  private readonly activeSessionResolver: ActiveSessionResolver | undefined;
  private readonly outboundMessageIntentStore: OutboundMessageIntentStorePort | undefined;
  private readonly groupMutationIntentStore: GroupMutationIntentStorePort | undefined;
  private readonly webhookDeliveryOperationIntentStore:
    WebhookDeliveryOperationIntentStorePort | undefined;
  private readonly guardrailService: MinimalMessageGuardrailService | undefined;
  private readonly queueProvider: QueueProviderPort | undefined;
  private readonly messagingProvider: MessagingProviderPort | undefined;
  private readonly domainEventPublisher: DomainEventPublisher | undefined;
  private readonly eventLog: EventLogReplayPort | undefined;
  private readonly commandHandlers: CommandHandlerRegistry;
  private readonly queryHandlers: QueryHandlerRegistry;

  constructor(options: ApplicationDispatcherOptions) {
    this.repositories = options.repositories;
    this.uuidGenerator = options.uuidGenerator ?? cryptoUUIDGenerator;
    this.clock = options.clock ?? systemClock;
    this.healthSubjectRef = options.healthSubjectRef ?? "platform";
    this.activeSessionResolver = options.activeSessionResolver;
    this.outboundMessageIntentStore = options.outboundMessageIntentStore;
    this.groupMutationIntentStore = options.groupMutationIntentStore;
    this.webhookDeliveryOperationIntentStore = options.webhookDeliveryOperationIntentStore;
    this.guardrailService = options.guardrailService;
    this.queueProvider = options.queueProvider;
    this.messagingProvider = options.messagingProvider;
    this.domainEventPublisher = options.domainEventPublisher;
    this.eventLog = options.eventLog;
    this.commandHandlers = this.buildCommandHandlers();
    this.queryHandlers = this.buildQueryHandlers();
  }

  async executeCommand(envelope: ApplicationCommandEnvelope): Promise<ApplicationCommandOutcome> {
    try {
      const handler = this.commandHandlers.get(envelope.name);

      if (handler === undefined) {
        return commandOutcome(envelope, "failed", {
          accepted: false,
          retryable: false,
          reasonCode: "application_handler_not_implemented",
        });
      }

      return handler(envelope);
    } catch {
      return commandOutcome(envelope, "failed", {
        accepted: false,
        retryable: true,
        reasonCode: "application_dependency_failure",
      });
    }
  }

  async executeQuery(envelope: ApplicationQueryEnvelope): Promise<ApplicationQueryOutcome> {
    try {
      const handler = this.queryHandlers.get(envelope.name);

      if (handler === undefined) {
        return queryOutcome(envelope, this.clock, "unavailable", {
          reasonCode: "application_handler_not_implemented",
        });
      }

      return handler(envelope);
    } catch {
      return queryOutcome(envelope, this.clock, "unavailable", {
        reasonCode: "application_dependency_failure",
      });
    }
  }

  private buildCommandHandlers(): CommandHandlerRegistry {
    const handlers = new Map<ApplicationCommandName, CommandHandler>([
      ["CreateInstance", (envelope) => this.createInstance(envelope)],
    ]);
    const sendTextHandler = this.createSendTextMessageHandler();

    if (sendTextHandler !== undefined) {
      handlers.set("SendTextMessage", sendTextHandler);
    }

    const retryMessageSendHandler = this.createRetryMessageSendHandler();

    if (retryMessageSendHandler !== undefined) {
      handlers.set("RetryMessageSend", retryMessageSendHandler);
    }

    const cancelMessageHandler = this.createCancelMessageHandler();

    if (cancelMessageHandler !== undefined) {
      handlers.set("CancelMessage", cancelMessageHandler);
    }

    const processOutboundMessageWorkHandler = this.createProcessOutboundMessageWorkHandler();

    if (processOutboundMessageWorkHandler !== undefined) {
      handlers.set("ProcessOutboundMessageWork", processOutboundMessageWorkHandler);
    }

    for (const commandName of groupMutationCommands) {
      const groupMutationHandler = this.createGroupMutationHandler(commandName);

      if (groupMutationHandler !== undefined) {
        handlers.set(commandName, groupMutationHandler);
      }
    }

    const retryWebhookDeliveryHandler = this.createRetryWebhookDeliveryHandler();

    if (retryWebhookDeliveryHandler !== undefined) {
      handlers.set("RetryWebhookDelivery", retryWebhookDeliveryHandler);
      handlers.set("RedriveWebhookDelivery", retryWebhookDeliveryHandler);
      handlers.set("BulkRedriveWebhookDeliveries", retryWebhookDeliveryHandler);
    }

    return handlers;
  }

  private buildQueryHandlers(): QueryHandlerRegistry {
    return new Map<ApplicationQueryName, QueryHandler>([
      ["GetHealthStatus", (envelope) => this.getHealthStatus(envelope)],
      ["GetInstanceStatus", (envelope) => this.getInstanceStatus(envelope)],
      ["ListInstances", (envelope) => this.listInstances(envelope)],
      ["ListInstanceSessions", (envelope) => this.listInstanceSessions(envelope)],
      ["ListInstanceMessages", (envelope) => this.listInstanceMessages(envelope)],
      ["GetMessageStatus", (envelope) => this.getMessageStatus(envelope)],
      ["ListChats", (envelope) => this.listChats(envelope)],
      ["ListInstanceChats", (envelope) => this.listInstanceChats(envelope)],
      ["GetChatStatus", (envelope) => this.getChatStatus(envelope)],
      ["ListContacts", (envelope) => this.listContacts(envelope)],
      ["ListInstanceContacts", (envelope) => this.listInstanceContacts(envelope)],
      ["GetContactStatus", (envelope) => this.getContactStatus(envelope)],
      ["ListInstanceGroups", (envelope) => this.listInstanceGroups(envelope)],
      ["GetGroupStatus", (envelope) => this.getGroupStatus(envelope)],
      ["ListGroupMembers", (envelope) => this.listGroupMembers(envelope)],
      ["ListEvents", (envelope) => this.listEvents(envelope)],
      ["ListWorkerJobs", (envelope) => this.listWorkerJobs(envelope)],
      ["GetWorkerJobStatus", (envelope) => this.getWorkerJobStatus(envelope)],
      ["GetQueueMetricsSnapshot", (envelope) => this.getQueueMetricsSnapshot(envelope)],
      ["ListWebhookSubscriptions", (envelope) => this.listWebhookSubscriptions(envelope)],
      ["GetWebhookStatus", (envelope) => this.getWebhookStatus(envelope)],
      ["ListWebhookDeliveries", (envelope) => this.listWebhookDeliveries(envelope)],
      ["GetWebhookDeliveryHistory", (envelope) => this.getWebhookDeliveryHistory(envelope)],
    ]);
  }

  private async createInstance(
    envelope: ApplicationCommandEnvelope,
  ): Promise<ApplicationCommandOutcome> {
    const instanceId = createInstanceId(`inst:${this.uuidGenerator.random()}`);
    const instance = createInstance(instanceId);

    await this.repositories.instanceRepository.save(instance);

    return commandOutcome(envelope, "completed", {
      accepted: true,
      retryable: false,
      resultRef: instance.id,
    });
  }

  private createSendTextMessageHandler(): CommandHandler | undefined {
    const sessionRepository = this.repositories.sessionRepository;
    const messageRepository = this.repositories.messageRepository;
    const guardrailDecisionRepository = this.repositories.guardrailDecisionRepository;

    if (
      sessionRepository === undefined ||
      messageRepository === undefined ||
      guardrailDecisionRepository === undefined ||
      this.outboundMessageIntentStore === undefined ||
      this.queueProvider === undefined ||
      this.domainEventPublisher === undefined
    ) {
      return undefined;
    }

    return createSendTextMessageHandler({
      activeSessionResolver:
        this.activeSessionResolver ??
        createActiveSessionResolver({
          instanceRepository: this.repositories.instanceRepository,
          sessionRepository,
        }),
      messageRepository,
      outboundMessageIntentStore: this.outboundMessageIntentStore,
      guardrailService:
        this.guardrailService ??
        createMinimalMessageGuardrailService({
          guardrailDecisionRepository,
        }),
      queueProvider: this.queueProvider,
      domainEventPublisher: this.domainEventPublisher,
      uuidGenerator: this.uuidGenerator,
    });
  }

  private createRetryMessageSendHandler(): CommandHandler | undefined {
    const sessionRepository = this.repositories.sessionRepository;
    const messageRepository = this.repositories.messageRepository;
    const guardrailDecisionRepository = this.repositories.guardrailDecisionRepository;

    if (
      sessionRepository === undefined ||
      messageRepository === undefined ||
      guardrailDecisionRepository === undefined ||
      this.outboundMessageIntentStore === undefined ||
      this.queueProvider === undefined ||
      this.domainEventPublisher === undefined
    ) {
      return undefined;
    }

    return createRetryMessageSendHandler({
      activeSessionResolver:
        this.activeSessionResolver ??
        createActiveSessionResolver({
          instanceRepository: this.repositories.instanceRepository,
          sessionRepository,
        }),
      messageRepository,
      outboundMessageIntentStore: this.outboundMessageIntentStore,
      guardrailService:
        this.guardrailService ??
        createMinimalMessageGuardrailService({
          guardrailDecisionRepository,
        }),
      queueProvider: this.queueProvider,
      domainEventPublisher: this.domainEventPublisher,
      uuidGenerator: this.uuidGenerator,
    });
  }

  private createCancelMessageHandler(): CommandHandler | undefined {
    const messageRepository = this.repositories.messageRepository;

    if (messageRepository === undefined || this.domainEventPublisher === undefined) {
      return undefined;
    }

    return createCancelMessageHandler({
      messageRepository,
      domainEventPublisher: this.domainEventPublisher,
    });
  }

  private createRetryWebhookDeliveryHandler(): CommandHandler | undefined {
    const webhookDeliveryRepository = this.repositories.webhookDeliveryRepository;

    if (webhookDeliveryRepository === undefined || this.queueProvider === undefined) {
      return undefined;
    }

    return createRetryWebhookDeliveryHandler({
      webhookDeliveryRepository,
      queueProvider: this.queueProvider,
      ...optional("webhookDeliveryOperationIntentStore", this.webhookDeliveryOperationIntentStore),
    });
  }

  private createGroupMutationHandler(
    commandName: GroupMutationCommandName,
  ): CommandHandler | undefined {
    const groupRepository = this.repositories.groupRepository;

    if (
      groupRepository === undefined ||
      this.groupMutationIntentStore === undefined ||
      this.domainEventPublisher === undefined
    ) {
      return undefined;
    }

    return createGroupMutationHandler({
      commandName,
      groupRepository,
      groupMutationIntentStore: this.groupMutationIntentStore,
      domainEventPublisher: this.domainEventPublisher,
    });
  }

  private createProcessOutboundMessageWorkHandler(): CommandHandler | undefined {
    const sessionRepository = this.repositories.sessionRepository;
    const messageRepository = this.repositories.messageRepository;

    if (
      sessionRepository === undefined ||
      messageRepository === undefined ||
      this.outboundMessageIntentStore === undefined ||
      this.messagingProvider === undefined ||
      this.domainEventPublisher === undefined
    ) {
      return undefined;
    }

    return createProcessOutboundMessageWorkHandler({
      activeSessionResolver:
        this.activeSessionResolver ??
        createActiveSessionResolver({
          instanceRepository: this.repositories.instanceRepository,
          sessionRepository,
        }),
      messageRepository,
      outboundMessageIntentStore: this.outboundMessageIntentStore,
      messagingProvider: this.messagingProvider,
      domainEventPublisher: this.domainEventPublisher,
    });
  }

  private async listInstances(
    envelope: ApplicationQueryEnvelope,
  ): Promise<ApplicationQueryOutcome> {
    const instances = await this.repositories.instanceRepository.findNonTerminal();

    return queryOutcome(envelope, this.clock, instances.length === 0 ? "empty" : "result", {
      resultRef: `instances:list:${instances.length}`,
      items: instances.map(instanceQueryItem),
    });
  }

  private async getInstanceStatus(
    envelope: ApplicationQueryEnvelope,
  ): Promise<ApplicationQueryOutcome> {
    if (envelope.targetRef === undefined) {
      return queryOutcome(envelope, this.clock, "empty", {
        reasonCode: "instance_target_required",
      });
    }

    const instance = await this.repositories.instanceRepository.load(
      createInstanceId(envelope.targetRef),
    );

    if (instance === undefined) {
      return queryOutcome(envelope, this.clock, "empty", {
        resultRef: `instance:${envelope.targetRef}:empty`,
      });
    }

    return queryOutcome(envelope, this.clock, "result", {
      resultRef: `instance:${instance.id}:${instance.status}`,
      resource: instanceQueryItem(instance),
    });
  }

  private async listInstanceSessions(
    envelope: ApplicationQueryEnvelope,
  ): Promise<ApplicationQueryOutcome> {
    const repository = this.repositories.sessionRepository;

    if (repository === undefined) {
      return queryOutcome(envelope, this.clock, "unavailable", {
        reasonCode: "session_repository_not_configured",
      });
    }

    if (envelope.targetRef === undefined) {
      return queryOutcome(envelope, this.clock, "empty", {
        reasonCode: "instance_target_required",
      });
    }

    const sessions = await repository.findByInstance(createInstanceId(envelope.targetRef));

    return queryOutcome(envelope, this.clock, sessions.length === 0 ? "empty" : "result", {
      resultRef: `sessions:${envelope.targetRef}:list:${sessions.length}`,
      items: sessions.map(sessionQueryItem),
    });
  }

  private async listInstanceMessages(
    envelope: ApplicationQueryEnvelope,
  ): Promise<ApplicationQueryOutcome> {
    const repository = this.repositories.messageRepository;

    if (repository === undefined) {
      return queryOutcome(envelope, this.clock, "unavailable", {
        reasonCode: "message_repository_not_configured",
      });
    }

    if (envelope.targetRef === undefined) {
      return queryOutcome(envelope, this.clock, "empty", {
        reasonCode: "instance_target_required",
      });
    }

    const messages = (
      await Promise.all(messageStatuses.map((status) => repository.findByStatus(status)))
    )
      .flat()
      .filter((message) => String(message.instanceId) === envelope.targetRef);

    return queryOutcome(envelope, this.clock, messages.length === 0 ? "empty" : "result", {
      resultRef: `messages:${envelope.targetRef}:${messages.length}`,
      items: messages.map(messageQueryItem),
    });
  }

  private async getMessageStatus(
    envelope: ApplicationQueryEnvelope,
  ): Promise<ApplicationQueryOutcome> {
    const repository = this.repositories.messageRepository;

    if (repository === undefined) {
      return queryOutcome(envelope, this.clock, "unavailable", {
        reasonCode: "message_repository_not_configured",
      });
    }

    if (envelope.targetRef === undefined) {
      return queryOutcome(envelope, this.clock, "empty", {
        reasonCode: "message_target_required",
      });
    }

    const message = await repository.load(createMessageId(envelope.targetRef));

    if (message === undefined) {
      return queryOutcome(envelope, this.clock, "empty", {
        resultRef: `message:${envelope.targetRef}:empty`,
      });
    }

    return queryOutcome(envelope, this.clock, "result", {
      resultRef: `message:${message.id}:${message.status}`,
      resource: messageQueryItem(message),
    });
  }

  private async listChats(envelope: ApplicationQueryEnvelope): Promise<ApplicationQueryOutcome> {
    const repository = this.repositories.chatRepository;

    if (repository === undefined) {
      return queryOutcome(envelope, this.clock, "unavailable", {
        reasonCode: "chat_repository_not_configured",
      });
    }

    const chats = (await Promise.all(chatStatuses.map((status) => repository.findByStatus(status))))
      .flat()
      .filter((chat) => chat.status !== "deleted");

    return queryOutcome(envelope, this.clock, chats.length === 0 ? "empty" : "result", {
      resultRef: `chats:list:${chats.length}`,
      items: chats.map(chatQueryItem),
    });
  }

  private async listInstanceChats(
    envelope: ApplicationQueryEnvelope,
  ): Promise<ApplicationQueryOutcome> {
    const repository = this.repositories.chatRepository;

    if (repository === undefined) {
      return queryOutcome(envelope, this.clock, "unavailable", {
        reasonCode: "chat_repository_not_configured",
      });
    }

    if (envelope.targetRef === undefined) {
      return queryOutcome(envelope, this.clock, "empty", {
        reasonCode: "instance_target_required",
      });
    }

    const chats = (await repository.findByInstance(createInstanceId(envelope.targetRef))).filter(
      (chat) => chat.status !== "deleted",
    );

    return queryOutcome(envelope, this.clock, chats.length === 0 ? "empty" : "result", {
      resultRef: `chats:${envelope.targetRef}:list:${chats.length}`,
      items: chats.map(chatQueryItem),
    });
  }

  private async getChatStatus(
    envelope: ApplicationQueryEnvelope,
  ): Promise<ApplicationQueryOutcome> {
    const repository = this.repositories.chatRepository;

    if (repository === undefined) {
      return queryOutcome(envelope, this.clock, "unavailable", {
        reasonCode: "chat_repository_not_configured",
      });
    }

    if (envelope.targetRef === undefined) {
      return queryOutcome(envelope, this.clock, "empty", {
        reasonCode: "chat_target_required",
      });
    }

    const chat = await repository.load(createChatId(envelope.targetRef));

    if (chat === undefined || chat.status === "deleted") {
      return queryOutcome(envelope, this.clock, "empty", {
        resultRef: `chat:${envelope.targetRef}:empty`,
      });
    }

    return queryOutcome(envelope, this.clock, "result", {
      resultRef: `chat:${chat.id}:${chat.status}`,
      resource: chatQueryItem(chat),
    });
  }

  private async listContacts(envelope: ApplicationQueryEnvelope): Promise<ApplicationQueryOutcome> {
    const repository = this.repositories.contactRepository;

    if (repository === undefined) {
      return queryOutcome(envelope, this.clock, "unavailable", {
        reasonCode: "contact_repository_not_configured",
      });
    }

    const contacts = (
      await Promise.all(contactStatuses.map((status) => repository.findByStatus(status)))
    )
      .flat()
      .filter((contact) => contact.status !== "deleted");

    return queryOutcome(envelope, this.clock, contacts.length === 0 ? "empty" : "result", {
      resultRef: `contacts:list:${contacts.length}`,
      items: contacts.map(contactQueryItem),
    });
  }

  private async listInstanceContacts(
    envelope: ApplicationQueryEnvelope,
  ): Promise<ApplicationQueryOutcome> {
    const repository = this.repositories.contactRepository;

    if (repository === undefined) {
      return queryOutcome(envelope, this.clock, "unavailable", {
        reasonCode: "contact_repository_not_configured",
      });
    }

    if (envelope.targetRef === undefined) {
      return queryOutcome(envelope, this.clock, "empty", {
        reasonCode: "instance_target_required",
      });
    }

    const contacts = (await repository.findByInstance(createInstanceId(envelope.targetRef))).filter(
      (contact) => contact.status !== "deleted",
    );

    return queryOutcome(envelope, this.clock, contacts.length === 0 ? "empty" : "result", {
      resultRef: `contacts:${envelope.targetRef}:list:${contacts.length}`,
      items: contacts.map(contactQueryItem),
    });
  }

  private async getContactStatus(
    envelope: ApplicationQueryEnvelope,
  ): Promise<ApplicationQueryOutcome> {
    const repository = this.repositories.contactRepository;

    if (repository === undefined) {
      return queryOutcome(envelope, this.clock, "unavailable", {
        reasonCode: "contact_repository_not_configured",
      });
    }

    if (envelope.targetRef === undefined) {
      return queryOutcome(envelope, this.clock, "empty", {
        reasonCode: "contact_target_required",
      });
    }

    const contact = await repository.load(createContactId(envelope.targetRef));

    if (contact === undefined || contact.status === "deleted") {
      return queryOutcome(envelope, this.clock, "empty", {
        resultRef: `contact:${envelope.targetRef}:empty`,
      });
    }

    return queryOutcome(envelope, this.clock, "result", {
      resultRef: `contact:${contact.id}:${contact.status}`,
      resource: contactQueryItem(contact),
    });
  }

  private async listInstanceGroups(
    envelope: ApplicationQueryEnvelope,
  ): Promise<ApplicationQueryOutcome> {
    const repository = this.repositories.groupRepository;

    if (repository === undefined) {
      return queryOutcome(envelope, this.clock, "unavailable", {
        reasonCode: "group_repository_not_configured",
      });
    }

    if (envelope.targetRef === undefined) {
      return queryOutcome(envelope, this.clock, "empty", {
        reasonCode: "instance_target_required",
      });
    }

    const groups = (await repository.findByInstance(createInstanceId(envelope.targetRef))).filter(
      (group) => group.status !== "deleted",
    );

    return queryOutcome(envelope, this.clock, groups.length === 0 ? "empty" : "result", {
      resultRef: `groups:${envelope.targetRef}:list:${groups.length}`,
      items: groups.map(groupQueryItem),
    });
  }

  private async getGroupStatus(
    envelope: ApplicationQueryEnvelope,
  ): Promise<ApplicationQueryOutcome> {
    const repository = this.repositories.groupRepository;

    if (repository === undefined) {
      return queryOutcome(envelope, this.clock, "unavailable", {
        reasonCode: "group_repository_not_configured",
      });
    }

    if (envelope.targetRef === undefined) {
      return queryOutcome(envelope, this.clock, "empty", {
        reasonCode: "group_target_required",
      });
    }

    const group = await repository.load(createGroupId(envelope.targetRef));

    if (group === undefined || group.status === "deleted") {
      return queryOutcome(envelope, this.clock, "empty", {
        resultRef: `group:${envelope.targetRef}:empty`,
      });
    }

    return queryOutcome(envelope, this.clock, "result", {
      resultRef: `group:${group.id}:${group.status}`,
      resource: groupQueryItem(group),
    });
  }

  private async listGroupMembers(
    envelope: ApplicationQueryEnvelope,
  ): Promise<ApplicationQueryOutcome> {
    const repository = this.repositories.groupRepository;

    if (repository === undefined) {
      return queryOutcome(envelope, this.clock, "unavailable", {
        reasonCode: "group_repository_not_configured",
      });
    }

    if (envelope.targetRef === undefined) {
      return queryOutcome(envelope, this.clock, "empty", {
        reasonCode: "group_target_required",
      });
    }

    const group = await repository.load(createGroupId(envelope.targetRef));

    if (group === undefined || group.status === "deleted") {
      return queryOutcome(envelope, this.clock, "empty", {
        resultRef: `group-members:${envelope.targetRef}:empty`,
      });
    }

    return queryOutcome(envelope, this.clock, group.members.length === 0 ? "empty" : "result", {
      resultRef: `group-members:${group.id}:list:${group.members.length}`,
      items: group.members.map((member, index) => groupMemberQueryItem(group, member, index)),
    });
  }

  private async getHealthStatus(
    envelope: ApplicationQueryEnvelope,
  ): Promise<ApplicationQueryOutcome> {
    const repository = this.repositories.healthStatusRepository;

    if (repository === undefined) {
      return queryOutcome(envelope, this.clock, "unavailable", {
        reasonCode: "health_repository_not_configured",
      });
    }

    const subjectRef = envelope.targetRef ?? this.healthSubjectRef;
    const health = await repository.findBySubject(subjectRef);

    if (health === undefined) {
      return queryOutcome(envelope, this.clock, "empty", {
        resultRef: `health:${subjectRef}:empty`,
      });
    }

    return queryOutcome(envelope, this.clock, "result", {
      resultRef: `health:${health.id}:${health.category}`,
    });
  }

  private async listEvents(envelope: ApplicationQueryEnvelope): Promise<ApplicationQueryOutcome> {
    if (this.eventLog === undefined) {
      return queryOutcome(envelope, this.clock, "unavailable", {
        reasonCode: "event_log_not_configured",
      });
    }

    const replay = this.eventLog.replayEvents({ limit: 1_000 });

    if (!replay.ok) {
      return queryOutcome(envelope, this.clock, "unavailable", {
        reasonCode: replay.error.code,
      });
    }

    return queryOutcome(
      envelope,
      this.clock,
      replay.value.events.length === 0 ? "empty" : "result",
      {
        resultRef: `events:list:${replay.value.events.length}`,
        items: replay.value.events.map(eventQueryItem),
      },
    );
  }

  private async listWorkerJobs(
    envelope: ApplicationQueryEnvelope,
  ): Promise<ApplicationQueryOutcome> {
    const repository = this.repositories.workerJobRepository;

    if (repository === undefined) {
      return queryOutcome(envelope, this.clock, "unavailable", {
        reasonCode: "worker_job_repository_not_configured",
      });
    }

    const jobs = (
      await Promise.all(jobStatuses.map((status) => repository.findByStatus(status)))
    ).flat();

    return queryOutcome(envelope, this.clock, jobs.length === 0 ? "empty" : "result", {
      resultRef: `jobs:list:${jobs.length}`,
      items: jobs.map(workerJobQueryItem),
    });
  }

  private async getWorkerJobStatus(
    envelope: ApplicationQueryEnvelope,
  ): Promise<ApplicationQueryOutcome> {
    const repository = this.repositories.workerJobRepository;

    if (repository === undefined) {
      return queryOutcome(envelope, this.clock, "unavailable", {
        reasonCode: "worker_job_repository_not_configured",
      });
    }

    if (envelope.targetRef === undefined) {
      return queryOutcome(envelope, this.clock, "empty", {
        reasonCode: "worker_job_target_required",
      });
    }

    const job = await repository.load(createJobId(envelope.targetRef));

    if (job === undefined) {
      return queryOutcome(envelope, this.clock, "empty", {
        resultRef: `job:${envelope.targetRef}:empty`,
      });
    }

    return queryOutcome(envelope, this.clock, "result", {
      resultRef: `job:${job.id}:${job.status}`,
      resource: workerJobQueryItem(job),
    });
  }

  private async getQueueMetricsSnapshot(
    envelope: ApplicationQueryEnvelope,
  ): Promise<ApplicationQueryOutcome> {
    const repository = this.repositories.workerJobRepository;

    if (repository === undefined) {
      return queryOutcome(envelope, this.clock, "unavailable", {
        reasonCode: "worker_job_repository_not_configured",
      });
    }

    const jobsByStatus = await Promise.all(
      jobStatuses.map(async (status) => [status, await repository.findByStatus(status)] as const),
    );
    const counts = Object.fromEntries(
      jobsByStatus.map(([status, jobs]) => [status, jobs.length]),
    ) as Record<WorkerJob["status"], number>;
    const activeJobCount = counts.queued + counts.reserved + counts.running + counts.retrying;
    const totalJobCount = jobStatuses.reduce((total, status) => total + counts[status], 0);
    const status = counts.dead > 0 ? "degraded" : activeJobCount > 0 ? "active" : "empty";

    return queryOutcome(envelope, this.clock, "result", {
      resultRef: `queue:${status}:${totalJobCount}`,
      resource: Object.freeze({
        id: "queue",
        status,
        totalJobCount,
        queuedJobCount: counts.queued,
        reservedJobCount: counts.reserved,
        runningJobCount: counts.running,
        retryingJobCount: counts.retrying,
        completedJobCount: counts.completed,
        deadJobCount: counts.dead,
        activeJobCount,
      }),
    });
  }

  private async listWebhookSubscriptions(
    envelope: ApplicationQueryEnvelope,
  ): Promise<ApplicationQueryOutcome> {
    const repository = this.repositories.webhookSubscriptionRepository;

    if (repository === undefined) {
      return queryOutcome(envelope, this.clock, "unavailable", {
        reasonCode: "webhook_subscription_repository_not_configured",
      });
    }

    const webhooks = (
      await Promise.all(
        webhookSubscriptionStatuses.map((status) => repository.findByStatus(status)),
      )
    ).flat();

    return queryOutcome(envelope, this.clock, webhooks.length === 0 ? "empty" : "result", {
      resultRef: `webhooks:list:${webhooks.length}`,
      items: webhooks.map(webhookSubscriptionQueryItem),
    });
  }

  private async getWebhookStatus(
    envelope: ApplicationQueryEnvelope,
  ): Promise<ApplicationQueryOutcome> {
    const repository = this.repositories.webhookSubscriptionRepository;

    if (repository === undefined) {
      return queryOutcome(envelope, this.clock, "unavailable", {
        reasonCode: "webhook_subscription_repository_not_configured",
      });
    }

    if (envelope.targetRef === undefined) {
      return queryOutcome(envelope, this.clock, "empty", {
        reasonCode: "webhook_target_required",
      });
    }

    const webhook = await repository.load(createWebhookId(envelope.targetRef));

    if (webhook === undefined) {
      return queryOutcome(envelope, this.clock, "empty", {
        resultRef: `webhook:${envelope.targetRef}:empty`,
      });
    }

    return queryOutcome(envelope, this.clock, "result", {
      resultRef: `webhook:${webhook.id}:${webhook.status}`,
      resource: webhookSubscriptionQueryItem(webhook),
    });
  }

  private async listWebhookDeliveries(
    envelope: ApplicationQueryEnvelope,
  ): Promise<ApplicationQueryOutcome> {
    const repository = this.repositories.webhookDeliveryRepository;

    if (repository === undefined) {
      return queryOutcome(envelope, this.clock, "unavailable", {
        reasonCode: "webhook_delivery_repository_not_configured",
      });
    }

    const deliveries = (
      await Promise.all(webhookDeliveryStatuses.map((status) => repository.findByStatus(status)))
    ).flat();

    return queryOutcome(envelope, this.clock, deliveries.length === 0 ? "empty" : "result", {
      resultRef: `webhook-deliveries:list:${deliveries.length}`,
      items: deliveries.map(webhookDeliveryQueryItem),
    });
  }

  private async getWebhookDeliveryHistory(
    envelope: ApplicationQueryEnvelope,
  ): Promise<ApplicationQueryOutcome> {
    const repository = this.repositories.webhookDeliveryRepository;

    if (repository === undefined) {
      return queryOutcome(envelope, this.clock, "unavailable", {
        reasonCode: "webhook_delivery_repository_not_configured",
      });
    }

    if (envelope.targetRef === undefined) {
      return queryOutcome(envelope, this.clock, "empty", {
        reasonCode: "webhook_delivery_target_required",
      });
    }

    const delivery = await repository.load(createWebhookDeliveryId(envelope.targetRef));

    if (delivery === undefined) {
      return queryOutcome(envelope, this.clock, "empty", {
        resultRef: `webhook-delivery:${envelope.targetRef}:empty`,
      });
    }

    return queryOutcome(envelope, this.clock, "result", {
      resultRef: `webhook-delivery:${delivery.id}:${delivery.status}`,
      resource: webhookDeliveryQueryItem(delivery),
    });
  }
}

function commandOutcome(
  envelope: ApplicationCommandEnvelope,
  outcome: ApplicationCommandOutcome["outcome"],
  input: Readonly<{
    accepted: boolean;
    retryable: boolean;
    resultRef?: string;
    reasonCode?: string;
  }>,
): ApplicationCommandOutcome {
  return createApplicationCommandOutcome({
    commandRef: envelope.commandRef,
    outcome,
    accepted: input.accepted,
    retryable: input.retryable,
    ...optional("resultRef", input.resultRef),
    ...optional("reasonCode", input.reasonCode),
  });
}

function queryOutcome(
  envelope: ApplicationQueryEnvelope,
  clock: Clock,
  outcome: ApplicationQueryOutcome["outcome"],
  input: Readonly<{
    resultRef?: string;
    reasonCode?: string;
    resource?: Readonly<Record<string, unknown>>;
    items?: readonly unknown[];
  }> = {},
): ApplicationQueryOutcome {
  return createApplicationQueryOutcome({
    queryRef: envelope.queryRef,
    outcome,
    consistency:
      envelope.requestedConsistency ?? getApplicationQueryDefinition(envelope.name).consistency,
    freshness: {
      stale: false,
      refreshedAtEpochMilliseconds: clock.epochMilliseconds(),
    },
    ...optional("resultRef", input.resultRef),
    ...optional("reasonCode", input.reasonCode),
    ...optional("resource", input.resource),
    ...optional("items", input.items),
  });
}

function instanceQueryItem(instance: Instance): Readonly<{
  id: string;
  status: Instance["status"];
}> {
  return Object.freeze({
    id: String(instance.id),
    status: instance.status,
  });
}

function sessionQueryItem(session: Session): Readonly<{
  id: string;
  instanceId: string;
  status: Session["status"];
}> {
  return Object.freeze({
    id: String(session.id),
    instanceId: String(session.instanceId),
    status: session.status,
  });
}

function messageQueryItem(message: Message): Readonly<{
  id: string;
  instanceId: string;
  direction: Message["direction"];
  type: Message["type"];
  status: Message["status"];
}> {
  return Object.freeze({
    id: String(message.id),
    instanceId: String(message.instanceId),
    direction: message.direction,
    type: message.type,
    status: message.status,
  });
}

function chatQueryItem(chat: Chat): Readonly<{
  id: string;
  instanceId: string;
  status: Chat["status"];
  type: Chat["kind"];
  unreadCount: number;
  labelIds: readonly string[];
  muted: boolean;
  pinned: boolean;
}> {
  return Object.freeze({
    id: String(chat.id),
    instanceId: String(chat.instanceId),
    status: chat.status,
    type: chat.kind,
    unreadCount: chat.unreadCount,
    labelIds: Object.freeze(chat.labelIds.map(String)),
    muted: chat.muted,
    pinned: chat.pinned,
  });
}

function contactQueryItem(contact: Contact): Readonly<{
  id: string;
  instanceId: string;
  status: Contact["status"];
  displayName?: string;
}> {
  return Object.freeze({
    id: String(contact.id),
    instanceId: String(contact.instanceId),
    status: contact.status,
    ...optional(
      "displayName",
      contact.displayName === undefined ? undefined : String(contact.displayName),
    ),
  });
}

function groupQueryItem(group: Group): Readonly<{
  id: string;
  instanceId: string;
  status: Group["status"];
  subject: string;
  description?: string;
  memberCount: number;
  adminCount: number;
  muted: boolean;
  archived: boolean;
  pinned: boolean;
}> {
  return Object.freeze({
    id: String(group.id),
    instanceId: String(group.instanceId),
    status: group.status,
    subject: group.metadata.subject,
    ...optional("description", group.metadata.description),
    memberCount: group.members.length,
    adminCount: group.members.filter((member) => ["admin", "owner"].includes(member.role)).length,
    muted: group.muted,
    archived: group.archived,
    pinned: group.pinned,
  });
}

function groupMemberQueryItem(
  group: Group,
  member: GroupMember,
  index: number,
): Readonly<{
  id: string;
  groupId: string;
  memberRef: string;
  role: GroupMember["role"];
  status: "active";
  joinedAt?: string;
}> {
  const memberRef = `${String(group.id)}:member:${index + 1}`;

  return Object.freeze({
    id: memberRef,
    groupId: String(group.id),
    memberRef,
    role: member.role,
    status: "active",
    ...optional(
      "joinedAt",
      member.joinedAtEpochMilliseconds === undefined
        ? undefined
        : new Date(member.joinedAtEpochMilliseconds).toISOString(),
    ),
  });
}

function eventQueryItem(event: PlatformEventRecord): Readonly<{
  id: string;
  type: string;
  source: string;
  timestamp: string;
  resourceRef?: string;
  correlationId?: string;
}> {
  return Object.freeze({
    id: event.id,
    type: event.type,
    source: event.source,
    timestamp: event.timestamp,
    ...optional("resourceRef", event.resourceRef),
    ...optional("correlationId", event.correlationId),
  });
}

function workerJobQueryItem(job: WorkerJob): Readonly<{
  id: string;
  status: WorkerJob["status"];
  workType: string;
  ownerContext: string;
  attemptCount?: number;
  resourceRef?: string;
}> {
  return Object.freeze({
    id: String(job.id),
    status: job.status,
    workType: job.workType,
    ownerContext: job.ownerContext,
    ...optional("attemptCount", job.attemptNumber),
    ...optional("resourceRef", job.safeMetadata?.messageId ?? job.safeMetadata?.instanceId),
  });
}

function webhookSubscriptionQueryItem(webhook: WebhookSubscription): Readonly<{
  id: string;
  status: WebhookSubscription["status"];
}> {
  return Object.freeze({
    id: String(webhook.id),
    status: webhook.status,
  });
}

function webhookDeliveryQueryItem(delivery: WebhookDelivery): Readonly<{
  id: string;
  webhookId: string;
  status: WebhookDelivery["status"];
  eventType: string;
  attemptCount?: number;
  failureCategory?: string;
  reasonCode?: string;
}> {
  return Object.freeze({
    id: String(delivery.id),
    webhookId: String(delivery.webhookId),
    status: delivery.status,
    eventType: delivery.sourceSignalRef,
    ...optional("attemptCount", delivery.attemptNumber),
    ...optional("failureCategory", delivery.failureCategory),
    ...optional("reasonCode", delivery.deadLetterReason?.code),
  });
}

function optional<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Record<TKey, TValue>);
}
