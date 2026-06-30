import type { DomainOwnerContext, JobId, RetryPolicy } from "@omniwa/domain";

import type { ApplicationPortContext, ApplicationPortResult } from "./application-port.js";

export const queueWorkTypes = [
  "outbound_message",
  "media_processing",
  "webhook_delivery",
  "reconnect",
  "retention_cleanup",
  "health_refresh",
] as const;

export type QueueWorkType = (typeof queueWorkTypes)[number];

export type QueueWorkRequest = Readonly<{
  jobId: JobId;
  ownerContext: DomainOwnerContext;
  ownerRef: string;
  workType: QueueWorkType;
  retryPolicy: RetryPolicy;
  idempotencyKey: string;
}>;

export type QueueReservation = Readonly<{
  jobId: JobId;
  reservationRef: string;
  attempt: number;
}>;

export type QueueVisibilityReceipt = Readonly<{
  jobId: JobId;
  visible: boolean;
  queueRef: string;
}>;

export interface QueueProviderPort {
  enqueue(
    work: QueueWorkRequest,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<QueueVisibilityReceipt>>;

  reserve(
    workType: QueueWorkType,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<QueueReservation | undefined>>;

  acknowledge(
    reservation: QueueReservation,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<QueueVisibilityReceipt>>;

  releaseForRetry(
    reservation: QueueReservation,
    delayMilliseconds: number,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<QueueVisibilityReceipt>>;

  moveToDeadLetter(
    reservation: QueueReservation,
    reasonCode: string,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<QueueVisibilityReceipt>>;
}
