import { createHash, timingSafeEqual } from "node:crypto";

import {
  createApplicationPortFailure,
  type ApplicationPortContext,
  type ApplicationPortFailure,
  type ApplicationPortResult,
} from "@omniwa/application";
import {
  createCorrelationId,
  createRequestContext,
  createRequestId,
  createTraceId,
  err,
  ok,
} from "@omniwa/shared";

import type {
  ProviderCommand,
  ProviderCommandOutcome,
  ProviderCommandTransport,
} from "./provider-command-transport.js";

export const providerCommandBridgeHttpPath = "/internal/provider-command/v1/commands";
export const providerCommandBridgeTokenHeader = "x-omniwa-provider-bridge-token";

export type ProviderCommandHttpFetchRequestInit = Readonly<{
  method: "POST";
  headers: Readonly<Record<string, string>>;
  body: string;
  signal: AbortSignal;
}>;

export type ProviderCommandHttpFetchResponse = Readonly<{
  status: number;
  json(): Promise<unknown> | unknown;
}>;

export type ProviderCommandHttpFetch = (
  url: string,
  init: ProviderCommandHttpFetchRequestInit,
) => Promise<ProviderCommandHttpFetchResponse> | ProviderCommandHttpFetchResponse;

export type FetchProviderCommandTransportOptions = Readonly<{
  endpointUrl: string;
  bridgeToken: string;
  timeoutMilliseconds?: number;
  fetch?: ProviderCommandHttpFetch;
}>;

export class FetchProviderCommandTransport implements ProviderCommandTransport {
  #bridgeToken: string;

  private readonly endpointUrl: string;
  private readonly timeoutMilliseconds: number;
  private readonly fetch: ProviderCommandHttpFetch;

  constructor(options: FetchProviderCommandTransportOptions) {
    this.endpointUrl = normalizeEndpointUrl(options.endpointUrl);
    this.#bridgeToken = normalizeBridgeToken(options.bridgeToken);
    this.timeoutMilliseconds = options.timeoutMilliseconds ?? 5_000;
    this.fetch = options.fetch ?? defaultFetch;

    if (!Number.isSafeInteger(this.timeoutMilliseconds) || this.timeoutMilliseconds <= 0) {
      throw new TypeError("Provider command bridge timeout must be a positive integer.");
    }
  }

  async execute(
    command: ProviderCommand,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<ProviderCommandOutcome>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMilliseconds);

    try {
      const response = await this.fetch(this.endpointUrl, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          [providerCommandBridgeTokenHeader]: this.#bridgeToken,
          "x-correlation-id": String(context.requestContext.correlationId),
          ...(context.requestContext.requestId === undefined
            ? {}
            : { "x-request-id": String(context.requestContext.requestId) }),
        },
        body: JSON.stringify({
          command,
          context: contextPayload(context),
        }),
        signal: controller.signal,
      });
      const body = await response.json();
      const result = parseResultBody(body);

      if (result === undefined) {
        return err(
          failure({
            code: "provider_command_bridge_invalid_response",
            message: "Provider command bridge returned an invalid response.",
            retryable: response.status >= 500,
          }),
        );
      }

      if (response.status < 200 || response.status >= 300) {
        return result.ok
          ? err(
              failure({
                code: "provider_command_bridge_http_error",
                message: "Provider command bridge returned an unsuccessful status.",
                retryable: response.status >= 500,
              }),
            )
          : result;
      }

      return result;
    } catch (error) {
      return err(fetchFailure(error));
    } finally {
      clearTimeout(timeout);
    }
  }
}

export type ProviderCommandHttpRequest = Readonly<{
  method: string;
  path: string;
  headers: Readonly<Record<string, string | undefined>>;
  body: unknown;
}>;

export type ProviderCommandHttpResponse = Readonly<{
  status: number;
  headers: Readonly<Record<string, string>>;
  body: ApplicationPortResult<ProviderCommandOutcome>;
}>;

export type ProviderCommandHttpHandlerOptions = Readonly<{
  transport: ProviderCommandTransport;
  bridgeToken: string;
  path?: string;
}>;

export class ProviderCommandHttpHandler {
  #bridgeToken: string;

  private readonly transport: ProviderCommandTransport;
  private readonly path: string;

