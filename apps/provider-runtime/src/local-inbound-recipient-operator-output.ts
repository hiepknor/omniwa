import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import type {
  BaileysInboundRecipientOperatorEvent,
  BaileysInboundRecipientOperatorSink,
} from "@omniwa/infrastructure-provider-baileys";

export const localInboundRecipientOperatorOutputModes = ["disabled", "file"] as const;

export type LocalInboundRecipientOperatorOutputMode =
  (typeof localInboundRecipientOperatorOutputModes)[number];

export type LocalInboundRecipientOperatorOutputConfig = Readonly<{
  mode: LocalInboundRecipientOperatorOutputMode;
  filePath?: string;
}>;

export type LocalInboundRecipientOperatorOutputRecord = Readonly<{
  version: 1;
  localOnly: true;
  dataClassification: "secret";
  providerId: string;
  instanceId: string;
  sessionId?: string;
  conversationRef: string;
  conversationKind: "private" | "group" | "unknown";
  occurredAt: string;
  updatedAtEpochMilliseconds: number;
  recipientJid: string;
}>;

export function readLocalInboundRecipientOperatorOutputConfig(
  env: NodeJS.ProcessEnv = process.env,
  stateDirectory = resolve(".omniwa-local/state"),
): LocalInboundRecipientOperatorOutputConfig {
  const modeValue = env.OMNIWA_LOCAL_INBOUND_RECIPIENT_OUTPUT?.trim().toLowerCase();
  const mode = localInboundRecipientOperatorOutputModeFrom(modeValue);

  if (mode === "disabled") {
    return Object.freeze({ mode });
  }

  const explicitPath = env.OMNIWA_LOCAL_INBOUND_RECIPIENT_OUTPUT_PATH?.trim();

  return Object.freeze({
    mode,
    filePath: resolve(
      explicitPath === undefined || explicitPath.length === 0
        ? join(stateDirectory, "provider-runtime", "local-inbound-recipient.secret.json")
        : explicitPath,
    ),
  });
}

export function createLocalInboundRecipientOperatorSink(
  config: LocalInboundRecipientOperatorOutputConfig,
  nowEpochMilliseconds: () => number = Date.now,
): BaileysInboundRecipientOperatorSink | undefined {
  if (config.mode === "disabled") {
    return undefined;
  }

  const filePath = config.filePath;

  if (filePath === undefined) {
    throw new Error("Local inbound recipient operator file output requires a file path.");
  }

  return Object.freeze({
    captureInboundRecipient(event): void {
      const record = localInboundRecipientOperatorOutputRecord(event, nowEpochMilliseconds());

      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, `${JSON.stringify(record, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
    },
  });
}

function localInboundRecipientOperatorOutputModeFrom(
  value: string | undefined,
): LocalInboundRecipientOperatorOutputMode {
  switch (value) {
    case "file":
      return "file";
    case "0":
    case "false":
    case "disabled":
    case undefined:
    case "":
      return "disabled";
    default:
      throw new Error("Unsupported OmniWA local inbound recipient operator output mode.");
  }
}

function localInboundRecipientOperatorOutputRecord(
  event: BaileysInboundRecipientOperatorEvent,
  updatedAtEpochMilliseconds: number,
): LocalInboundRecipientOperatorOutputRecord {
  return Object.freeze({
    version: 1,
    localOnly: true,
    dataClassification: "secret",
    providerId: String(event.providerId),
    instanceId: String(event.instanceId),
    ...(event.sessionId === undefined ? {} : { sessionId: String(event.sessionId) }),
    conversationRef: event.conversationRef,
    conversationKind: event.conversationKind,
    occurredAt: event.occurredAt,
    updatedAtEpochMilliseconds,
    recipientJid: event.recipientJid,
  });
}
