import {
  createInstance,
  createInstanceId,
  type HealthStatusRepositoryPort,
  type InstanceRepositoryPort,
} from "@omniwa/domain";
import { cryptoUUIDGenerator, systemClock, type Clock, type UUIDGenerator } from "@omniwa/shared";

import {
  type ApplicationCommandEnvelope,
  type ApplicationCommandOutcome,
  createApplicationCommandOutcome,
} from "../commands/command-model.js";
import { getApplicationQueryDefinition } from "../queries/query-catalog.js";
import {
  type ApplicationQueryEnvelope,
  type ApplicationQueryOutcome,
  createApplicationQueryOutcome,
} from "../queries/query-model.js";

export type ApplicationDispatcherRepositories = Readonly<{
  instanceRepository: InstanceRepositoryPort;
  healthStatusRepository?: HealthStatusRepositoryPort;
}>;

export type ApplicationDispatcherOptions = Readonly<{
  repositories: ApplicationDispatcherRepositories;
  uuidGenerator?: UUIDGenerator;
  clock?: Clock;
  healthSubjectRef?: string;
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

  constructor(options: ApplicationDispatcherOptions) {
    this.repositories = options.repositories;
    this.uuidGenerator = options.uuidGenerator ?? cryptoUUIDGenerator;
    this.clock = options.clock ?? systemClock;
    this.healthSubjectRef = options.healthSubjectRef ?? "platform";
  }

  async executeCommand(envelope: ApplicationCommandEnvelope): Promise<ApplicationCommandOutcome> {
    try {
      switch (envelope.name) {
        case "CreateInstance":
          return this.createInstance(envelope);
        default:
          return commandOutcome(envelope, "failed", {
            accepted: false,
            retryable: false,
            reasonCode: "application_handler_not_implemented",
          });
      }
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
      switch (envelope.name) {
        case "GetHealthStatus":
          return this.getHealthStatus(envelope);
        case "ListInstances":
          return this.listInstances(envelope);
        default:
          return queryOutcome(envelope, this.clock, "unavailable", {
            reasonCode: "application_handler_not_implemented",
          });
      }
    } catch {
      return queryOutcome(envelope, this.clock, "unavailable", {
        reasonCode: "application_dependency_failure",
      });
    }
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

  private async listInstances(
    envelope: ApplicationQueryEnvelope,
  ): Promise<ApplicationQueryOutcome> {
    const instances = await this.repositories.instanceRepository.findNonTerminal();

    return queryOutcome(envelope, this.clock, instances.length === 0 ? "empty" : "result", {
      resultRef: `instances:list:${instances.length}`,
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
  });
}

function optional<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Record<TKey, TValue>);
}
