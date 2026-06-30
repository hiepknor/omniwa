import type { DomainEvent, EventDataClassification, IntegrationEventName } from "@omniwa/domain";

import type { ApplicationPortContext, ApplicationPortResult } from "./application-port.js";

export const applicationNotificationNames = [
  "product_fact_published",
  "async_work_requested",
  "audit_evidence_requested",
  "health_refresh_requested",
  "telemetry_projection_requested",
  "webhook_delivery_requested",
] as const;

export type ApplicationNotificationName = (typeof applicationNotificationNames)[number];

export type ApplicationNotification = Readonly<{
  name: ApplicationNotificationName;
  sourceSignalRef: string;
  dataClassification: EventDataClassification;
  sourceDomainEvent?: DomainEvent;
  integrationEventName?: IntegrationEventName;
  targetContextRef?: string;
}>;

export type PublicationReceipt = Readonly<{
  publicationRef: string;
  accepted: boolean;
}>;

export interface EventBusPort {
  publishDomainFacts(
    events: readonly DomainEvent[],
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<PublicationReceipt>>;

  publishNotification(
    notification: ApplicationNotification,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<PublicationReceipt>>;
}
