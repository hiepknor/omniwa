import {
  assertNotTerminal,
  transitionStatus,
  type StatusTransitionMap,
} from "../aggregates/status-transition.js";
import { appendDomainEvent, type DomainEvent } from "../events/domain-event.js";
import type { FailureCategory } from "../errors/failure-category.js";
import type { MediaId, MessageId } from "../identity/aggregate-ids.js";
import type { RetentionPolicy } from "../policies/retention-policy.js";
import type { MediaAssetStatus } from "../status/media-asset-status.js";
import type { MediaCategory } from "./media-category.js";

const mediaAssetTransitions: StatusTransitionMap<MediaAssetStatus> = {
  received: ["accepted", "failed", "cleaned"],
  accepted: ["processing", "failed", "cleaned"],
  processing: ["processed", "failed", "cleaned"],
  processed: ["attached", "failed", "cleaned"],
  attached: ["cleaned"],
  failed: ["cleaned"],
  cleaned: [],
};

export type MediaAsset = Readonly<{
  id: MediaId;
  category: MediaCategory;
  status: MediaAssetStatus;
  retentionPolicy: RetentionPolicy;
  messageId?: MessageId;
  failureCategory?: FailureCategory;
  diagnosticCaptureRequested: boolean;
  domainEvents: readonly DomainEvent[];
}>;

export function createMediaAsset(
  id: MediaId,
  category: MediaCategory,
  retentionPolicy: RetentionPolicy,
): MediaAsset {
  return freezeMediaAsset({
    id,
    category,
    status: "received",
    retentionPolicy,
    diagnosticCaptureRequested: false,
    domainEvents: [],
  });
}

export function acceptMediaAsset(media: MediaAsset): MediaAsset {
  return transitionMediaAsset(media, "accepted", "MediaAccepted");
}

export function markMediaProcessing(media: MediaAsset): MediaAsset {
  return transitionMediaAsset(media, "processing", "MediaProcessingStarted");
}

export function markMediaProcessed(media: MediaAsset): MediaAsset {
  return transitionMediaAsset(media, "processed", "MediaProcessed");
}

export function attachMediaAsset(media: MediaAsset, messageId: MessageId): MediaAsset {
  return transitionMediaAsset(media, "attached", "MediaAttached", { messageId });
}

export function failMediaAsset(media: MediaAsset, failureCategory: FailureCategory): MediaAsset {
  return transitionMediaAsset(media, "failed", "MediaFailed", { failureCategory });
}

export function cleanMediaAsset(media: MediaAsset): MediaAsset {
  return transitionMediaAsset(media, "cleaned", "MediaCleaned");
}

export function requestDiagnosticCapture(media: MediaAsset): MediaAsset {
  assertNotTerminal(media.status, ["cleaned"], "MediaAsset");

  return freezeMediaAsset({
    ...media,
    diagnosticCaptureRequested: true,
    domainEvents: appendDomainEvent(
      media.domainEvents,
      "MediaAsset",
      media.id,
      "DiagnosticCaptureRequested",
    ),
  });
}

function transitionMediaAsset(
  media: MediaAsset,
  status: MediaAssetStatus,
  eventName: Parameters<typeof appendDomainEvent>[3],
  patch: Readonly<{
    messageId?: MessageId;
    failureCategory?: FailureCategory;
  }> = {},
): MediaAsset {
  return freezeMediaAsset({
    id: media.id,
    category: media.category,
    status: transitionStatus(media.status, status, mediaAssetTransitions, "MediaAsset"),
    retentionPolicy: media.retentionPolicy,
    diagnosticCaptureRequested: media.diagnosticCaptureRequested,
    ...optionalValue("messageId", patch.messageId, media.messageId),
    ...optionalValue("failureCategory", patch.failureCategory, media.failureCategory),
    domainEvents: appendDomainEvent(media.domainEvents, "MediaAsset", media.id, eventName),
  });
}

function optionalValue<TKey extends string, TValue>(
  key: TKey,
  nextValue: TValue | undefined,
  currentValue: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  const value = nextValue ?? currentValue;
  return value === undefined ? {} : ({ [key]: value } as Partial<Record<TKey, TValue>>);
}

function freezeMediaAsset(media: MediaAsset): MediaAsset {
  return Object.freeze(media);
}