  constructor(options: ProviderCommandHttpHandlerOptions) {
    this.transport = options.transport;
    this.#bridgeToken = normalizeBridgeToken(options.bridgeToken);
    this.path = options.path ?? providerCommandBridgeHttpPath;
  }

  async handle(request: ProviderCommandHttpRequest): Promise<ProviderCommandHttpResponse> {
    if (request.path !== this.path) {
      return response(
        404,
        err(
          failure({
            code: "provider_command_bridge_route_not_found",
            message: "Provider command bridge route was not found.",
            retryable: false,
          }),
        ),
      );
    }

    if (request.method.toUpperCase() !== "POST") {
      return response(
        405,
        err(
          failure({
            code: "provider_command_bridge_method_not_allowed",
            message: "Provider command bridge requires POST.",
            retryable: false,
          }),
        ),
      );
    }

    if (!authorized(request.headers, this.#bridgeToken)) {
      return response(
        401,
        err(
          failure({
            code: "provider_command_bridge_unauthorized",
            message: "Provider command bridge authentication failed.",
            retryable: false,
          }),
        ),
      );
    }

    const body = parseRequestBody(request.body);

    if (body === undefined) {
      return response(
        400,
        err(
          failure({
            code: "provider_command_bridge_request_invalid",
            message: "Provider command bridge request is invalid.",
            retryable: false,
          }),
        ),
      );
    }

    const result = await this.transport.execute(body.command, body.context);

    return response(result.ok ? 200 : statusForFailure(result.error), result);
  }
}

type ProviderCommandHttpRequestBody = Readonly<{
  command: ProviderCommand;
  context: ApplicationPortContext;
}>;

function normalizeEndpointUrl(endpointUrl: string): string {
  const normalized = endpointUrl.trim();

  if (normalized.length === 0) {
    throw new TypeError("Provider command bridge endpoint URL must not be empty.");
  }

  const url = new URL(normalized);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError("Provider command bridge endpoint URL must use HTTP or HTTPS.");
  }

  return url.toString();
}

function normalizeBridgeToken(token: string): string {
  const normalized = token.trim();

  if (normalized.length === 0) {
    throw new TypeError("Provider command bridge token must not be empty.");
  }

  return normalized;
}

function defaultFetch(
  url: string,
  init: ProviderCommandHttpFetchRequestInit,
): Promise<ProviderCommandHttpFetchResponse> {
  if (typeof globalThis.fetch !== "function") {
    return Promise.reject(new Error("Provider command bridge fetch runtime is unavailable."));
  }

  return globalThis.fetch(url, init) as Promise<ProviderCommandHttpFetchResponse>;
}

