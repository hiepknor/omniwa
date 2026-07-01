import { createHmac, timingSafeEqual } from "node:crypto";

import {
  createSecretName,
  createSecretPurpose,
  type SecretProvider,
  type SecretValue,
} from "@omniwa/config";
import { createFailureCategory } from "@omniwa/domain";
import { systemClock, type Clock } from "@omniwa/shared";

import {
  WebhookTransportAdapterError,
  type WebhookOutboundBody,
  type WebhookSignatureInput,
  type WebhookSignatureProvider,
  type WebhookSignatureResult,
} from "./webhook-transport.adapter.js";

export const webhookSignatureScheme = "v1";
export const webhookSigningSecretPurpose = createSecretPurpose("webhook-delivery-signing");
export const defaultWebhookSignatureToleranceMilliseconds = 5 * 60 * 1000;

export type WebhookSignatureVerificationFailureReason =
  "invalid_timestamp" | "timestamp_out_of_tolerance" | "invalid_signature" | "replay_detected";

export type WebhookSignatureVerificationResult =
  | Readonly<{
      verified: true;
      replayKey: string;
    }>
  | Readonly<{
      verified: false;
      reasonCode: WebhookSignatureVerificationFailureReason;
    }>;

export type WebhookReplayProtectionStore = Readonly<{
  has(replayKey: string, nowEpochMilliseconds: number): boolean;
  remember(replayKey: string, expiresAtEpochMilliseconds: number): void;
}>;

export type WebhookSignatureVerificationInput = Readonly<{
  body: WebhookOutboundBody | string;
  timestamp: string;
  signature: string;
  secret: SecretValue;
  nowEpochMilliseconds?: number;
  toleranceMilliseconds?: number;
  replayStore?: WebhookReplayProtectionStore;
}>;

export type WebhookHmacSignatureProviderOptions = Readonly<{
  secretProvider: SecretProvider;
  clock?: Pick<Clock, "epochMilliseconds">;
}>;

export class WebhookHmacSignatureProvider implements WebhookSignatureProvider {
  private readonly secretProvider: SecretProvider;
  private readonly clock: Pick<Clock, "epochMilliseconds">;

  constructor(options: WebhookHmacSignatureProviderOptions) {
    this.secretProvider = options.secretProvider;
    this.clock = options.clock ?? systemClock;
  }

  async createSignature(input: WebhookSignatureInput): Promise<WebhookSignatureResult> {
    const secret = await this.secretProvider.readSecret({
      name: createSecretName(input.signingSecretRef),
      purpose: webhookSigningSecretPurpose,
    });

    if (!secret.ok) {
      throw new WebhookTransportAdapterError({
        category: "rejected",
        code: "webhook_signing_secret_unavailable",
        message: "Webhook signing secret is unavailable.",
        retryable: false,
        failureCategory: createFailureCategory("configuration"),
      });
    }

    const timestamp = String(this.clock.epochMilliseconds());

    return Object.freeze({
      scheme: webhookSignatureScheme,
      signature: signWebhookBody({
        body: input.body,
        timestamp,
        secret: secret.value,
      }),
      timestamp,
    });
  }
}

export class InMemoryWebhookReplayProtectionStore implements WebhookReplayProtectionStore {
  private readonly expirationsByReplayKey = new Map<string, number>();

  has(replayKey: string, nowEpochMilliseconds: number): boolean {
    this.removeExpired(nowEpochMilliseconds);
    return this.expirationsByReplayKey.has(replayKey);
  }

  remember(replayKey: string, expiresAtEpochMilliseconds: number): void {
    this.expirationsByReplayKey.set(replayKey, expiresAtEpochMilliseconds);
  }

  snapshot(): ReadonlyMap<string, number> {
    return new Map(this.expirationsByReplayKey);
  }

  private removeExpired(nowEpochMilliseconds: number): void {
    for (const [replayKey, expiresAtEpochMilliseconds] of this.expirationsByReplayKey) {
      if (expiresAtEpochMilliseconds <= nowEpochMilliseconds) {
        this.expirationsByReplayKey.delete(replayKey);
      }
    }
  }
}

export function signWebhookBody(
  input: Readonly<{
    body: WebhookOutboundBody | string;
    timestamp: string;
    secret: SecretValue;
  }>,
): string {
  const digest = createHmac("sha256", input.secret.revealForUse())
    .update(signaturePayload(input.timestamp, input.body))
    .digest("hex");

  return `${webhookSignatureScheme}=${digest}`;
}

export function verifyWebhookSignature(
  input: WebhookSignatureVerificationInput,
): WebhookSignatureVerificationResult {
  const timestamp = Number.parseInt(input.timestamp, 10);

  if (!Number.isSafeInteger(timestamp) || String(timestamp) !== input.timestamp) {
    return verificationFailure("invalid_timestamp");
  }

  const toleranceMilliseconds =
    input.toleranceMilliseconds ?? defaultWebhookSignatureToleranceMilliseconds;
  assertNonNegativeInteger(toleranceMilliseconds, "toleranceMilliseconds");

  const nowEpochMilliseconds = input.nowEpochMilliseconds ?? Date.now();

  if (Math.abs(nowEpochMilliseconds - timestamp) > toleranceMilliseconds) {
    return verificationFailure("timestamp_out_of_tolerance");
  }

  const expected = signWebhookBody({
    body: input.body,
    timestamp: input.timestamp,
    secret: input.secret,
  });

  if (!constantTimeStringEquals(expected, input.signature)) {
    return verificationFailure("invalid_signature");
  }

  const replayKey = `${input.timestamp}:${input.signature}`;

  if (input.replayStore?.has(replayKey, nowEpochMilliseconds) === true) {
    return verificationFailure("replay_detected");
  }

  input.replayStore?.remember(replayKey, timestamp + toleranceMilliseconds);

  return Object.freeze({
    verified: true,
    replayKey,
  });
}

export function canonicalWebhookBody(body: WebhookOutboundBody | string): string {
  return typeof body === "string" ? body : JSON.stringify(body);
}

function signaturePayload(timestamp: string, body: WebhookOutboundBody | string): string {
  return `${timestamp}.${canonicalWebhookBody(body)}`;
}

function constantTimeStringEquals(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected, "utf8");
  const actualBuffer = Buffer.from(actual, "utf8");

  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, actualBuffer);
}

function verificationFailure(
  reasonCode: WebhookSignatureVerificationFailureReason,
): WebhookSignatureVerificationResult {
  return Object.freeze({
    verified: false,
    reasonCode,
  });
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer.`);
  }
}
