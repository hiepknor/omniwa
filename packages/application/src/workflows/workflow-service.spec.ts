import { describe, expect, it } from "vitest";
import { createCorrelationId, createRequestContext, createRequestId } from "@omniwa/shared";

import {
  applicationCommandNames,
  applicationQueryNames,
  applicationServiceDefinitions,
  applicationWorkflowDefinitions,
  applicationWorkflowIds,
  assertAsyncVisibilityBeforeAcceptance,
  assertQueryWorkflowState,
  createApplicationCommandEnvelope,
  createIdempotencyScope,
  createUnitOfWorkPlan,
  createWorkflowProgress,
  getApplicationServiceForCommand,
  getPrimaryApplicationServiceForQuery,
  getQueryBoundaryApplicationService,
  getWorkflowByQuery,
  getWorkflowsByCommand,
  hasStandaloneWorkflowException,
  isTerminalWorkflowState,
  transitionWorkflowProgress,
} from "../index.js";

const requestContext = createRequestContext({
  correlationId: createCorrelationId("workflow-service-correlation"),
  requestId: createRequestId("workflow-service-request"),
});

describe("application workflows and services", () => {
  it("catalogs approved workflows and keeps query workflow read-only", () => {
    expect(applicationWorkflowIds).toHaveLength(26);
    expect(new Set(applicationWorkflowIds).size).toBe(applicationWorkflowIds.length);

    const queryWorkflow = getWorkflowByQuery("GetInstanceStatus");
    expect(queryWorkflow).toMatchObject({
      id: "WF-QRY-001",
      queryOnly: true,
      asyncVisibilityRequired: false,
    });

    expect(applicationWorkflowDefinitions.filter((workflow) => workflow.longRunning)).toHaveLength(
      12,
    );
  });

  it("maps every command and query to an approved orchestration owner", () => {
    const commandsWithoutWorkflow = applicationCommandNames.filter(
      (commandName) =>
        getWorkflowsByCommand(commandName).length === 0 &&
        !hasStandaloneWorkflowException(commandName),
    );
    expect(commandsWithoutWorkflow).toEqual([]);

    const commandsWithoutService = applicationCommandNames.filter(
      (commandName) => getApplicationServiceForCommand(commandName) === undefined,
    );
    expect(commandsWithoutService).toEqual([]);

    const queriesWithoutService = applicationQueryNames.filter(
      (queryName) => getPrimaryApplicationServiceForQuery(queryName) === undefined,
    );
    expect(queriesWithoutService).toEqual([]);

    expect(getApplicationServiceForCommand("SendTextMessage")).toBe("MessagingApplicationService");
    expect(getPrimaryApplicationServiceForQuery("GetQueueMetricsSnapshot")).toBe(
      "OperationsApplicationService",
    );
    expect(getQueryBoundaryApplicationService()).toBe("QueryApplicationService");
    expect(
      applicationServiceDefinitions.find((service) => service.name === "QueryApplicationService"),
    ).toMatchObject({
      sideEffecting: false,
      queryBoundaryForAllQueries: true,
    });
  });

  it("enforces application workflow state transitions and query state restrictions", () => {
    const progress = createWorkflowProgress({
      workflowId: "WF-MSG-001",
      currentState: "not_started",
      enteredStateReasonCode: "created",
    });
    const started = transitionWorkflowProgress(progress, "started", "trigger_accepted");
    const checking = transitionWorkflowProgress(
      started,
      "preconditions_checking",
      "checking_preconditions",
    );
    const queuing = transitionWorkflowProgress(checking, "queuing_work", "accepted_async");
    const queued = transitionWorkflowProgress(queuing, "queued", "worker_job_visible");

    expect(queued.currentState).toBe("queued");
    expect(() => transitionWorkflowProgress(queued, "completed", "skip_execution")).toThrow(
      /cannot transition/u,
    );
    expect(isTerminalWorkflowState("completed")).toBe(true);
    expect(() => assertQueryWorkflowState("queued")).toThrow(/Query workflow/u);
  });

  it("creates unit of work plans and blocks async acceptance without visible work", () => {
    const command = createApplicationCommandEnvelope({
      name: "SendTextMessage",
      commandRef: "command-send-1",
      requestContext,
      targetRef: "message-1",
      idempotencyKey: "send-message-1",
      dataClassification: "internal",
    });
    const plan = createUnitOfWorkPlan({
      command,
      workflowId: "WF-MSG-001",
    });

    expect(plan).toMatchObject({
      boundaryType: "async_acceptance",
      requiresAsyncVisibility: true,
    });
    expect(() =>
      assertAsyncVisibilityBeforeAcceptance({
        plan,
        asyncWorkVisible: false,
      }),
    ).toThrow(/Async acceptance/u);
    expect(() =>
      assertAsyncVisibilityBeforeAcceptance({
        plan,
        asyncWorkVisible: true,
      }),
    ).not.toThrow();
  });

  it("creates safe idempotency scopes and rejects sensitive keys", () => {
    const command = createApplicationCommandEnvelope({
      name: "RegisterMedia",
      commandRef: "command-media-1",
      requestContext,
      targetRef: "media-1",
      idempotencyKey: "media-registration-1",
      dataClassification: "internal",
    });

    expect(createIdempotencyScope(command)).toMatchObject({
      commandName: "RegisterMedia",
      key: "media-registration-1",
      targetRef: "media-1",
    });

    expect(() =>
      createApplicationCommandEnvelope({
        name: "RegisterMedia",
        commandRef: "command-media-2",
        requestContext,
        idempotencyKey: "session:secret-material",
      }),
    ).not.toThrow();

    const unsafe = createApplicationCommandEnvelope({
      name: "RegisterMedia",
      commandRef: "command-media-2",
      requestContext,
      idempotencyKey: "session:secret-material",
    });
    expect(() => createIdempotencyScope(unsafe)).toThrow(/Secret or raw Confidential/u);
  });
});
