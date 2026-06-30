import { createStringUnionValue } from "../common/string-union-value.js";

export const mediaAssetStatuses = [
  "received",
  "accepted",
  "processing",
  "processed",
  "attached",
  "failed",
  "cleaned",
] as const;

export type MediaAssetStatus = (typeof mediaAssetStatuses)[number];

export function createMediaAssetStatus(value: string): MediaAssetStatus {
  return createStringUnionValue(value, mediaAssetStatuses, "MediaAssetStatus");
}
