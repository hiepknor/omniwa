import {
  createApplicationPortFailure,
  type ApplicationPortContext,
  type ApplicationPortResult,
  type ProjectionWriterPort,
  type ReadModelPort,
  type ReadModelResult,
} from "@omniwa/application";
import { err, ok } from "@omniwa/shared";

import { DurableJsonStateStore } from "./durable-json-state-store.js";
import {
  getReadProjectionDefinition,
  type ProjectionReadQuery,
  type ProjectionWriteSignal,
  type ReadProjectionName,
  type StoredReadProjection,
} from "./read-projection-store.js";

type DurableReadProjectionState = Readonly<{
  projections: readonly StoredReadProjection[];
}>;

export class DurableJsonReadProjectionStore
  implements
    ReadModelPort<ProjectionReadQuery, unknown>,
    ProjectionWriterPort<ProjectionWriteSignal>
{
  private readonly store: DurableJsonStateStore<DurableReadProjectionState>;
  private readonly records = new Map<string, StoredReadProjection>();

  constructor(filePath: string) {
    this.store = new DurableJsonStateStore(filePath, () => ({ projections: [] }));

    for (const projection of this.store.read().projections) {
      this.records.set(
        projectionRecordKey(projection.projectionName, projection.projectionKey),
        projection,
      );
    }
  }

  project(
    signal: ProjectionWriteSignal,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<void>> {
    void context;

    const projectionKey = normalizeProjectionKey(signal.projectionKey);
    const definition = getReadProjectionDefinition(signal.projectionName);
    const storedProjection: StoredReadProjection = Object.freeze({
      projectionName: signal.projectionName,
      projectionKey,
      model: signal.model,
      consistency: signal.consistency ?? definition.consistency,
      freshness: Object.freeze({
        stale: signal.stale ?? false,
        ...(signal.refreshedAtEpochMilliseconds === undefined
          ? {}
          : { refreshedAtEpochMilliseconds: signal.refreshedAtEpochMilliseconds }),
      }),
      ...(signal.version === undefined ? {} : { version: signal.version }),
    });

    this.records.set(projectionRecordKey(signal.projectionName, projectionKey), storedProjection);
    this.persist();

    return Promise.resolve(ok(undefined));
  }

  read(
    query: ProjectionReadQuery,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<ReadModelResult<unknown>>> {
    void context;

    const projectionKey = normalizeProjectionKey(query.projectionKey);
    const storedProjection = this.records.get(
      projectionRecordKey(query.projectionName, projectionKey),
    );

    if (storedProjection === undefined) {
      return Promise.resolve(
        err(
          createApplicationPortFailure({
            category: "unavailable",
            code: "read_projection_not_found",
            message: "Read projection is unavailable.",
            retryable: true,
            ownerContext: getReadProjectionDefinition(query.projectionName).ownerContext,
            safeMetadata: {
              projectionName: query.projectionName,
              projectionKey,
            },
          }),
        ),
      );
    }

    return Promise.resolve(
      ok({
        model: storedProjection.model,
        consistency: storedProjection.consistency,
        freshness: storedProjection.freshness,
      }),
    );
  }

  readStoredProjection(query: ProjectionReadQuery): StoredReadProjection | undefined {
    return this.records.get(
      projectionRecordKey(query.projectionName, normalizeProjectionKey(query.projectionKey)),
    );
  }

  listStoredProjections(): readonly StoredReadProjection[] {
    return Object.freeze([...this.records.values()]);
  }

  listStoredProjectionsByName(projectionName: ReadProjectionName): readonly StoredReadProjection[] {
    return Object.freeze(
      [...this.records.values()].filter(
        (projection) => projection.projectionName === projectionName,
      ),
    );
  }

  clear(): void {
    this.records.clear();
    this.persist();
  }

  private persist(): void {
    this.store.write({
      projections: this.listStoredProjections(),
    });
  }
}

export function createDurableJsonReadProjectionStore(
  filePath: string,
): DurableJsonReadProjectionStore {
  return new DurableJsonReadProjectionStore(filePath);
}

function normalizeProjectionKey(projectionKey: string): string {
  const normalized = projectionKey.trim();

  if (normalized.length === 0) {
    throw new TypeError("Projection key must not be empty.");
  }

  return normalized;
}

function projectionRecordKey(projectionName: ReadProjectionName, projectionKey: string): string {
  return `${projectionName}:${projectionKey}`;
}
