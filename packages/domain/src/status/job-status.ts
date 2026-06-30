import { createStringUnionValue } from "../common/string-union-value.js";

export const jobStatuses = [
  "queued",
  "reserved",
  "running",
  "completed",
  "retrying",
  "dead",
] as const;

export type JobStatus = (typeof jobStatuses)[number];

export function createJobStatus(value: string): JobStatus {
  return createStringUnionValue(value, jobStatuses, "JobStatus");
}
