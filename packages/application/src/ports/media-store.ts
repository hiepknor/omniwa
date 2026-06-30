import type {
  EventDataClassification,
  MediaCategory,
  MediaId,
  RetentionPolicy,
} from "@omniwa/domain";

import type { ApplicationPortContext, ApplicationPortResult } from "./application-port.js";

export const mediaArtifactPurposes = ["message_attachment", "diagnostic_capture"] as const;

export type MediaArtifactPurpose = (typeof mediaArtifactPurposes)[number];

export type MediaArtifactDescriptor = Readonly<{
  mediaId: MediaId;
  category: MediaCategory;
  purpose: MediaArtifactPurpose;
  sourceContentRef: string;
  dataClassification: Exclude<EventDataClassification, "public">;
  retentionPolicy: RetentionPolicy;
}>;

export type MediaArtifactReceipt = Readonly<{
  mediaId: MediaId;
  artifactRef: string;
  retained: boolean;
}>;

export type MediaAccessReference = Readonly<{
  mediaId: MediaId;
  accessRef: string;
  expiresAtEpochMilliseconds?: number;
}>;

export interface MediaStorePort {
  registerArtifact(
    artifact: MediaArtifactDescriptor,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<MediaArtifactReceipt>>;

  createAccessReference(
    mediaId: MediaId,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<MediaAccessReference>>;

  removeArtifact(
    mediaId: MediaId,
    reasonCode: string,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<MediaArtifactReceipt>>;
}
