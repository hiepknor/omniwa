import { createDomainIdentity, type DomainIdentity } from "./domain-identity.js";

export type InstanceId = DomainIdentity<"InstanceId">;
export type SessionId = DomainIdentity<"SessionId">;
export type MessageId = DomainIdentity<"MessageId">;
export type MediaId = DomainIdentity<"MediaId">;
export type ChatId = DomainIdentity<"ChatId">;
export type ContactId = DomainIdentity<"ContactId">;
export type LabelId = DomainIdentity<"LabelId">;
export type GroupId = DomainIdentity<"GroupId">;
export type GroupActionId = DomainIdentity<"GroupActionId">;
export type InviteLinkId = DomainIdentity<"InviteLinkId">;
export type WebhookId = DomainIdentity<"WebhookId">;
export type WebhookDeliveryId = DomainIdentity<"WebhookDeliveryId">;
export type GuardrailDecisionId = DomainIdentity<"GuardrailDecisionId">;
export type ProviderId = DomainIdentity<"ProviderId">;
export type JobId = DomainIdentity<"JobId">;
export type AccessDecisionId = DomainIdentity<"AccessDecisionId">;
export type AuditRecordId = DomainIdentity<"AuditRecordId">;
export type HealthStatusId = DomainIdentity<"HealthStatusId">;
export type ConfigurationSnapshotId = DomainIdentity<"ConfigurationSnapshotId">;
export type TelemetrySignalId = DomainIdentity<"TelemetrySignalId">;

export const createInstanceId = (value: string): InstanceId =>
  createDomainIdentity(value, "InstanceId");

export const createSessionId = (value: string): SessionId =>
  createDomainIdentity(value, "SessionId");

export const createMessageId = (value: string): MessageId =>
  createDomainIdentity(value, "MessageId");

export const createMediaId = (value: string): MediaId => createDomainIdentity(value, "MediaId");

export const createChatId = (value: string): ChatId => createDomainIdentity(value, "ChatId");

export const createContactId = (value: string): ContactId =>
  createDomainIdentity(value, "ContactId");

export const createLabelId = (value: string): LabelId => createDomainIdentity(value, "LabelId");

export const createGroupId = (value: string): GroupId => createDomainIdentity(value, "GroupId");

export const createGroupActionId = (value: string): GroupActionId =>
  createDomainIdentity(value, "GroupActionId");

export const createInviteLinkId = (value: string): InviteLinkId =>
  createDomainIdentity(value, "InviteLinkId");

export const createWebhookId = (value: string): WebhookId =>
  createDomainIdentity(value, "WebhookId");

export const createWebhookDeliveryId = (value: string): WebhookDeliveryId =>
  createDomainIdentity(value, "WebhookDeliveryId");

export const createGuardrailDecisionId = (value: string): GuardrailDecisionId =>
  createDomainIdentity(value, "GuardrailDecisionId");

export const createProviderId = (value: string): ProviderId =>
  createDomainIdentity(value, "ProviderId");

export const createJobId = (value: string): JobId => createDomainIdentity(value, "JobId");

export const createAccessDecisionId = (value: string): AccessDecisionId =>
  createDomainIdentity(value, "AccessDecisionId");

export const createAuditRecordId = (value: string): AuditRecordId =>
  createDomainIdentity(value, "AuditRecordId");

export const createHealthStatusId = (value: string): HealthStatusId =>
  createDomainIdentity(value, "HealthStatusId");

export const createConfigurationSnapshotId = (value: string): ConfigurationSnapshotId =>
  createDomainIdentity(value, "ConfigurationSnapshotId");

export const createTelemetrySignalId = (value: string): TelemetrySignalId =>
  createDomainIdentity(value, "TelemetrySignalId");
