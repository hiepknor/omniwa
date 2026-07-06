import type { ApplicationPortContext } from "@omniwa/application";
import {
  createInstanceId,
  createMessageId,
  createProviderId,
  createSessionId,
} from "@omniwa/domain";
import {
  InMemoryProviderCommandTransport,
  providerCommandBridgeHttpPath,
  providerCommandBridgeTokenHeader,
  type ProviderCommand,
} from "@omniwa/infrastructure-provider-bridge";
import { createCorrelationId, createRequestContext, createRequestId, ok } from "@omniwa/shared";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import {
  readProviderRuntimeCommandBridgeHttpServerConfig,
  startProviderRuntimeCommandBridgeHttpServer,
  type ProviderRuntimeCommandBridgeHttpServerHandle,
} from "./provider-command-http-server.js";

const bridgeToken = "provider-runtime-command-bridge-token";
const instanceId = createInstanceId("provider-runtime-http-bridge-instance");
const providerId = createProviderId("baileys");
const sessionId = createSessionId("provider-runtime-http-bridge-session");
const messageId = createMessageId("provider-runtime-http-bridge-message");
const rawRecipient = "12025550199@s.whatsapp.net";
const rawText = "private provider bridge text";
const command: ProviderCommand = Object.freeze({
  kind: "send_outbound_message",
  commandId: "send_outbound_message:provider-runtime-http-bridge",
  request: {
    idempotencyKey: "provider-runtime-http-bridge",
    instanceId,
    messageId,
    messageType: "text" as const,
    outboundIntentRef: "outbound.intent.safe-ref",
    providerId,
    sessionId,
  },
});
const context: ApplicationPortContext = {
  actorRef: "worker",
  dataClassification: "internal",
  idempotencyKey: "provider-runtime-http-bridge",
  requestContext: createRequestContext({
    correlationId: createCorrelationId("provider-runtime-http-bridge-correlation"),
    requestId: createRequestId("provider-runtime-http-bridge-request"),
  }),
};
const openServers: ProviderRuntimeCommandBridgeHttpServerHandle[] = [];

afterEach(async () => {
  for (const handle of openServers.splice(0)) {
    await handle.stop();
  }
});

describe("provider runtime command bridge HTTP server", () => {
  it("is disabled by default and fail-closed when the token is missing", () => {
    expect(readProviderRuntimeCommandBridgeHttpServerConfig({})).toEqual({
      enabled: false,
      reasonCode: "provider_command_bridge_http_disabled",
    });
    expect(
      readProviderRuntimeCommandBridgeHttpServerConfig({
        OMNIWA_PROVIDER_COMMAND_BRIDGE_HTTP: "1",
      }),
    ).toEqual({
      enabled: false,
      reasonCode: "provider_command_bridge_token_missing",
    });
  });

  it("does not start when bridge mode is enabled without a transport", async () => {
    const handle = await startProviderRuntimeCommandBridgeHttpServer(undefined, {
      OMNIWA_PROVIDER_COMMAND_BRIDGE_HTTP: "1",
      OMNIWA_PROVIDER_COMMAND_BRIDGE_TOKEN: bridgeToken,
    });

    expect(handle.status).toEqual({
      attempted: false,
      started: false,
      reasonCode: "provider_command_bridge_transport_missing",
    });
  });

  it("starts an internal HTTP endpoint and routes authorized commands", async () => {
    const transport = new InMemoryProviderCommandTransport({
      handler: (receivedCommand, receivedContext) => {
        expect(receivedCommand).toEqual(command);
        expect(String(receivedContext.requestContext.correlationId)).toBe(
          "provider-runtime-http-bridge-correlation",
        );

        return ok({
          kind: "send_outbound_message",
          result: {
            messageId,
            providerReceiptRef: "receipt.safe-ref",
            retryable: false,
            status: "accepted",
          },
        });
      },
    });
    const handle = await startProviderRuntimeCommandBridgeHttpServer(transport, {
      OMNIWA_PROVIDER_COMMAND_BRIDGE_HTTP: "1",
      OMNIWA_PROVIDER_COMMAND_BRIDGE_HOST: "127.0.0.1",
      OMNIWA_PROVIDER_COMMAND_BRIDGE_PORT: "0",
      OMNIWA_PROVIDER_COMMAND_BRIDGE_TOKEN: bridgeToken,
    });
    openServers.push(handle);

    expect(handle.status).toMatchObject({
      attempted: true,
      started: true,
      reasonCode: "provider_command_bridge_http_started",
      host: "127.0.0.1",
    });
    expect(handle.status.port).toBeGreaterThan(0);

    const response = await fetch(
      `http://127.0.0.1:${handle.status.port}${providerCommandBridgeHttpPath}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [providerCommandBridgeTokenHeader]: bridgeToken,
        },
        body: JSON.stringify({
          command,
          context,
        }),
      },
    );
    const body = asRecord(await response.json());

    expect(response.status).toBe(200);
    expect(body).toEqual(
      ok({
        kind: "send_outbound_message",
        result: {
          messageId,
          providerReceiptRef: "receipt.safe-ref",
          retryable: false,
          status: "accepted",
        },
      }),
    );
    expect(transport.commands()).toHaveLength(1);
    expect(JSON.stringify(body)).not.toContain(rawRecipient);
    expect(JSON.stringify(body)).not.toContain(rawText);
  });

  it("rejects unauthorized HTTP bridge requests without executing the transport", async () => {
    const transport = new InMemoryProviderCommandTransport({
      handler: () => {
        throw new Error("transport must not run for unauthorized bridge requests");
      },
    });
    const handle = await startProviderRuntimeCommandBridgeHttpServer(transport, {
      OMNIWA_PROVIDER_COMMAND_BRIDGE_HTTP: "1",
      OMNIWA_PROVIDER_COMMAND_BRIDGE_HOST: "127.0.0.1",
      OMNIWA_PROVIDER_COMMAND_BRIDGE_PORT: "0",
      OMNIWA_PROVIDER_COMMAND_BRIDGE_TOKEN: bridgeToken,
    });
    openServers.push(handle);

    const response = await fetch(
      `http://127.0.0.1:${handle.status.port}${providerCommandBridgeHttpPath}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [providerCommandBridgeTokenHeader]: "wrong-token",
        },
        body: JSON.stringify({
          command,
          context,
        }),
      },
    );
    const body = asRecord(await response.json());

    expect(response.status).toBe(401);
    expect(body.ok).toBe(false);
    expect(body.error).toMatchObject({
      code: "provider_command_bridge_unauthorized",
      retryable: false,
    });
    expect(transport.commands()).toHaveLength(0);
    expect(JSON.stringify(body)).not.toContain(rawRecipient);
    expect(JSON.stringify(body)).not.toContain(rawText);
  });

  it("is wired into the provider runtime process entrypoint status output", () => {
    const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

    expect(source).toContain("startProviderRuntimeCommandBridgeHttpServer");
    expect(source).toContain("commandBridgeHttpServer: commandBridgeHttpServer.status");
    expect(source).not.toContain(rawRecipient);
    expect(source).not.toContain(rawText);
  });
});

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Expected JSON object response.");
  }

  return value as Record<string, unknown>;
}
