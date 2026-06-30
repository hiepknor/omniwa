import {
  createInternalEventHandlerFailure,
  createProductFactNotification,
  type ApplicationNotification,
  type ApplicationPortContext,
} from "@omniwa/application";
import { createDomainEvent } from "@omniwa/domain";
import { createCorrelationId, createRequestContext, createRequestId, ok } from "@omniwa/shared";
import { describe, expect, it } from "vitest";

import { createFakeInternalEventBus } from "./fake-event-bus.js";

const context: ApplicationPortContext = {
  requestContext: createRequestContext({
    correlationId: createCorrelationId("event-bus-correlation"),
    requestId: createRequestId("event-bus-request"),
  }),
  actorRef: "operator",
};

describe("fake internal event bus", () => {
  it("dispatches application notifications to subscribed handlers in registration order", async () => {
    const bus = createFakeInternalEventBus();
    const calls: string[] = [];
    const notification = createNotification();

    bus.subscribe("webhook_delivery_requested", "first", () => {
      calls.push("first");
      return ok(undefined);
    });
    bus.subscribe("webhook_delivery_requested", "second", () => {
      calls.push("second");
      return ok(undefined);
    });

    const result = await bus.publishNotification(notification, context);

    expect(result).toMatchObject({ ok: true });
    expect(calls).toEqual(["first", "second"]);
    expect(result.ok ? result.value.publicationRef : "").toBe("webhook_delivery_requested:1");
  });

  it("keeps domain fact publication under application timing and emits product fact notifications", async () => {
    const bus = createFakeInternalEventBus();
    const sourceDomainEvent = createDomainEvent({
      aggregateType: "Message",
      aggregateId: "message-1",
      name: "MessageAccepted",
    });
    const handled: ApplicationNotification[] = [];

    bus.subscribe("product_fact_published", "audit-follow-up", (notification) => {
      handled.push(notification);
      return ok(undefined);
    });

    const result = await bus.publishDomainFacts([sourceDomainEvent], context);

    expect(result).toMatchObject({ ok: true });
    expect(bus.domainFactPublications).toHaveLength(1);
    expect(bus.notificationPublications).toHaveLength(1);
    expect(handled).toEqual([createProductFactNotification(sourceDomainEvent)]);
    expect(handled[0]).toMatchObject({
      name: "product_fact_published",
      sourceSignalRef: "Message:message-1:MessageAccepted",
      integrationEventName: "message.accepted.v1",
      targetContextRef: "Message",
    });
  });

  it("returns a port failure when a handler rejects notification publication", async () => {
    const bus = createFakeInternalEventBus();

    bus.subscribe("webhook_delivery_requested", "webhook-handler", () =>
      createInternalEventHandlerFailure("webhook-handler", "webhook_delivery_requested"),
    );

    const result = await bus.publishNotification(createNotification(), context);

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error).toMatchObject({
      category: "rejected",
      code: "internal_event_handler_failed",
      retryable: true,
      safeMetadata: {
        handlerId: "webhook-handler",
        notificationName: "webhook_delivery_requested",
      },
    });
  });

  it("supports deterministic capture and unsubscribe for tests", async () => {
    const bus = createFakeInternalEventBus();
    const calls: string[] = [];
    const subscription = bus.subscribe("webhook_delivery_requested", "capture-handler", () => {
      calls.push("called");
      return ok(undefined);
    });

    await bus.publishNotification(createNotification(), context);
    bus.unsubscribe(subscription);
    await bus.publishNotification(createNotification(), context);

    expect(calls).toEqual(["called"]);
    expect(bus.listSubscriptions("webhook_delivery_requested")).toEqual([]);
    expect(bus.notificationPublications.map((publication) => publication.publicationRef)).toEqual([
      "webhook_delivery_requested:1",
      "webhook_delivery_requested:2",
    ]);
  });
});

function createNotification(): ApplicationNotification {
  return Object.freeze({
    name: "webhook_delivery_requested",
    sourceSignalRef: "Message:message-1:MessageAccepted",
    dataClassification: "internal",
    integrationEventName: "message.accepted.v1",
    targetContextRef: "webhook_delivery",
  });
}
