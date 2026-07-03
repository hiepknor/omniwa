import {
  createInstance,
  createInstanceId,
  type GuardrailDecisionRepositoryPort,
  type HealthStatusRepositoryPort,
  type Instance,
  type InstanceRepositoryPort,
  type MessageRepositoryPort,
  type Session,
  type SessionRepositoryPort,
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
import type { DomainEventPublisher } from "./domain-event-publisher.js";
import {
  createMinimalMessageGuardrailService,
  type MinimalMessageGuardrailService,
} from "./minimal-message-guardrail.js";
import { createProcessOutboundMessageWorkHandler } from "./handlers/process-outbound-message-work.handler.js";
import { createSendTextMessageHandler } from "./handlers/send-text-message.handler.js";

export type ApplicationDispatcherRepositories = Readonly<{
  instanceRepository: InstanceRepositoryPort;
  healthStatusRepository?: HealthStatusRepositoryPort;
  sessionRepository?: SessionRepositoryPort;
  messageRepository?: MessageRepositoryPort;
  guardrailDecisionRepository?: GuardrailDecisionRepositoryPort;
}>;

export type ApplicationDispatcherOptions = Readonly<{
  repositories: ApplicationDispatcherRepositories;
  uuidGenerator?: UUIDGenerator;
  clock?: Clock;
  healthSubjectRef?: string;
  activeSessionResolver?: ActiveSessionResolver;
  outboundMessageIntentStore?: OutboundMessageIntentStorePort;
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

    const processOutboundMessageWorkHandler = this.createProcessOutboundMessageWorkHandler();

    if (processOutboundMessageWorkHandler !== undefined) {
      handlers.set("ProcessOutboundMessageWork", processOutboundMessageWorkHandler);
    }

    return handlers;
  }

  private buildQueryHandlers(): QueryHandlerRegistry {
    return new Map<ApplicationQueryName, QueryHandler>([
      ["GetHealthStatus", (envelope) => this.getHealthStatus(envelope)],
      ["GetInstanceStatus", (envelope) => this.getInstanceStatus(envelope)],
      ["ListInstances", (envelope) => this.listInstances(envelope)],
      ["ListInstanceSessions", (envelope) => this.listInstanceSessions(envelope)],
      ["ListEvents", (envelope) => this.listEvents(envelope)],
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

    return queryOutcome(envelope, this.clock, replay.value.events.length === 0 ? "empty" : "result", {
      resultRef: `events:list:${replay.value.events.length}`,
      items: replay.value.events.map(eventQueryItem),
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

function optional<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Record<TKey, TValue>);
}
