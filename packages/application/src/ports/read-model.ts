import type { ApplicationPortContext, ApplicationPortResult } from "./application-port.js";

export const readConsistencyLevels = [
  "strong_owner",
  "eventual_projection",
  "stale_allowed",
  "retention_bound",
] as const;

export type ReadConsistencyLevel = (typeof readConsistencyLevels)[number];

export type ReadFreshness = Readonly<{
  stale: boolean;
  refreshedAtEpochMilliseconds?: number;
}>;

export type ReadModelResult<TReadModel> = Readonly<{
  model: TReadModel;
  consistency: ReadConsistencyLevel;
  freshness: ReadFreshness;
}>;

export interface ReadModelPort<TQuery, TReadModel> {
  read(
    query: TQuery,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<ReadModelResult<TReadModel>>>;
}

export interface ProjectionWriterPort<TSignal> {
  project(signal: TSignal, context: ApplicationPortContext): Promise<ApplicationPortResult<void>>;
}
