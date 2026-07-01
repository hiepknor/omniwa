import { SecretValue, type SecretDescriptor, type SecretProvider } from "@omniwa/config";
import { fail, type OmniwaError, succeed } from "@omniwa/errors";
import { type Result } from "@omniwa/shared";
import { describe, expect, it } from "vitest";

import {
  InMemoryWebhookReplayProtectionStore,
  WebhookHmacSignatureProvider,
  signWebhookBody,
  verifyWebhookSignature,
  webhookSigningSecretPurpose,
} from "./webhook-signing.js";
import type { WebhookOutboundBody } from "./webhook-transport.adapter.js";

const fixedBody: WebhookOutboundBody = {
  deliveryId: "webhook_delivery_signature_1",
  webhookId: "webhook_signature_1",
  sourceSignalRef: "message.delivered.v1",
  payloadRef: "payload.ref.signature.1",
  eventVersion: "v1",
  dataClassification: "internal",
  correlationId: "webhook-signature-correlation",
};

describe("webhook signing", () => {
  it("creates stable HMAC signatures for canonical webhook bodies", () => {
    const signature = signWebhookBody({
      body: fixedBody,
      timestamp: "1234567890000",
      secret: SecretValue.fromString("webhook-signing-test-secret"),
    });

    expect(signature).toBe("v1=1e9bab5fd8dbdb7b4a52024b6d5af393d8af3436f81db23079b74f67fb99a336");
  });

  it("verifies signatures and rejects replayed signatures inside the tolerance window", () => {
    const secret = SecretValue.fromString("webhook-signing-test-secret");
    const signature = signWebhookBody({
      body: fixedBody,
      timestamp: "1234567890000",
      secret,
    });
    const replayStore = new InMemoryWebhookReplayProtectionStore();

    const first = verifyWebhookSignature({
      body: fixedBody,
      timestamp: "1234567890000",
      signature,
      secret,
      nowEpochMilliseconds: 1234567890500,
      toleranceMilliseconds: 1_000,
      replayStore,
    });
    const replayed = verifyWebhookSignature({
      body: fixedBody,
      timestamp: "1234567890000",
      signature,
      secret,
      nowEpochMilliseconds: 1234567890600,
      toleranceMilliseconds: 1_000,
      replayStore,
    });

    expect(first).toMatchObject({ verified: true });
    expect(replayed).toEqual({
      verified: false,
      reasonCode: "replay_detected",
    });
  });

  it("rejects stale timestamps and modified bodies", () => {
    const secret = SecretValue.fromString("webhook-signing-test-secret");
    const signature = signWebhookBody({
      body: fixedBody,
      timestamp: "1234567890000",
      secret,
    });

    expect(
      verifyWebhookSignature({
        body: fixedBody,
        timestamp: "1234567890000",
        signature,
        secret,
        nowEpochMilliseconds: 1234567905000,
        toleranceMilliseconds: 1_000,
      }),
    ).toEqual({
      verified: false,
      reasonCode: "timestamp_out_of_tolerance",
    });
    expect(
      verifyWebhookSignature({
        body: { ...fixedBody, payloadRef: "payload.ref.modified" },
        timestamp: "1234567890000",
        signature,
        secret,
        nowEpochMilliseconds: 1234567890500,
        toleranceMilliseconds: 1_000,
      }),
    ).toEqual({
      verified: false,
      reasonCode: "invalid_signature",
    });
  });

  it("reads signing material through SecretProvider without exposing plaintext", async () => {
    const provider = new WebhookHmacSignatureProvider({
      secretProvider: new FakeSecretProvider({
        OMNIWA_WEBHOOK_SIGNING_SECRET: "webhook-signing-test-secret",
      }),
      clock: {
        epochMilliseconds: () => 1234567890000,
      },
    });

    const result = await provider.createSignature({
      deliveryId: fixedBody.deliveryId,
      webhookId: fixedBody.webhookId,
      payloadRef: fixedBody.payloadRef,
      signingSecretRef: "OMNIWA_WEBHOOK_SIGNING_SECRET",
      correlationId: fixedBody.correlationId,
      body: fixedBody,
    });

    expect(result).toEqual({
      scheme: "v1",
      signature: "v1=1e9bab5fd8dbdb7b4a52024b6d5af393d8af3436f81db23079b74f67fb99a336",
      timestamp: "1234567890000",
    });
    expect(JSON.stringify(result)).not.toContain("webhook-signing-test-secret");
  });

  it("fails safely when the signing secret is unavailable", async () => {
    const provider = new WebhookHmacSignatureProvider({
      secretProvider: new FakeSecretProvider(),
    });

    await expect(
      provider.createSignature({
        deliveryId: fixedBody.deliveryId,
        webhookId: fixedBody.webhookId,
        payloadRef: fixedBody.payloadRef,
        signingSecretRef: "OMNIWA_WEBHOOK_SIGNING_SECRET",
        correlationId: fixedBody.correlationId,
        body: fixedBody,
      }),
    ).rejects.toMatchObject({
      code: "webhook_signing_secret_unavailable",
      retryable: false,
    });
  });
});

class FakeSecretProvider implements SecretProvider {
  constructor(private readonly secrets: Readonly<Record<string, string>> = {}) {}

  readSecret(descriptor: SecretDescriptor): Promise<Result<SecretValue, OmniwaError>> {
    const value = this.secrets[String(descriptor.name)];

    expect(descriptor.purpose).toBe(webhookSigningSecretPurpose);

    if (value === undefined) {
      return Promise.resolve(
        fail({
          category: "configuration",
          code: "secret_not_found",
          message: "Secret is not configured.",
          retryable: false,
          metadata: {
            secretName: String(descriptor.name),
          },
        }),
      );
    }

    return Promise.resolve(succeed(SecretValue.fromString(value)));
  }
}
