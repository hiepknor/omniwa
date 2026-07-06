import type { ApplicationPortContext } from "@omniwa/application";
import {
  createInstanceId,
  createMessageId,
  createProviderId,
  createSessionId,
} from "@omniwa/domain";
import { createCorrelationId, createRequestContext, createRequestId, ok } from "@omniwa/shared";
import { describe, expect, it } from "vitest";

import {
  FetchProviderCommandTransport,
  InMemoryProviderCommandTransport,
  ProviderCommandHttpHandler,
  providerCommandBridgeHttpPath,
  providerCommandBridgeTokenHeader,
  type ProviderCommand,
  type ProviderCommandHttpFetch,
  type ProviderCommandHttpFetchRequestInit,
  type ProviderCommandHttpRequest,
} from "./index.js";

const bridgeToken = "provider-runtime-bridge-token";
const instanceId = createInstanceId("instance.bridge-http-test");
const providerId = createProviderId("baileys");
const sessionId = createSessionId("session.bridge-http-test");
const messageId = createMessageId("message.bridge-http-test");
const rawRecipient = "12025550199@s.whatsapp.net";
const rawText = "private bridge text";
const outboundIntentRef = "outbound.intent.safe-ref";
const command: ProviderCommand = Object.freeze({
  kind: "send_outbound_message",
  commandId: "send_outbound_message:bridge-http-test",
  request: {
    idempotencyKey: "bridge-http-test",
    instanceId,
    messageId,
    messageType: "text" as const,
    outboundIntentRef,
    providerId,
    sessionId,
  },
});
const context: ApplicationPortContext = {
  actorRef: "worker",
  dataClassification: "internal",
  idempotencyKey: "bridge-http-test",
  requestContext: createRequestContext({
    correlationId: createCorrelationId("bridge-http-correlation"),
    requestId: createRequestId("bridge-http-request"),
  }),
};

