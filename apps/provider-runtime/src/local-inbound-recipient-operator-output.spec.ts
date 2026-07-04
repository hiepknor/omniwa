import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createInstanceId, createProviderId, createSessionId } from "@omniwa/domain";
import { afterEach, describe, expect, it } from "vitest";

import {
  createLocalInboundRecipientOperatorSink,
  readLocalInboundRecipientOperatorOutputConfig,
} from "./local-inbound-recipient-operator-output.js";

const temporaryDirectories: string[] = [];
const instanceId = createInstanceId("instance_local_inbound_recipient_1");
const providerId = createProviderId("provider.baileys");
const sessionId = createSessionId("session_local_inbound_recipient_1");
const rawRecipientJid = "15551234567@s.whatsapp.net";

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("local inbound recipient operator output", () => {
  it("is disabled by default", () => {
    const config = readLocalInboundRecipientOperatorOutputConfig({}, createTemporaryDirectory());

    expect(config).toEqual({
      mode: "disabled",
    });
    expect(createLocalInboundRecipientOperatorSink(config)).toBeUndefined();
  });

  it("writes inbound recipient only to an explicit local-only secret file output", () => {
    const stateDirectory = createTemporaryDirectory();
    const config = readLocalInboundRecipientOperatorOutputConfig(
      {
        OMNIWA_LOCAL_INBOUND_RECIPIENT_OUTPUT: "file",
      },
      stateDirectory,
    );
    const sink = createLocalInboundRecipientOperatorSink(config, () => 1_804_000_000_000);

    sink?.captureInboundRecipient({
      instanceId,
      providerId,
      sessionId,
      conversationRef: "conversation_safe_ref",
      conversationKind: "private",
      occurredAt: "2026-07-04T00:00:00.000Z",
      recipientJid: rawRecipientJid,
      dataClassification: "secret",
      localOnly: true,
    });

    expect(config).toEqual({
      mode: "file",
      filePath: join(stateDirectory, "provider-runtime", "local-inbound-recipient.secret.json"),
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
      conversationRef: "conversation_safe_ref",
      conversationKind: "private",
      occurredAt: "2026-07-04T00:00:00.000Z",
      updatedAtEpochMilliseconds: 1_804_000_000_000,
      recipientJid: rawRecipientJid,
    });
    expect(JSON.stringify({ ...record, recipientJid: undefined })).not.toContain(rawRecipientJid);
  });

  it("supports explicit inbound recipient output file paths", () => {
    const stateDirectory = createTemporaryDirectory();
    const filePath = join(stateDirectory, "operator", "recipient.secret.json");

    expect(
      readLocalInboundRecipientOperatorOutputConfig(
        {
          OMNIWA_LOCAL_INBOUND_RECIPIENT_OUTPUT: "file",
          OMNIWA_LOCAL_INBOUND_RECIPIENT_OUTPUT_PATH: filePath,
        },
        stateDirectory,
      ),
    ).toEqual({
      mode: "file",
      filePath,
    });
  });

  it("rejects unsupported modes without echoing unsafe values", () => {
    const unsafeMode = "raw-recipient-secret-terminal";

    expect(() =>
      readLocalInboundRecipientOperatorOutputConfig({
        OMNIWA_LOCAL_INBOUND_RECIPIENT_OUTPUT: unsafeMode,
      }),
    ).toThrow("Unsupported OmniWA local inbound recipient operator output mode.");
  });
});

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "omniwa-local-inbound-recipient-output-"));
  temporaryDirectories.push(directory);

  return directory;
}
