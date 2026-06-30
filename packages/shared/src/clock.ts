import { createOpaqueString, type OpaqueString } from "./opaque.js";

export type IsoTimestamp = OpaqueString<"IsoTimestamp">;

export interface Clock {
  now(): Date;
  epochMilliseconds(): number;
  isoNow(): IsoTimestamp;
}

export function toIsoTimestamp(date: Date): IsoTimestamp {
  return createOpaqueString(date.toISOString(), "IsoTimestamp");
}

export const systemClock: Clock = {
  now: () => new Date(),
  epochMilliseconds: () => Date.now(),
  isoNow: () => toIsoTimestamp(new Date()),
};
