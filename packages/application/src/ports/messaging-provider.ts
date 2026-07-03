import type {
  EventDataClassification,
  FailureCategory,
  InstanceId,
  MediaId,
  MessageId,
  MessageType,
  ProviderId,
  SessionId,
} from "@omniwa/domain";

import type { ApplicationPortContext, ApplicationPortResult } from "./application-port.js";

export const providerConnectionIntents = [
  "connect",
  "reconnect",
  "disconnect",
  "qr_pairing",
] as const;

export type ProviderConnectionIntent = (typeof providerConnectionIntents)[number];

export const providerConnectionStates = [
  "connecting",
  "qr_required",
  "connected",
  "disconnected",
  "logged_out",
  "action_required",
] as const;

export type ProviderConnectionState = (typeof providerConnectionStates)[number];

export type ProviderConnectionRequest = Readonly<{
  instanceId: InstanceId;
  providerId: ProviderId;
  sessionId?: SessionId;
  intent: ProviderConnectionIntent;
  reasonCode: string;
}>;

export type ProviderConnectionResult = Readonly<{
  instanceId: InstanceId;
  providerId: ProviderId;
  state: ProviderConnectionState;
  providerSignalRef?: string;
  failureCategory?: FailureCategory;
}>;

export type ProviderQrPairingRequest = Readonly<{
  instanceId: InstanceId;
  providerId: ProviderId;
  sessionId: SessionId;
  pairingAttemptRef: string;
}>;

export type ProviderQrPairingChallenge = Readonly<{
  instanceId: InstanceId;
  sessionId: SessionId;
  challengeRef: string;
  expiresAtEpochMilliseconds?: number;
  dataClassification: "secret";
}>;

export type ProviderOutboundMessageRequest = Readonly<{
  instanceId: InstanceId;
  providerId: ProviderId;
  sessionId: SessionId;
  messageId: MessageId;
  messageType: MessageType;
  outboundIntentRef: string;
  mediaId?: MediaId;
  idempotencyKey: string;
}>;

export type ProviderSendStatus = "accepted" | "rejected" | "unknown";

export type ProviderOutboundMessageResult = Readonly<{
  messageId: MessageId;
  status: ProviderSendStatus;
  providerReceiptRef?: string;
  retryable: boolean;
  failureCategory?: FailureCategory;
}>;

export type ProviderSignalSafeMetadataValue = string | number | boolean | null;

export type ProviderSignalSafeMetadata = Readonly<Record<string, ProviderSignalSafeMetadataValue>>;

export type TranslatedProviderSignal = Readonly<{
  signalRef: string;
  providerId: ProviderId;
  targetRef: string;
  occurrenceRef: string;
  kind: "connection" | "auth" | "message_status" | "inbound_message" | "failure";
  dataClassification: Exclude<EventDataClassification, "public">;
  failureCategory?: FailureCategory;
  safeMetadata?: ProviderSignalSafeMetadata;
}>;

export type ProviderCapabilitySummary = Readonly<{
  providerId: ProviderId;
  supportedMessageTypes: readonly MessageType[];
  degraded: boolean;
  failureCategory?: FailureCategory;
}>;

export interface MessagingProviderPort {
  requestConnection(
    request: ProviderConnectionRequest,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<ProviderConnectionResult>>;

  requestQrPairing(
    request: ProviderQrPairingRequest,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<ProviderQrPairingChallenge>>;

  disconnect(
    request: ProviderConnectionRequest,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<ProviderConnectionResult>>;

  sendOutboundMessage(
    request: ProviderOutboundMessageRequest,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<ProviderOutboundMessageResult>>;

  getCapabilitySummary(
    providerId: ProviderId,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<ProviderCapabilitySummary>>;
}
