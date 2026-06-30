import {
  type ApplicationPortContext,
  type ApplicationPortFailure,
  type QueueProviderPort,
  type QueueVisibilityReceipt,
  type QueueWorkRequest,
  type QueueWorkType,
} from "@omniwa/application";
import {
  createJobId,
  createRetryPolicy,
  type DomainOwnerContext,
  type RetryPolicy,
} from "@omniwa/domain";
import { cryptoUUIDGenerator, systemClock, type Clock, type UUIDGenerator } from "@omniwa/shared";

export type ScheduledWorkDefinition = Readonly<{
  id: string;
  name: string;
  ownerContext: DomainOwnerContext;
  ownerRef: string;
  workType: QueueWorkType;
  intervalMilliseconds: number;
  retryPolicy: RetryPolicy;
}>;

export type SchedulerCheckpointStore = {
  getLastDispatchedWindow(definitionId: string): number | undefined;
  recordDispatchedWindow(definitionId: string, windowStartEpochMilliseconds: number): void;
};

export type ScheduledWorkDispatch = Readonly<{
  definitionId: string;
  workType: QueueWorkType;
  ownerRef: string;
  idempotencyKey: string;
  windowStartEpochMilliseconds: number;
  receipt?: QueueVisibilityReceipt;
  failure?: ApplicationPortFailure;
}>;

export type SchedulerTickResult = Readonly<{
  tickEpochMilliseconds: number;
  dueCount: number;
  dispatched: readonly ScheduledWorkDispatch[];
}>;

export type SchedulerRuntimeOptions = Readonly<{
  queueProvider: QueueProviderPort;
  definitions?: readonly ScheduledWorkDefinition[];
  checkpointStore?: SchedulerCheckpointStore;
  clock?: Pick<Clock, "epochMilliseconds">;
  uuidGenerator?: UUIDGenerator;
}>;

export const defaultScheduledWorkDefinitions: readonly ScheduledWorkDefinition[] = Object.freeze([
  freezeDefinition({
    id: "SCH-INS-RECONNECT",
    name: "Recoverable Instance Reconnect Scan",
    ownerContext: "instance",
    ownerRef: "recoverable-instances",
    workType: "reconnect",
    intervalMilliseconds: 60_000,
    retryPolicy: createRetryPolicy({
      maxAttempts: 3,
      initialDelayMilliseconds: 5_000,
      backoffMultiplier: 2,
    }),
  }),
  freezeDefinition({
    id: "SCH-OPS-RETENTION-CLEANUP",
    name: "Retention Cleanup Scan",
    ownerContext: "operations",
    ownerRef: "retention-due",
    workType: "retention_cleanup",
    intervalMilliseconds: 15 * 60_000,
    retryPolicy: createRetryPolicy({
      maxAttempts: 2,
      initialDelayMilliseconds: 60_000,
      backoffMultiplier: 2,
    }),
  }),
  freezeDefinition({
    id: "SCH-HEALTH-REFRESH",
    name: "Health Refresh Scan",
    ownerContext: "health",
    ownerRef: "runtime-health",
    workType: "health_refresh",
    intervalMilliseconds: 30_000,
    retryPolicy: createRetryPolicy({
      maxAttempts: 2,
      initialDelayMilliseconds: 10_000,
      backoffMultiplier: 2,
    }),
  }),
]);

export class InMemorySchedulerCheckpointStore implements SchedulerCheckpointStore {
  private readonly windowsByDefinitionId = new Map<string, number>();

  getLastDispatchedWindow(definitionId: string): number | undefined {
    return this.windowsByDefinitionId.get(definitionId);
  }

  recordDispatchedWindow(definitionId: string, windowStartEpochMilliseconds: number): void {
    this.windowsByDefinitionId.set(definitionId, windowStartEpochMilliseconds);
  }

  snapshot(): Readonly<Record<string, number>> {
    return Object.freeze(Object.fromEntries(this.windowsByDefinitionId));
  }
}

export class SchedulerRuntime {
  private readonly queueProvider: QueueProviderPort;
  private readonly definitions: readonly ScheduledWorkDefinition[];
  private readonly checkpointStore: SchedulerCheckpointStore;
  private readonly clock: Pick<Clock, "epochMilliseconds">;
  private readonly uuidGenerator: UUIDGenerator;

