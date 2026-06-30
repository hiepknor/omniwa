import type {
  EventDataClassification,
  WebhookDeliveryId,
  WebhookId,
  WebhookUrl,
} from "@omniwa/domain";

import type { ApplicationPortContext, ApplicationPortResult } from "./application-port.js";

export type WebhookDeliveryEnvelope = Readonly<{
  webhookId: WebhookId;
  deliveryId: WebhookDeliveryId;
  targetUrl: WebhookUrl;
  sourceSignalRef: string;
  payloadRef: string;
  eventVersion: "v1";
  dataClassification: Exclude<EventDataClassification, "public">;
  signingSecretRef?: string;
}>;

export type WebhookTransportOutcome = "delivered" | "retryable_failure" | "terminal_failure";

export type WebhookTransportReceipt = Readonly<{
  deliveryId: WebhookDeliveryId;
  outcome: WebhookTransportOutcome;
  receiverRef?: string;
  failureReasonCode?: string;
}>;

export interface WebhookTransportPort {
  deliver(
    envelope: WebhookDeliveryEnvelope,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<WebhookTransportReceipt>>;
}
