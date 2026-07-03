import {
  classifyHealthy,
  createInstanceId,
  createHealthStatus,
  createHealthStatusId,
  createSession,
  createSessionId,
  type HealthCategory,
  type HealthStatus,
  type HealthStatusId,
  type HealthStatusRepositoryPort,
  type Instance,
  type InstanceId,
  type InstanceRepositoryPort,
  type InstanceStatus,
  type RepositorySaveResult,
  type Session,
  type SessionId,
  type SessionRepositoryPort,
  type SessionStatus,
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
import type { ApplicationPortResult } from "../ports/application-port.js";
import type {
  EventLogReplayPort,
  EventLogReplayResult,
  PlatformEventRecord,
} from "../ports/event-log.js";
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
        name: "GetMessageStatus",
        queryRef: "qry-message-status",
        requestContext,
        actorRef: "api_key:test",
        targetRef: "msg_1",
      }),
    );

    expect(outcome).toEqual({
      kind: "query_outcome",
      queryRef: "qry-message-status",
      outcome: "unavailable",
      consistency: "strong_owner",
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
      this.list().filter((session) => session.instanceId === instanceId && session.status === status),
    );
  }

  findRecoveryRequired(): Promise<readonly Session[]> {
    return Promise.resolve(this.list().filter((session) => session.requiresRecovery));
  }

  private list(): readonly Session[] {
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
