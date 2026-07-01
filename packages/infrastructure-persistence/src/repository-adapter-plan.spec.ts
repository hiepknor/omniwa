import { describe, expect, it } from "vitest";

import {
  findRepositoryAdapterPlansByOwner,
  getRepositoryAdapterPlan,
  listRepositoryAdapterPlans,
  physicalDataModelReview,
  repositoryAdapterPlans,
  repositoryPortNames,
  validateRepositoryAdapterPlanCompleteness,
} from "./repository-adapter-plan.js";

describe("repository adapter planning", () => {
  it("covers every approved repository port exactly once", () => {
    const plannedPorts = repositoryAdapterPlans.map((plan) => plan.repositoryPort);

    expect(validateRepositoryAdapterPlanCompleteness()).toEqual([]);
    expect(plannedPorts).toHaveLength(repositoryPortNames.length);
    expect(new Set(plannedPorts)).toEqual(new Set(repositoryPortNames));
  });

  it("keeps source-of-truth persistence in PostgreSQL and prevents schema work in planning", () => {
    expect(physicalDataModelReview).toMatchObject({
      status: "reviewed",
      schemaCreationAllowed: false,
      ormModelCreationAllowed: false,
      migrationCreationAllowed: false,
      sourceOfTruthStore: "postgresql",
      redisBoundary: "ephemeral_only",
      objectStorageBoundary: "artifact_only",
    });

    expect(repositoryAdapterPlans.every((plan) => plan.storeOfRecord === "postgresql_source")).toBe(
      true,
    );
  });

  it("preserves aggregate ownership and safe persistence boundaries", () => {
    const messagePlan = getRepositoryAdapterPlan("MessageRepositoryPort");
    const sessionPlan = getRepositoryAdapterPlan("SessionRepositoryPort");
    const chatPlan = getRepositoryAdapterPlan("ChatRepositoryPort");
    const contactPlan = getRepositoryAdapterPlan("ContactRepositoryPort");
    const labelPlan = getRepositoryAdapterPlan("LabelRepositoryPort");
    const groupPlan = getRepositoryAdapterPlan("GroupRepositoryPort");
    const webhookPlans = findRepositoryAdapterPlansByOwner("webhook_delivery");

    expect(messagePlan).toMatchObject({
      aggregateRoot: "Message",
      ownerContext: "messaging",
      persistenceUnit: "Message State",
      logicalStorage: "Messaging State Storage",
    });
    expect(messagePlan.forbiddenData).toContain("raw_message_body");
    expect(sessionPlan.forbiddenData).toContain("session_secret_plaintext");
    expect(chatPlan).toMatchObject({
      aggregateRoot: "Chat",
      ownerContext: "chat",
      consistency: "eventual_projection",
    });
    expect(chatPlan.allowedOperations).toContain("findByLabel");
    expect(contactPlan).toMatchObject({
      aggregateRoot: "Contact",
      ownerContext: "contact",
      consistency: "eventual_projection",
    });
    expect(contactPlan.forbiddenData).toContain("raw_phone_or_jid");
    expect(labelPlan).toMatchObject({
      aggregateRoot: "Label",
      ownerContext: "label",
      persistenceUnit: "Label Organization State",
    });
    expect(groupPlan).toMatchObject({
      aggregateRoot: "Group",
      ownerContext: "group",
    });
    expect(groupPlan.traceability.productCapability).toBe("Groups management");
    expect(webhookPlans.map((plan) => plan.repositoryPort)).toEqual([
      "WebhookSubscriptionRepositoryPort",
      "WebhookDeliveryRepositoryPort",
    ]);
  });

  it("keeps each planned adapter traceable to application, API, and product capability", () => {
    const plansWithoutTraceability = listRepositoryAdapterPlans().filter(
      (plan) =>
        plan.traceability.applicationRefs.length === 0 ||
        plan.traceability.apiResources.length === 0 ||
        plan.traceability.productCapability.length === 0,
    );

    expect(plansWithoutTraceability).toEqual([]);
  });

  it("does not broaden repository operations beyond approved port methods", () => {
    const broadOperations = ["search", "report", "join", "querySql", "rawQuery"];

    for (const plan of repositoryAdapterPlans) {
      expect(plan.allowedOperations).toContain("load");
      expect(plan.allowedOperations).toContain("save");
      expect(plan.allowedOperations).toContain("exists");

      for (const operation of broadOperations) {
        expect(plan.allowedOperations).not.toContain(operation);
      }
    }
  });
});