function parseRequestBody(body: unknown): ProviderCommandHttpRequestBody | undefined {
  const parsed = typeof body === "string" ? parseJson(body) : body;

  if (!isRecord(parsed)) {
    return undefined;
  }

  const command = parseProviderCommand(parsed.command);
  const context = parseApplicationPortContext(parsed.context);

  if (command === undefined || context === undefined) {
    return undefined;
  }

  return Object.freeze({
    command,
    context,
  });
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function parseResultBody(body: unknown): ApplicationPortResult<ProviderCommandOutcome> | undefined {
  if (!isRecord(body) || typeof body.ok !== "boolean") {
    return undefined;
  }

  if (body.ok) {
    return "value" in body ? ok(body.value as ProviderCommandOutcome) : undefined;
  }

  return isApplicationPortFailure(body.error) ? err(body.error) : undefined;
}

function parseProviderCommand(value: unknown): ProviderCommand | undefined {
  if (!isRecord(value) || typeof value.commandId !== "string") {
    return undefined;
  }

  switch (value.kind) {
    case "request_connection":
    case "request_qr_pairing":
    case "disconnect":
    case "send_outbound_message":
      return isRecord(value.request) ? (value as ProviderCommand) : undefined;
    case "get_capability_summary":
      return typeof value.providerId === "string" ? (value as ProviderCommand) : undefined;
    default:
      return undefined;
  }
}

function parseApplicationPortContext(value: unknown): ApplicationPortContext | undefined {
  if (!isRecord(value) || !isRecord(value.requestContext)) {
    return undefined;
  }

  const correlationId = value.requestContext.correlationId;
  const requestId = value.requestContext.requestId;
  const traceId = value.requestContext.traceId;

  if (typeof correlationId !== "string") {
    return undefined;
  }

  try {
    return Object.freeze({
      requestContext: createRequestContext({
        correlationId: createCorrelationId(correlationId),
        ...(typeof requestId === "string" ? { requestId: createRequestId(requestId) } : {}),
        ...(typeof traceId === "string" ? { traceId: createTraceId(traceId) } : {}),
      }),
      ...(typeof value.actorRef === "string" ? { actorRef: value.actorRef } : {}),
      ...(typeof value.idempotencyKey === "string" ? { idempotencyKey: value.idempotencyKey } : {}),
      ...(isDataClassification(value.dataClassification)
        ? { dataClassification: value.dataClassification }
        : {}),
    });
  } catch {
    return undefined;
  }
}

function contextPayload(context: ApplicationPortContext): Record<string, unknown> {
  return {
    requestContext: {
      correlationId: String(context.requestContext.correlationId),
      ...(context.requestContext.requestId === undefined
        ? {}
        : { requestId: String(context.requestContext.requestId) }),
      ...(context.requestContext.traceId === undefined
        ? {}
        : { traceId: String(context.requestContext.traceId) }),
    },
    ...(context.actorRef === undefined ? {} : { actorRef: context.actorRef }),
    ...(context.idempotencyKey === undefined ? {} : { idempotencyKey: context.idempotencyKey }),
    ...(context.dataClassification === undefined
      ? {}
      : { dataClassification: context.dataClassification }),
  };
}

function authorized(
  headers: Readonly<Record<string, string | undefined>>,
  expectedToken: string,
): boolean {
  const actual = readHeader(headers, providerCommandBridgeTokenHeader);

  if (actual === undefined) {
    return false;
  }

  return digestEquals(actual, expectedToken);
}

function readHeader(
  headers: Readonly<Record<string, string | undefined>>,
  name: string,
): string | undefined {
  const lower = name.toLowerCase();

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) {
      return value;
    }
  }

  return undefined;
}

function digestEquals(actual: string, expected: string): boolean {
  const actualDigest = createHash("sha256").update(actual, "utf8").digest();
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();

  return timingSafeEqual(actualDigest, expectedDigest);
}

function response(
  status: number,
  body: ApplicationPortResult<ProviderCommandOutcome>,
): ProviderCommandHttpResponse {
  return Object.freeze({
    status,
    headers: Object.freeze({
      "content-type": "application/json",
    }),
    body,
  });
}

function statusForFailure(error: ApplicationPortFailure): number {
  switch (error.category) {
    case "timeout":
      return 504;
    case "unavailable":
      return 503;
    case "conflict":
      return 409;
    case "rejected":
    case "unsafe_payload":
    case "unsupported":
      return 400;
    case "unknown":
      return 500;
  }
}

function fetchFailure(error: unknown): ApplicationPortFailure {
  if (isAbortError(error)) {
    return failure({
      code: "provider_command_bridge_timeout",
      message: "Provider command bridge request timed out.",
      retryable: true,
    });
  }

  return failure({
    code: "provider_command_bridge_unavailable",
    message: "Provider command bridge is unavailable.",
    retryable: true,
  });
}

function failure(input: Readonly<{ code: string; message: string; retryable: boolean }>) {
  return createApplicationPortFailure({
    category: input.retryable ? "unavailable" : "rejected",
    code: input.code,
    message: input.message,
    retryable: input.retryable,
    ownerContext: "provider_integration",
    failureCategory: input.retryable ? "network" : "configuration",
  });
}

function isApplicationPortFailure(value: unknown): value is ApplicationPortFailure {
  return (
    isRecord(value) &&
    typeof value.category === "string" &&
    typeof value.code === "string" &&
    typeof value.message === "string" &&
    typeof value.retryable === "boolean"
  );
}

function isDataClassification(
  value: unknown,
): value is NonNullable<ApplicationPortContext["dataClassification"]> {
  return (
    value === "public" || value === "internal" || value === "confidential" || value === "secret"
  );
}

function isAbortError(error: unknown): boolean {
  return isRecord(error) && error.name === "AbortError";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
