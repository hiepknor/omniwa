import { pathToFileURL } from "node:url";

import type { ApplicationPortContext, ApplicationPortResult } from "@omniwa/application";
import {
  createInMemoryReadProjectionStore,
  listReadProjectionDefinitions,
  type InMemoryReadProjectionStore,
  type ProjectionReadQuery,
  type ProjectionWriteSignal,
  type ReadProjectionDefinition,
  type ReadProjectionName,
  type StoredReadProjection,
} from "@omniwa/infrastructure-persistence";

export type ProjectionBuilderRuntime = Readonly<{
  store: InMemoryReadProjectionStore;
  definitions: readonly ReadProjectionDefinition[];
  project(
    signal: ProjectionWriteSignal,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<void>>;
  read(
    query: ProjectionReadQuery,
    context: ApplicationPortContext,
  ): ReturnType<InMemoryReadProjectionStore["read"]>;
  list(projectionName?: ReadProjectionName): readonly StoredReadProjection[];
}>;

export function createProjectionBuilderRuntime(
  store: InMemoryReadProjectionStore = createInMemoryReadProjectionStore(),
): ProjectionBuilderRuntime {
  return Object.freeze({
    store,
    definitions: listReadProjectionDefinitions(),
    project: (signal, context) => store.project(signal, context),
    read: (query, context) => store.read(query, context),
    list: (projectionName) =>
      projectionName === undefined
        ? store.listStoredProjections()
        : store.listStoredProjectionsByName(projectionName),
  });
}

export function summarizeProjectionBuilderRuntime(runtime: ProjectionBuilderRuntime): Readonly<{
  projectionCount: number;
  rebuildableCount: number;
  retentionBoundCount: number;
  storedProjectionCount: number;
}> {
  return Object.freeze({
    projectionCount: runtime.definitions.length,
    rebuildableCount: runtime.definitions.filter((definition) => definition.rebuildable).length,
    retentionBoundCount: runtime.definitions.filter((definition) => definition.retentionBound)
      .length,
    storedProjectionCount: runtime.list().length,
  });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const runtime = createProjectionBuilderRuntime();
  const summary = summarizeProjectionBuilderRuntime(runtime);

  console.log(
    JSON.stringify(
      {
        runtime: "projection-builder",
        status: "ready",
        ...summary,
      },
      null,
      2,
    ),
  );
}
