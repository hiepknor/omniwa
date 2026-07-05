import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createWebhookDeliveryOperationIntentRef,
  type ApplicationPortContext,
} from "@omniwa/application";
import { createCorrelationId, createRequestContext, createRequestId } from "@omniwa/shared";
import { describe, expect, it } from "vitest";

import {
  DurableJsonWebhookDeliveryOperationIntentStore,
  InMemoryWebhookDeliveryOperationIntentStore,
} from "./webhook-delivery-operation-intent-store.js";

const context: ApplicationPortContext = {
  requestContext: createRequestContext({
    requestId: createRequestId("webhook-operation-intent-test"),
    correlationId: createCorrelationId("webhook-operation-intent-test"),
  }),
  actorRef: "api_key:test",
};

describe("WebhookDeliveryOperationIntentStore", () => {
  it("stores and resolves bulk redrive delivery refs", async () => {
    const store = new InMemoryWebhookDeliveryOperationIntentStore({
      clock: { epochMilliseconds: () => 123 },
    });
    const ref = createWebhookDeliveryOperationIntentRef("webhook_operation_intent_1");

    const receipt = await store.storeWebhookDeliveryOperationIntent(
      {
        webhookDeliveryOperationIntentRef: ref,
        kind: "bulk_redrive",
        deliveryRefs: ["webhook-delivery:one", "webhook-delivery:two"],
      },
      context,
    );
    const resolved = await store.resolveWebhookDeliveryOperationIntent(ref, context);

    expect(receipt).toMatchObject({
      ok: true,
      value: {
        webhookDeliveryOperationIntentRef: ref,
        kind: "bulk_redrive",
        deliveryCount: 2,
        createdAtEpochMilliseconds: 123,
      },
    });
    expect(resolved).toMatchObject({
      ok: true,
      value: {
        webhookDeliveryOperationIntentRef: ref,
        kind: "bulk_redrive",
        deliveryRefs: ["webhook-delivery:one", "webhook-delivery:two"],
        createdAtEpochMilliseconds: 123,
      },
    });
  });

  it("rejects duplicate delivery refs without leaking receiver details", async () => {
    const store = new InMemoryWebhookDeliveryOperationIntentStore();
    const result = await store.storeWebhookDeliveryOperationIntent(
      {
        kind: "bulk_redrive",
        deliveryRefs: ["webhook-delivery:dup", "webhook-delivery:dup"],
      },
      context,
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "webhook_delivery_operation_intent_store_rejected",
        category: "unsafe_payload",
      },
    });
    expect(JSON.stringify(result)).not.toContain("targetUrl");
    expect(JSON.stringify(result)).not.toContain("webhook-delivery:dup");
  });

  it("rejects unsafe delivery refs without leaking raw details", async () => {
    const store = new InMemoryWebhookDeliveryOperationIntentStore();
    const result = await store.storeWebhookDeliveryOperationIntent(
      {
        kind: "bulk_redrive",
        deliveryRefs: ["https://receiver.example.test/secret"],
      },
      context,
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "webhook_delivery_operation_intent_store_rejected",
        category: "unsafe_payload",
      },
    });
    expect(JSON.stringify(result)).not.toContain("receiver.example.test");
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("reloads durable-json state across store instances", async () => {
    const directory = mkdtempSync(join(tmpdir(), "omniwa-webhook-operation-intents-"));
    const filePath = join(directory, "intents.json");
    const ref = createWebhookDeliveryOperationIntentRef("webhook_operation_intent_durable");

    try {
      const first = new DurableJsonWebhookDeliveryOperationIntentStore(filePath, {
        clock: { epochMilliseconds: () => 456 },
      });
      await first.storeWebhookDeliveryOperationIntent(
        {
          webhookDeliveryOperationIntentRef: ref,
          kind: "bulk_redrive",
          deliveryRefs: ["webhook-delivery:durable"],
        },
        context,
      );

      const second = new DurableJsonWebhookDeliveryOperationIntentStore(filePath);
      await expect(
        second.resolveWebhookDeliveryOperationIntent(ref, context),
      ).resolves.toMatchObject({
        ok: true,
        value: {
          webhookDeliveryOperationIntentRef: ref,
          kind: "bulk_redrive",
          deliveryRefs: ["webhook-delivery:durable"],
          createdAtEpochMilliseconds: 456,
        },
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
