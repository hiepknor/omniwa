import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createCorrelationId,
  createRequestContext,
  createRequestId,
  createUuid,
  toIsoTimestamp,
  type Clock,
  type UUIDGenerator,
} from "@omniwa/shared";
import { createOutboundMessageIntentRef, type ApplicationPortContext } from "@omniwa/application";
import { describe, expect, it } from "vitest";

import {
  DurableJsonOutboundMessageIntentStore,
  InMemoryOutboundMessageIntentStore,
} from "./outbound-message-intent-store.js";

const rawRecipient = "12025550123@s.whatsapp.net";
const rawText = "secret hello from test";
const context: ApplicationPortContext = {
  requestContext: createRequestContext({
    requestId: createRequestId("outbound-intent-request"),
    correlationId: createCorrelationId("outbound-intent-correlation"),
  }),
  actorRef: "api_key:test",
};
const fixedClock: Clock = {
  now: () => new Date("2026-07-03T00:00:00.000Z"),
  epochMilliseconds: () => 1_783_036_800_000,
  isoNow: () => toIsoTimestamp(new Date("2026-07-03T00:00:00.000Z")),
};
const fixedUuidGenerator: UUIDGenerator = {
  random: () => createUuid("550e8400-e29b-41d4-a716-446655440001"),
};

describe("outbound message intent store", () => {
  it("stores a text intent and returns only a safe outboundIntentRef receipt", async () => {
    const store = new InMemoryOutboundMessageIntentStore({
      clock: fixedClock,
      uuidGenerator: fixedUuidGenerator,
    });

    const result = await store.storeTextIntent(
      {
        recipientRef: rawRecipient,
        text: rawText,
      },
      context,
    );

    expect(result.ok).toBe(true);
    expect(result.ok ? result.value : undefined).toEqual({
      outboundIntentRef: createOutboundMessageIntentRef(
        "outbound_intent:550e8400-e29b-41d4-a716-446655440001",
      ),
      kind: "text",
      createdAtEpochMilliseconds: 1_783_036_800_000,
    });
    expect(JSON.stringify(result)).not.toContain(rawRecipient);
    expect(JSON.stringify(result)).not.toContain(rawText);
  });

  it("resolves a text intent for internal provider translation", async () => {
    const store = new InMemoryOutboundMessageIntentStore({
      clock: fixedClock,
      uuidGenerator: fixedUuidGenerator,
    });
    const stored = await store.storeTextIntent(
      {
        recipientRef: rawRecipient,
        text: rawText,
      },
      context,
    );

    expect(stored.ok).toBe(true);

    const resolved = await store.resolveTextIntent(
      stored.ok
        ? stored.value.outboundIntentRef
        : createOutboundMessageIntentRef("outbound_intent:unused"),
      context,
    );

    expect(resolved.ok).toBe(true);
    expect(resolved.ok ? resolved.value.recipientRef : undefined).toBe(rawRecipient);
    expect(resolved.ok ? resolved.value.text : undefined).toBe(rawText);
  });

  it("verifies a text intent without exposing raw provider payload", async () => {
    const store = new InMemoryOutboundMessageIntentStore({
      clock: fixedClock,
      uuidGenerator: fixedUuidGenerator,
    });
    const stored = await store.storeTextIntent(
      {
        recipientRef: rawRecipient,
        text: rawText,
      },
      context,
    );

    expect(stored.ok).toBe(true);

    const verified = await store.verifyTextIntent(
      stored.ok
        ? stored.value.outboundIntentRef
        : createOutboundMessageIntentRef("outbound_intent:unused"),
      context,
    );

    expect(verified.ok).toBe(true);
    expect(verified.ok ? verified.value : undefined).toEqual(stored.ok ? stored.value : undefined);
    expect(JSON.stringify(verified)).not.toContain(rawRecipient);
    expect(JSON.stringify(verified)).not.toContain(rawText);
  });

  it("returns safe errors for missing intents", async () => {
    const store = new InMemoryOutboundMessageIntentStore({
      clock: fixedClock,
      uuidGenerator: fixedUuidGenerator,
    });
    const missingRef = createOutboundMessageIntentRef("outbound_intent:missing");

    const result = await store.resolveTextIntent(missingRef, context);

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error).toMatchObject({
      category: "rejected",
      code: "outbound_intent_not_found",
      retryable: false,
      safeMetadata: {
        outboundIntentRef: "outbound_intent:missing",
      },
    });
    expect(JSON.stringify(result)).not.toContain(rawRecipient);
    expect(JSON.stringify(result)).not.toContain(rawText);
  });

  it("persists durable state without plain raw payload fields", async () => {
    const directory = mkdtempSync(join(tmpdir(), "omniwa-outbound-intents-"));
    const filePath = join(directory, "intents.json");
    const store = new DurableJsonOutboundMessageIntentStore(filePath, {
      clock: fixedClock,
      uuidGenerator: fixedUuidGenerator,
    });

    const stored = await store.storeTextIntent(
      {
        recipientRef: rawRecipient,
        text: rawText,
      },
      context,
    );
    expect(stored.ok).toBe(true);

    const rawFile = readFileSync(filePath, "utf8");
    expect(rawFile).not.toContain(rawRecipient);
    expect(rawFile).not.toContain(rawText);

    const reloaded = new DurableJsonOutboundMessageIntentStore(filePath, {
      clock: fixedClock,
      uuidGenerator: fixedUuidGenerator,
    });
    const resolved = await reloaded.resolveTextIntent(
      stored.ok
        ? stored.value.outboundIntentRef
        : createOutboundMessageIntentRef("outbound_intent:unused"),
      context,
    );

    expect(resolved.ok).toBe(true);
    expect(resolved.ok ? resolved.value.recipientRef : undefined).toBe(rawRecipient);
    expect(resolved.ok ? resolved.value.text : undefined).toBe(rawText);
  });
});
