import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { type ApplicationPortContext, type TranslatedProviderSignal } from "@omniwa/application";
import { createInstanceId, createProviderId, createSessionId } from "@omniwa/domain";
import { createCorrelationId, createRequestContext, createRequestId } from "@omniwa/shared";
import { describe, expect, it } from "vitest";

import { BaileysProviderError } from "./baileys-messaging-provider.adapter.js";
import {
  FakeBaileysSocket,
  FakeBaileysSocketProvider,
  type BaileysSocketRequest,
} from "./baileys-socket-provider.js";

const instanceId = createInstanceId("instance_socket_provider_1");
const providerId = createProviderId("provider.baileys");
const sessionId = createSessionId("session_socket_provider_1");
const context: ApplicationPortContext = {
  requestContext: createRequestContext({
    correlationId: createCorrelationId("socket-provider-correlation"),
    requestId: createRequestId("socket-provider-request"),
  }),
  actorRef: "provider-runtime.socket-provider",
  dataClassification: "internal",
};

describe("Baileys socket provider contract", () => {
  it("returns a fake socket by instance/session", () => {
    const provider = new FakeBaileysSocketProvider();
    const socket = new FakeBaileysSocket();

    provider.registerSocket(socketRequest(), socket);

    expect(provider.getSocket(socketRequest(), context)).toBe(socket);
  });

  it("returns safe errors when a socket is missing", () => {
    const provider = new FakeBaileysSocketProvider();

    let caught: unknown;

    try {
      provider.getSocket(socketRequest(), context);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(BaileysProviderError);
    expect(caught).toMatchObject({
      code: "baileys_socket_missing",
      category: "rejected",
      failureCategory: "provider",
      retryable: false,
      message: "Baileys socket is not available for the requested session.",
    });
    expect(String(caught)).not.toContain(String(sessionId));
  });

  it("emits QR, connected, and disconnected lifecycle signals without raw provider payloads", async () => {
    const provider = new FakeBaileysSocketProvider();
    const request = socketRequest();

    const started = provider.startSession(request, context);
    const qr = provider.emitQrRequired(request, context, {
      qr: "raw-qr-secret-token",
      phone: "12025550123@s.whatsapp.net",
    });
    const connected = provider.emitConnected(request, context);
    const disconnected = provider.emitDisconnected(request, context);
    const closed = await provider.closeSession(request, context);

    expect([...started, qr, connected, disconnected, ...closed].map(signalSummary)).toEqual([
      {
        kind: "connection",
        signalRef: "provider.baileys.connecting",
        targetRef: sessionId,
        dataClassification: "internal",
      },
      {
        kind: "auth",
        signalRef: "provider.baileys.qr_required",
        targetRef: sessionId,
        dataClassification: "confidential",
      },
      {
        kind: "connection",
        signalRef: "provider.baileys.connected",
        targetRef: sessionId,
        dataClassification: "internal",
      },
      {
        kind: "connection",
        signalRef: "provider.baileys.disconnected",
        targetRef: sessionId,
        dataClassification: "internal",
      },
      {
        kind: "connection",
        signalRef: "provider.baileys.disconnected",
        targetRef: sessionId,
        dataClassification: "internal",
      },
    ]);

    const drained = provider.drainSignals({ sessionId });

    expect(drained).toHaveLength(5);
    expect(JSON.stringify(drained)).not.toContain("raw-qr-secret-token");
    expect(JSON.stringify(drained)).not.toContain("12025550123");
  });

  it("maps provider-native errors to safe BaileysProviderError values", () => {
    const provider = new FakeBaileysSocketProvider();
    const rawError = Object.assign(new Error("raw provider payload with session-secret-token"), {
      output: { statusCode: 503 },
    });
    provider.failNextGetSocket(rawError);

    let caught: unknown;

    try {
      provider.getSocket(socketRequest(), context);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(BaileysProviderError);
    expect(caught).toMatchObject({
      code: "baileys_socket_provider_failure",
      category: "unavailable",
      failureCategory: "network",
      retryable: true,
      message: "Baileys socket provider failed with a sanitized provider error.",
    });
    expect(String(caught)).not.toContain("session-secret-token");
    expect(JSON.stringify(caught)).not.toContain("session-secret-token");
  });

  it("keeps direct Baileys imports isolated to infrastructure-provider-baileys", () => {
    const offenders = findWorkspaceSourceFiles()
      .filter((filePath) => !filePath.includes("packages/infrastructure-provider-baileys/"))
      .filter((filePath) => readFileSync(filePath, "utf8").includes("@whiskeysockets/baileys"))
      .map((filePath) => relative(process.cwd(), filePath));

    expect(offenders).toEqual([]);
  });
});

function socketRequest(): BaileysSocketRequest {
  return {
    instanceId,
    providerId,
    sessionId,
    reasonCode: "socket_provider_test",
  };
}

function signalSummary(
  signal: TranslatedProviderSignal,
): Pick<TranslatedProviderSignal, "kind" | "signalRef" | "targetRef" | "dataClassification"> {
  return {
    kind: signal.kind,
    signalRef: signal.signalRef,
    targetRef: signal.targetRef,
    dataClassification: signal.dataClassification,
  };
}

function findWorkspaceSourceFiles(): string[] {
  return ["apps", "packages", "tooling"].flatMap((root) => {
    const rootPath = join(process.cwd(), root);
    return existsSync(rootPath) ? findFiles(rootPath) : [];
  });
}

function findFiles(rootPath: string): string[] {
  const entries = readdirSync(rootPath);
  const output: string[] = [];

  for (const entry of entries) {
    const entryPath = join(rootPath, entry);

    if (entry === "node_modules" || entry === "dist" || entry === ".turbo") {
      continue;
    }

    const stats = statSync(entryPath);
    if (stats.isDirectory()) {
      output.push(...findFiles(entryPath));
      continue;
    }

    if (/\.(?:ts|tsx|js|mjs|json)$/.test(entry)) {
      output.push(entryPath);
    }
  }

  return output;
}