describe("Provider command HTTP bridge", () => {
  it("posts safe commands with internal auth and request correlation headers", async () => {
    const requests: Array<{ url: string; init: ProviderCommandHttpFetchRequestInit }> = [];
    const fetch: ProviderCommandHttpFetch = (url, init) => {
      requests.push({ url, init });

      return {
        status: 200,
        json: () =>
          ok({
            kind: "send_outbound_message",
            result: {
              messageId,
              providerReceiptRef: "receipt.safe-ref",
              retryable: false,
              status: "accepted",
            },
          }),
      };
    };
    const transport = new FetchProviderCommandTransport({
      endpointUrl: "http://provider-runtime.internal/internal/provider-command/v1/commands",
      bridgeToken,
      fetch,
    });

    const result = await transport.execute(command, context);

    expect(result).toEqual(
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
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(
      "http://provider-runtime.internal/internal/provider-command/v1/commands",
    );
    expect(requests[0]?.init.headers).toMatchObject({
      [providerCommandBridgeTokenHeader]: bridgeToken,
      "x-correlation-id": "bridge-http-correlation",
      "x-request-id": "bridge-http-request",
    });
    expect(JSON.stringify(requests[0]?.init.body)).not.toContain(rawRecipient);
    expect(JSON.stringify(requests[0]?.init.body)).not.toContain(rawText);
  });

  it("requires an internal bridge token before executing provider commands", async () => {
    const transport = new InMemoryProviderCommandTransport({
      handler: () => {
        throw new Error("handler must not run without auth");
      },
    });
    const handler = new ProviderCommandHttpHandler({
      transport,
      bridgeToken,
    });

    const response = await handler.handle(httpRequest({ token: "wrong-token" }));

    expect(response.status).toBe(401);
    expect(response.body.ok).toBe(false);
    expect(response.body.ok ? undefined : response.body.error).toMatchObject({
      code: "provider_command_bridge_unauthorized",
      retryable: false,
      ownerContext: "provider_integration",
      failureCategory: "configuration",
    });
    expect(transport.commands()).toHaveLength(0);
    expect(JSON.stringify(response)).not.toContain(rawRecipient);
    expect(JSON.stringify(response)).not.toContain(rawText);
  });

  it("executes authorized HTTP bridge requests through the injected transport", async () => {
    const transport = new InMemoryProviderCommandTransport({
      handler: (receivedCommand, receivedContext) => {
        expect(receivedCommand).toMatchObject({
          kind: "send_outbound_message",
          commandId: command.commandId,
        });
        expect(receivedContext.requestContext.correlationId).toBe(
          context.requestContext.correlationId,
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
    const handler = new ProviderCommandHttpHandler({
      transport,
      bridgeToken,
    });

    const response = await handler.handle(httpRequest());

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
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
    expect(JSON.stringify(response)).not.toContain(rawRecipient);
    expect(JSON.stringify(response)).not.toContain(rawText);
  });

  it("rejects malformed HTTP bridge requests safely", async () => {
    const transport = new InMemoryProviderCommandTransport({
      handler: () => {
        throw new Error("handler must not run for malformed request");
      },
    });
    const handler = new ProviderCommandHttpHandler({
      transport,
      bridgeToken,
    });

    const response = await handler.handle(
      httpRequest({
        body: {
          command: {
            kind: "send_outbound_message",
            commandId: command.commandId,
          },
          context,
        },
      }),
    );

    expect(response.status).toBe(400);
    expect(response.body.ok).toBe(false);
    expect(response.body.ok ? undefined : response.body.error.code).toBe(
      "provider_command_bridge_request_invalid",
    );
    expect(transport.commands()).toHaveLength(0);
    expect(JSON.stringify(response)).not.toContain(rawRecipient);
    expect(JSON.stringify(response)).not.toContain(rawText);
  });

  it("maps unsuccessful HTTP responses to safe provider command failures", async () => {
    const transport = new FetchProviderCommandTransport({
      endpointUrl: "http://provider-runtime.internal/internal/provider-command/v1/commands",
      bridgeToken,
      fetch: () => ({
        status: 401,
        json: () => ({
          ok: false,
          error: {
            category: "rejected",
            code: "provider_command_bridge_unauthorized",
            message: "Provider command bridge authentication failed.",
            retryable: false,
          },
        }),
      }),
    });

    const result = await transport.execute(command, context);

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe("provider_command_bridge_unauthorized");
    expect(JSON.stringify(result)).not.toContain(rawRecipient);
    expect(JSON.stringify(result)).not.toContain(rawText);
  });

  it("maps timeout and network failures safely", async () => {
    const timeoutTransport = new FetchProviderCommandTransport({
      endpointUrl: "http://provider-runtime.internal/internal/provider-command/v1/commands",
      bridgeToken,
      fetch: () => {
        throw Object.assign(new Error("raw network timeout with private text"), {
          name: "AbortError",
        });
      },
    });
    const networkTransport = new FetchProviderCommandTransport({
      endpointUrl: "http://provider-runtime.internal/internal/provider-command/v1/commands",
      bridgeToken,
      fetch: () => {
        throw new Error("raw network failure with private text");
      },
    });

    const timeout = await timeoutTransport.execute(command, context);
    const network = await networkTransport.execute(command, context);

    expect(timeout.ok ? undefined : timeout.error).toMatchObject({
      code: "provider_command_bridge_timeout",
      retryable: true,
    });
    expect(network.ok ? undefined : network.error).toMatchObject({
      code: "provider_command_bridge_unavailable",
      retryable: true,
    });
    expect(JSON.stringify(timeout)).not.toContain("private text");
    expect(JSON.stringify(network)).not.toContain("private text");
  });
});

function httpRequest(
  options: Readonly<{
    token?: string;
    body?: unknown;
  }> = {},
): ProviderCommandHttpRequest {
  return Object.freeze({
    method: "POST",
    path: providerCommandBridgeHttpPath,
    headers: Object.freeze({
      [providerCommandBridgeTokenHeader]: options.token ?? bridgeToken,
    }),
    body:
      options.body ??
      Object.freeze({
        command,
        context,
      }),
  });
}
