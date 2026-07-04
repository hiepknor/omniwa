import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  createClientContractFixture,
  evaluateClientContractReadiness,
} from "./check-client-contract.mjs";

describe("client contract check", () => {
  it("passes for a valid omniwa-tui client contract fixture", async () => {
    const root = await createTempProject();

    try {
      await createClientContractFixture(root, {
        endpoints: implementedPublicEndpoints(),
        fixtures: requiredFixtureMap(),
      });

      const report = await evaluateClientContractReadiness({ projectRoot: root });

      expect(report).toEqual({
        status: "passed",
        findings: [],
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails when the manifest claims an unapproved implemented public endpoint", async () => {
    const root = await createTempProject();

    try {
      await createClientContractFixture(root, {
        endpoints: [
          ...implementedPublicEndpoints(),
          implementedEndpoint("GET", "/v1/groups/{groupId}"),
        ],
        fixtures: requiredFixtureMap(),
      });

      const report = await evaluateClientContractReadiness({ projectRoot: root });

      expect(report.status).toBe("failed");
      expect(report.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "client_contract_implemented_endpoint_not_allowed",
            target: "GET /v1/groups/{groupId}",
          }),
        ]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails when a required TUI parser fixture is absent", async () => {
    const root = await createTempProject();

    try {
      await createClientContractFixture(root);

      const report = await evaluateClientContractReadiness({ projectRoot: root });

      expect(report.status).toBe("failed");
      expect(report.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "client_contract_required_fixture_missing",
            target: "authMissingError",
          }),
        ]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails when a JSON fixture does not use the public envelope", async () => {
    const root = await createTempProject();

    try {
      await createClientContractFixture(root, {
        endpoints: implementedPublicEndpoints(),
        fixtures: requiredFixtureMap(),
      });
      await writeFile(
        join(root, "docs/api/client-contract/fixtures/health.success.json"),
        '{"ok":true}\n',
        "utf8",
      );

      const report = await evaluateClientContractReadiness({ projectRoot: root });

      expect(report.status).toBe("failed");
      expect(report.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "client_contract_fixture_not_envelope",
            target: "healthSuccess",
          }),
        ]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function createTempProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), "omniwa-client-contract-check-"));
}

function implementedEndpoint(method: string, path: string) {
  return {
    feature: "fixture",
    method,
    path,
    status: "implemented_public",
    authRequired: true,
  };
}

function implementedPublicEndpoints() {
  return [
    implementedEndpoint("GET", "/v1/health"),
    implementedEndpoint("GET", "/v1/health/readiness"),
    implementedEndpoint("GET", "/v1/instances"),
    implementedEndpoint("GET", "/v1/instances/{instanceId}"),
    implementedEndpoint("GET", "/v1/instances/{instanceId}/sessions"),
    implementedEndpoint("GET", "/v1/instances/{instanceId}/messages"),
    implementedEndpoint("POST", "/v1/instances"),
    implementedEndpoint("GET", "/v1/messages/{messageId}"),
    implementedEndpoint("GET", "/v1/events"),
    implementedEndpoint("GET", "/v1/events/stream"),
    implementedEndpoint("GET", "/v1/queue"),
    implementedEndpoint("GET", "/v1/jobs"),
    implementedEndpoint("GET", "/v1/jobs/{jobId}"),
    implementedEndpoint("GET", "/v1/instances/{instanceId}/chats"),
    implementedEndpoint("GET", "/v1/chats/{chatId}"),
    implementedEndpoint("GET", "/v1/webhooks"),
    implementedEndpoint("GET", "/v1/webhooks/{webhookId}"),
    implementedEndpoint("GET", "/v1/webhook-deliveries"),
    implementedEndpoint("GET", "/v1/webhook-deliveries/{deliveryId}/history"),
  ];
}

function requiredFixtureMap() {
  return {
    healthSuccess: "docs/api/client-contract/fixtures/health.success.json",
    authMissingError: "docs/api/client-contract/fixtures/auth.missing.error.json",
    instancesEmpty: "docs/api/client-contract/fixtures/instances.empty.json",
    instancesList: "docs/api/client-contract/fixtures/instances.list.json",
    messagesList: "docs/api/client-contract/fixtures/messages.list.json",
    messageDetail: "docs/api/client-contract/fixtures/message.detail.json",
    chatsList: "docs/api/client-contract/fixtures/chats.list.json",
    chatDetail: "docs/api/client-contract/fixtures/chat.detail.json",
    eventsList: "docs/api/client-contract/fixtures/events.list.json",
    queueSummary: "docs/api/client-contract/fixtures/queue.summary.json",
    jobsList: "docs/api/client-contract/fixtures/jobs.list.json",
    webhooksList: "docs/api/client-contract/fixtures/webhooks.list.json",
    webhookDeliveriesList: "docs/api/client-contract/fixtures/webhook-deliveries.list.json",
    groupUnavailable: "docs/api/client-contract/fixtures/group.unavailable.json",
    sseHeartbeat: "docs/api/client-contract/fixtures/events-stream.heartbeat.sse",
  };
}
