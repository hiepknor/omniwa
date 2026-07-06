import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import {
  ProviderCommandHttpHandler,
  providerCommandBridgeHttpPath,
  type ProviderCommandHttpRequest,
  type ProviderCommandTransport,
} from "@omniwa/infrastructure-provider-bridge";

export type ProviderRuntimeCommandBridgeHttpServerConfig =
  | Readonly<{
      enabled: false;
      reasonCode: "provider_command_bridge_http_disabled" | "provider_command_bridge_token_missing";
    }>
  | Readonly<{
      enabled: true;
      host: string;
      port: number;
      token: string;
      reasonCode: "provider_command_bridge_http_enabled";
    }>;

export type ProviderRuntimeCommandBridgeHttpServerStatus = Readonly<{
  attempted: boolean;
  started: boolean;
  reasonCode: string;
  host?: string;
  port?: number;
  errorCode?: string;
}>;

export type ProviderRuntimeCommandBridgeHttpServerHandle = Readonly<{
  status: ProviderRuntimeCommandBridgeHttpServerStatus;
  server?: Server;
  stop(): Promise<void>;
}>;

const maxRequestBodyBytes = 64 * 1024;

export async function startProviderRuntimeCommandBridgeHttpServer(
  transport: ProviderCommandTransport | undefined,
  env: NodeJS.ProcessEnv,
): Promise<ProviderRuntimeCommandBridgeHttpServerHandle> {
  const config = readProviderRuntimeCommandBridgeHttpServerConfig(env);

  if (!config.enabled) {
    return noServerStatus(config.reasonCode, false);
  }

  if (transport === undefined) {
    return noServerStatus("provider_command_bridge_transport_missing", false);
  }

  const handler = new ProviderCommandHttpHandler({
    bridgeToken: config.token,
    transport,
  });
  const server = createServer(async (request, response) => {
    const bridgeResponse = await handler.handle(await readProviderCommandRequest(request));

    writeProviderCommandResponse(response, bridgeResponse.status, bridgeResponse.body);
  });

  try {
    const actualPort = await listen(server, config.port, config.host);

    return Object.freeze({
      status: Object.freeze({
        attempted: true,
        started: true,
        reasonCode: "provider_command_bridge_http_started",
        host: config.host,
        port: actualPort,
      }),
      server,
      stop: () => closeServer(server),
    });
  } catch {
    return Object.freeze({
      status: Object.freeze({
        attempted: true,
        started: false,
        reasonCode: "provider_command_bridge_http_start_failed",
        host: config.host,
        port: config.port,
        errorCode: "provider_command_bridge_http_start_failed",
      }),
      stop: () => closeServer(server),
    });
  }
}

export function readProviderRuntimeCommandBridgeHttpServerConfig(
  env: NodeJS.ProcessEnv,
): ProviderRuntimeCommandBridgeHttpServerConfig {
  if (!readBooleanEnv(env.OMNIWA_PROVIDER_COMMAND_BRIDGE_HTTP)) {
    return Object.freeze({
      enabled: false,
      reasonCode: "provider_command_bridge_http_disabled",
    });
  }

  const token = readOptionalEnvValue(env, "OMNIWA_PROVIDER_COMMAND_BRIDGE_TOKEN");

  if (token === undefined) {
    return Object.freeze({
      enabled: false,
      reasonCode: "provider_command_bridge_token_missing",
    });
  }

  return Object.freeze({
    enabled: true,
    host: readOptionalEnvValue(env, "OMNIWA_PROVIDER_COMMAND_BRIDGE_HOST") ?? "127.0.0.1",
    port: readPortEnv(env.OMNIWA_PROVIDER_COMMAND_BRIDGE_PORT, 3011),
    token,
    reasonCode: "provider_command_bridge_http_enabled",
  });
}

function noServerStatus(
  reasonCode: string,
  attempted: boolean,
): ProviderRuntimeCommandBridgeHttpServerHandle {
  return Object.freeze({
    status: Object.freeze({
      attempted,
      started: false,
      reasonCode,
    }),
    stop: () => Promise.resolve(),
  });
}

async function readProviderCommandRequest(
  request: IncomingMessage,
): Promise<ProviderCommandHttpRequest> {
  const body = await readJsonBody(request);
  const path = new URL(request.url ?? providerCommandBridgeHttpPath, "http://provider-runtime")
    .pathname;

  return Object.freeze({
    method: request.method ?? "GET",
    path,
    headers: normalizeHeaders(request.headers),
    body,
  });
}

function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let received = 0;

    request.on("data", (chunk: Buffer) => {
      received += chunk.length;

      if (received > maxRequestBodyBytes) {
        request.destroy();
        resolve(undefined);
        return;
      }

      chunks.push(chunk);
    });
    request.on("end", () => {
      if (chunks.length === 0) {
        resolve(undefined);
        return;
      }

      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        resolve(undefined);
      }
    });
    request.on("error", () => resolve(undefined));
  });
}

function writeProviderCommandResponse(
  response: ServerResponse,
  status: number,
  body: unknown,
): void {
  response.writeHead(status, {
    "content-type": "application/json",
  });
  response.end(JSON.stringify(body));
}

function listen(server: Server, port: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      const address = server.address();

      resolve(typeof address === "object" && address !== null ? address.port : port);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  if (!server.listening) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function normalizeHeaders(
  headers: IncomingMessage["headers"],
): Readonly<Record<string, string | undefined>> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(headers).map(([key, value]) => [
        key,
        Array.isArray(value) ? value.join(",") : value,
      ]),
    ),
  );
}

function readBooleanEnv(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();

  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function readPortEnv(value: string | undefined, fallback: number): number {
  const normalized = value?.trim();

  if (normalized === undefined || normalized.length === 0) {
    return fallback;
  }

  const parsed = Number.parseInt(normalized, 10);

  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 65_535) {
    throw new Error("OMNIWA_PROVIDER_COMMAND_BRIDGE_PORT must be a valid TCP port.");
  }

  return parsed;
}

function readOptionalEnvValue(
  env: NodeJS.ProcessEnv,
  key: "OMNIWA_PROVIDER_COMMAND_BRIDGE_HOST" | "OMNIWA_PROVIDER_COMMAND_BRIDGE_TOKEN",
): string | undefined {
  const value = env[key]?.trim();

  return value === undefined || value.length === 0 ? undefined : value;
}