  constructor(options: SchedulerRuntimeOptions) {
    this.queueProvider = options.queueProvider;
    this.definitions = Object.freeze([...(options.definitions ?? defaultScheduledWorkDefinitions)]);
    this.checkpointStore = options.checkpointStore ?? new InMemorySchedulerCheckpointStore();
    this.clock = options.clock ?? systemClock;
    this.uuidGenerator = options.uuidGenerator ?? cryptoUUIDGenerator;
  }

  async tick(context: ApplicationPortContext): Promise<SchedulerTickResult> {
    const tickEpochMilliseconds = this.clock.epochMilliseconds();
    const dueDefinitions = getDueScheduledWorkDefinitions(
      this.definitions,
      tickEpochMilliseconds,
      this.checkpointStore,
    );
    const dispatched: ScheduledWorkDispatch[] = [];

    for (const definition of dueDefinitions) {
      const windowStartEpochMilliseconds = getScheduleWindowStart(
        tickEpochMilliseconds,
        definition.intervalMilliseconds,
      );
      const work = createScheduledQueueWorkRequest(
        definition,
        windowStartEpochMilliseconds,
        this.uuidGenerator,
      );
      const result = await this.queueProvider.enqueue(work, context);

      if (result.ok) {
        this.checkpointStore.recordDispatchedWindow(definition.id, windowStartEpochMilliseconds);
        dispatched.push(
          freezeDispatch({
            definitionId: definition.id,
            workType: definition.workType,
            ownerRef: definition.ownerRef,
            idempotencyKey: work.idempotencyKey,
            windowStartEpochMilliseconds,
            receipt: result.value,
          }),
        );
        continue;
      }

      dispatched.push(
        freezeDispatch({
          definitionId: definition.id,
          workType: definition.workType,
          ownerRef: definition.ownerRef,
          idempotencyKey: work.idempotencyKey,
          windowStartEpochMilliseconds,
          failure: result.error,
        }),
      );
    }

    return Object.freeze({
      tickEpochMilliseconds,
      dueCount: dueDefinitions.length,
      dispatched: Object.freeze(dispatched),
    });
  }
}

export function getDueScheduledWorkDefinitions(
  definitions: readonly ScheduledWorkDefinition[],
  epochMilliseconds: number,
  checkpointStore: SchedulerCheckpointStore,
): readonly ScheduledWorkDefinition[] {
  return Object.freeze(
    definitions.filter((definition) => {
      const windowStart = getScheduleWindowStart(
        epochMilliseconds,
        definition.intervalMilliseconds,
      );
      return checkpointStore.getLastDispatchedWindow(definition.id) !== windowStart;
    }),
  );
}

export function createScheduledQueueWorkRequest(
  definition: ScheduledWorkDefinition,
  windowStartEpochMilliseconds: number,
  uuidGenerator: UUIDGenerator,
): QueueWorkRequest {
  assertNonNegativeInteger(windowStartEpochMilliseconds, "windowStartEpochMilliseconds");

  return Object.freeze({
    jobId: createJobId(`scheduler:${definition.id}:${uuidGenerator.random()}`),
    ownerContext: definition.ownerContext,
    ownerRef: definition.ownerRef,
    workType: definition.workType,
    retryPolicy: definition.retryPolicy,
    idempotencyKey: `scheduler:${definition.id}:${windowStartEpochMilliseconds}`,
  });
}

export function getScheduleWindowStart(
  epochMilliseconds: number,
  intervalMilliseconds: number,
): number {
  assertNonNegativeInteger(epochMilliseconds, "epochMilliseconds");
  assertPositiveInteger(intervalMilliseconds, "intervalMilliseconds");

  return Math.floor(epochMilliseconds / intervalMilliseconds) * intervalMilliseconds;
}

function freezeDefinition(definition: ScheduledWorkDefinition): ScheduledWorkDefinition {
  assertPositiveInteger(definition.intervalMilliseconds, "intervalMilliseconds");
  return Object.freeze(definition);
}

function freezeDispatch(dispatch: ScheduledWorkDispatch): ScheduledWorkDispatch {
  return Object.freeze(dispatch);
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer.`);
  }
}
