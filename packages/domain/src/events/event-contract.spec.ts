import { describe, expect, it } from "vitest";

import { domainEventNames } from "./domain-event.js";
import {
  approvedIntegrationEventNames,
  createDomainEventContract,
  domainEventContracts,
  getDomainEventContract,
  isApprovedIntegrationEventName,
  listDomainEventContracts,
} from "./event-contract.js";

describe("Domain event contracts", () => {
  it("covers every approved domain event name with a v1 contract", () => {
    expect(Object.keys(domainEventContracts).sort()).toEqual([...domainEventNames].sort());
    expect(listDomainEventContracts()).toHaveLength(domainEventNames.length);
    expect(listDomainEventContracts().every((contract) => contract.version === "v1")).toBe(true);
  });

  it("maps approved integration events without exposing unapproved domain facts", () => {
    expect(getDomainEventContract("MessageDelivered")).toMatchObject({
      eventName: "MessageDelivered",
      signalName: "message.delivered",
      aggregateType: "Message",
      integrationEventName: "message.delivered.v1",
    });
    expect(getDomainEventContract("ConfigurationActivated").integrationEventName).toBeUndefined();
    expect(approvedIntegrationEventNames).toContain("health.recovered.v1");
    expect(isApprovedIntegrationEventName("message.delivered.v1")).toBe(true);
    expect(isApprovedIntegrationEventName("configuration.activated.v1")).toBe(false);
  });

  it("keeps contract metadata safe and implementation-free", () => {
    const contract = getDomainEventContract("WebhookDeliveryDeadLettered");

    expect(Object.isFrozen(contract)).toBe(true);
    expect(Object.isFrozen(contract.requiredData)).toBe(true);
    expect(contract.requiredData).toContain("webhook_delivery_id");
    expect(contract.requiredData).toContain("dead_letter_reason");
    expect(contract.signalName).toBe("webhook.delivery.dead_lettered");
  });

  it("rejects secret, unknown, or unsafe contract metadata", () => {
    expect(() =>
      createDomainEventContract({
        eventName: "MessageDelivered",
        signalName: "message.delivered",
        version: "v2",
        aggregateType: "Message",
        dataClassification: "internal",
        requiredData: ["message_id"],
        orderingRequirement: "after_dispatched",
        idempotencyRequirement: "message_id",
      }),
    ).toThrow(TypeError);

    expect(() =>
      createDomainEventContract({
        eventName: "MessageDelivered",
        signalName: "Message Delivered",
        version: "v1",
        aggregateType: "Message",
        dataClassification: "internal",
        requiredData: ["message_id"],
        orderingRequirement: "after_dispatched",
        idempotencyRequirement: "message_id",
      }),
    ).toThrow(TypeError);

    expect(() =>
      createDomainEventContract({
        eventName: "MessageDelivered",
        signalName: "message.delivered",
        version: "v1",
        aggregateType: "Message",
        dataClassification: "secret",
        requiredData: ["message_id"],
        orderingRequirement: "after_dispatched",
        idempotencyRequirement: "message_id",
      }),
    ).toThrow(TypeError);
  });
});
