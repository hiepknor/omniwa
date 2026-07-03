import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createInstanceId, createProviderId, createSessionId } from "@omniwa/domain";
import { afterEach, describe, expect, it } from "vitest";

import {
  createLocalQrOperatorSink,
  readLocalQrOperatorOutputConfig,
} from "./local-qr-operator-output.js";

const temporaryDirectories: string[] = [];
const instanceId = createInstanceId("instance_local_qr_output_1");
const providerId = createProviderId("provider.baileys");
const sessionId = createSessionId("session_local_qr_output_1");
const rawQr = "raw-local-qr-secret-token";

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("local QR operator output", () => {
  it("is disabled by default", () => {
    const config = readLocalQrOperatorOutputConfig({}, createTemporaryDirectory());

    expect(config).toEqual({
      mode: "disabled",
    });
    expect(createLocalQrOperatorSink(config)).toBeUndefined();
  });

  it("writes QR only to an explicit local-only secret file output", () => {
    const stateDirectory = createTemporaryDirectory();
    const config = readLocalQrOperatorOutputConfig(
      {
        OMNIWA_LOCAL_QR_OUTPUT: "file",
      },
      stateDirectory,
    );
    const sink = createLocalQrOperatorSink(config, () => 1_804_000_000_000);

    sink?.captureQrCode({
      instanceId,
      providerId,
      sessionId,
      challengeRef: "qr_challenge_0123456789abcdef",
      expiresAtEpochMilliseconds: 1_804_000_060_000,
      qrCode: rawQr,
      dataClassification: "secret",
      localOnly: true,
    });

    expect(config).toEqual({
      mode: "file",
      filePath: join(stateDirectory, "provider-runtime", "local-qr.secret.json"),
    });

    const rawFile = readFileSync(config.filePath ?? "", "utf8");
    const record = JSON.parse(rawFile) as Record<string, unknown>;

    expect(record).toEqual({
      version: 1,
      localOnly: true,
      dataClassification: "secret",
      providerId,
      instanceId,
      sessionId,
      challengeRef: "qr_challenge_0123456789abcdef",
      expiresAtEpochMilliseconds: 1_804_000_060_000,
      updatedAtEpochMilliseconds: 1_804_000_000_000,
      qrCode: rawQr,
    });
    expect(JSON.stringify({ ...record, qrCode: undefined })).not.toContain(rawQr);
  });

  it("supports explicit QR output file paths", () => {
    const stateDirectory = createTemporaryDirectory();
    const filePath = join(stateDirectory, "operator", "qr.secret.json");

    expect(
      readLocalQrOperatorOutputConfig(
        {
          OMNIWA_LOCAL_QR_OUTPUT: "file",
          OMNIWA_LOCAL_QR_OUTPUT_PATH: filePath,
        },
        stateDirectory,
      ),
    ).toEqual({
      mode: "file",
      filePath,
    });
  });

  it("rejects unsupported modes without echoing unsafe values", () => {
    const unsafeMode = "raw-qr-secret-token-terminal";

    expect(() => readLocalQrOperatorOutputConfig({ OMNIWA_LOCAL_QR_OUTPUT: unsafeMode })).toThrow(
      "Unsupported OmniWA local QR operator output mode.",
    );
  });
});

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "omniwa-local-qr-output-"));
  temporaryDirectories.push(directory);

  return directory;
}
