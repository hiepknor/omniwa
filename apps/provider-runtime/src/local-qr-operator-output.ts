import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import type {
  BaileysQrCodeOperatorEvent,
  BaileysQrCodeOperatorSink,
} from "@omniwa/infrastructure-provider-baileys";

export const localQrOperatorOutputModes = ["disabled", "file"] as const;

export type LocalQrOperatorOutputMode = (typeof localQrOperatorOutputModes)[number];

export type LocalQrOperatorOutputConfig = Readonly<{
  mode: LocalQrOperatorOutputMode;
  filePath?: string;
}>;

export type LocalQrOperatorOutputRecord = Readonly<{
  version: 1;
  localOnly: true;
  dataClassification: "secret";
  providerId: string;
  instanceId: string;
  sessionId?: string;
  challengeRef: string;
  expiresAtEpochMilliseconds: number;
  updatedAtEpochMilliseconds: number;
  qrCode: string;
}>;

export function readLocalQrOperatorOutputConfig(
  env: NodeJS.ProcessEnv = process.env,
  stateDirectory = resolve(".omniwa-local/state"),
): LocalQrOperatorOutputConfig {
  const modeValue = env.OMNIWA_LOCAL_QR_OUTPUT?.trim().toLowerCase();
  const mode = localQrOperatorOutputModeFrom(modeValue);

  if (mode === "disabled") {
    return Object.freeze({ mode });
  }

  const explicitPath = env.OMNIWA_LOCAL_QR_OUTPUT_PATH?.trim();

  return Object.freeze({
    mode,
    filePath: resolve(
      explicitPath === undefined || explicitPath.length === 0
        ? join(stateDirectory, "provider-runtime", "local-qr.secret.json")
        : explicitPath,
    ),
  });
}

export function createLocalQrOperatorSink(
  config: LocalQrOperatorOutputConfig,
  nowEpochMilliseconds: () => number = Date.now,
): BaileysQrCodeOperatorSink | undefined {
  if (config.mode === "disabled") {
    return undefined;
  }

  const filePath = config.filePath;

  if (filePath === undefined) {
    throw new Error("Local QR operator file output requires a file path.");
  }

  return Object.freeze({
    captureQrCode(event): void {
      const record = localQrOperatorOutputRecord(event, nowEpochMilliseconds());

      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, `${JSON.stringify(record, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
    },
  });
}

function localQrOperatorOutputModeFrom(value: string | undefined): LocalQrOperatorOutputMode {
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
      throw new Error("Unsupported OmniWA local QR operator output mode.");
  }
}

function localQrOperatorOutputRecord(
  event: BaileysQrCodeOperatorEvent,
  updatedAtEpochMilliseconds: number,
): LocalQrOperatorOutputRecord {
  return Object.freeze({
    version: 1,
    localOnly: true,
    dataClassification: "secret",
    providerId: String(event.providerId),
    instanceId: String(event.instanceId),
    ...(event.sessionId === undefined ? {} : { sessionId: String(event.sessionId) }),
    challengeRef: event.challengeRef,
    expiresAtEpochMilliseconds: event.expiresAtEpochMilliseconds,
    updatedAtEpochMilliseconds,
    qrCode: event.qrCode,
  });
}
