import { describe, expect, it } from "vitest";
import { createCorrelationId, createRequestContext, createRequestId } from "@omniwa/shared";

import {
  applicationCommandDefinitions,
  applicationCommandGroups,
  applicationCommandNames,
  createApplicationCommandEnvelope,
  createApplicationCommandOutcome,
  getApplicationCommandDefinition,
  getApplicationCommandsByGroup,
  isApplicationCommandName,
} from "../index.js";
import {
  applicationQueryDefinitions,
  applicationQueryGroups,
  applicationQueryNames,
  createApplicationQueryEnvelope,
  createApplicationQueryOutcome,
  getApplicationQueriesByGroup,
  isApplicationQueryName,
} from "../index.js";

const requestContext = createRequestContext({
  correlationId: createCorrelationId("application-command-query-correlation"),
  requestId: createRequestId("application-command-query-request"),
});

describe("application command and query model", () => {
  it("catalogs every frozen application command exactly once", () => {
    expect(applicationCommandNames).toHaveLength(59);
    expect(new Set(applicationCommandNames).size).toBe(applicationCommandNames.length);
    expect(
      applicationCommandGroups.map((group) => getApplicationCommandsByGroup(group).length),
    ).toEqual([10, 9, 5, 9, 10, 6, 4, 4, 2]);
    expect(applicationCommandDefinitions.every((definition) => definition.name.length > 0)).toBe(
      true,
    );
    expect(isApplicationCommandName("SendTextMessage")).toBe(true);
    expect(isApplicationCommandName("DeleteDatabase")).toBe(false);
  });

  it("enforces idempotency requirements at the command envelope boundary", () => {
    expect(() =>
      createApplicationCommandEnvelope({
        name: "SendTextMessage",
        commandRef: "command-1",
        requestContext,
      }),
    ).toThrow(/idempotencyKey/u);

    const envelope = createApplicationCommandEnvelope({
      name: "SendTextMessage",
      commandRef: "command-1",
      requestContext,
      targetRef: "message-1",
      idempotencyKey: "send-message-1",
      dataClassification: "internal",
    });

    expect(envelope).toMatchObject({
      kind: "command",
      name: "SendTextMessage",
      idempotencyKey: "send-message-1",
    });
    expect(Object.isFrozen(envelope)).toBe(true);
  });

  it("classifies command traits without introducing handlers or adapters", () => {
    expect(getApplicationCommandDefinition("ProcessOutboundMessageWork")).toMatchObject({
      trigger: "worker",
      asyncBoundary: true,
      longRunning: true,
    });
    expect(getApplicationCommandDefinition("DestroyInstance")).toMatchObject({
      privileged: true,
    });

    const outcome = createApplicationCommandOutcome({
      commandRef: "command-1",
      outcome: "queued",
      accepted: true,
      retryable: true,
      resultRef: "job-1",
    });

    expect(outcome.kind).toBe("command_outcome");
  });

  it("catalogs every frozen application query as side-effect free", () => {
    expect(applicationQueryNames).toHaveLength(37);
    expect(new Set(applicationQueryNames).size).toBe(applicationQueryNames.length);
    expect(
      applicationQueryGroups.map((group) => getApplicationQueriesByGroup(group).length),
    ).toEqual([9, 17, 1, 6, 4]);
    expect(applicationQueryDefinitions.every((definition) => definition.sideEffectFree)).toBe(true);
    expect(isApplicationQueryName("GetInstanceStatus")).toBe(true);
    expect(isApplicationQueryName("GetDashboardSummary")).toBe(true);
    expect(isApplicationQueryName("ListWorkerJobs")).toBe(true);
    expect(isApplicationQueryName("ListEvents")).toBe(true);
    expect(isApplicationQueryName("ListInstanceChats")).toBe(true);
    expect(isApplicationQueryName("GetContactStatus")).toBe(true);
    expect(isApplicationQueryName("ListLabels")).toBe(true);
    expect(isApplicationQueryName("ListInstanceGroups")).toBe(true);
    expect(isApplicationQueryName("RepairProjection")).toBe(false);
  });

  it("creates query envelopes and outcomes without idempotency or mutation concepts", () => {
    const envelope = createApplicationQueryEnvelope({
      name: "GetMessageStatus",
      queryRef: "query-1",
      requestContext,
      targetRef: "message-1",
      requestedConsistency: "strong_owner",
      dataClassification: "internal",
    });

    expect(envelope).toMatchObject({
      kind: "query",
      name: "GetMessageStatus",
      requestedConsistency: "strong_owner",
    });
    expect(Object.isFrozen(envelope)).toBe(true);

    const outcome = createApplicationQueryOutcome({
      queryRef: "query-1",
      outcome: "stale",
      consistency: "eventual_projection",
      freshness: {
        stale: true,
      },
      resultRef: "message-status-view",
    });

    expect(outcome).toMatchObject({
      kind: "query_outcome",
      outcome: "stale",
      consistency: "eventual_projection",
    });
  });

  it("keeps command and query names separate", () => {
    const overlap = applicationCommandNames.filter((name) =>
      applicationQueryNames.includes(name as never),
    );

    expect(overlap).toEqual([]);
  });
});
