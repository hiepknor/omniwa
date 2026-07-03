import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createSessionId } from "@omniwa/domain";
import type { Clock } from "@omniwa/shared";
import { describe, expect, it } from "vitest";

import {
  DurableJsonBaileysAuthStateStore,
  InMemoryBaileysAuthStateStore,
  type BaileysAuthStateSnapshot,
} from "./baileys-auth-state-store.js";

const sessionId = createSessionId("session_auth_state_1");
const missingSessionId = createSessionId("session_auth_state_missing");
const rawSecret = "raw-auth-state-secret-token";
const authState = Object.freeze({
  credentials: Object.freeze({
    noiseKey: rawSecret,
    registrationId: 123,
  }),
  keys: Object.freeze({
    appStateSyncKey: Object.freeze({
      keyData: "private-app-state-key",
    }),
  }),
}) satisfies BaileysAuthStateSnapshot;

describe("Baileys AuthStateStore", () => {
  it("saves and loads auth state by sessionId", async () => {
    const store = new InMemoryBaileysAuthStateStore({ clock: fixedClock(1_000) });

    const saved = await store.save(sessionId, authState);
    const loaded = await store.load(sessionId);

    expect(saved.ok).toBe(true);
    expect(saved.ok ? saved.value : undefined).toMatchObject({
      sessionId,
      revision: 1,
      updatedAtEpochMilliseconds: 1_000,
      dataClassification: "secret",
    });
    expect(saved.ok ? saved.value.checksum.startsWith("sha256:") : false).toBe(true);
    expect(loaded.ok ? loaded.value?.state : undefined).toEqual(authState);
    expect(loaded.ok ? loaded.value?.dataClassification : undefined).toBe("secret");
    expect(JSON.stringify(loaded)).not.toContain(rawSecret);
    expect(JSON.stringify(loaded)).not.toContain("private-app-state-key");
  });

  it("increments revision when auth state is saved again", async () => {
    const store = new InMemoryBaileysAuthStateStore({ clock: fixedClock(2_000) });

    const first = await store.save(sessionId, authState);
    const second = await store.save(sessionId, {
      ...authState,
      credentials: {
        noiseKey: "rotated-secret",
        registrationId: 124,
      },
    });

    expect(first.ok ? first.value.revision : undefined).toBe(1);
    expect(second.ok ? second.value.revision : undefined).toBe(2);
    expect(second.ok ? second.value.updatedAtEpochMilliseconds : undefined).toBe(2_000);
    expect(second.ok && first.ok ? second.value.checksum === first.value.checksum : undefined).toBe(
      false,
    );
  });

  it("returns safe integrity errors when checksum verification fails", async () => {
    const store = new InMemoryBaileysAuthStateStore({ clock: fixedClock(3_000) });
    await store.save(sessionId, authState);
    store.corruptChecksumForTest(sessionId, "sha256:bad-checksum");

    const result = await store.load(sessionId);

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error).toMatchObject({
      category: "integrity",
      code: "baileys_auth_state_integrity_mismatch",
      message: "Baileys auth state failed integrity verification.",
      retryable: false,
      dataClassification: "secret",
      safeMetadata: {
        sessionId: String(sessionId),
        revision: 1,
      },
    });
    expect(JSON.stringify(result)).not.toContain(rawSecret);
    expect(JSON.stringify(result)).not.toContain("private-app-state-key");
  });

  it("clears auth state by sessionId", async () => {
    const store = new InMemoryBaileysAuthStateStore({ clock: fixedClock(4_000) });
    await store.save(sessionId, authState);

    const cleared = await store.clear(sessionId);
    const loaded = await store.load(sessionId);

    expect(cleared.ok ? cleared.value : undefined).toMatchObject({
      sessionId,
      revision: 1,
      dataClassification: "secret",
    });
    expect(loaded.ok).toBe(true);
    expect(loaded.ok ? loaded.value : "unexpected").toBeUndefined();
  });

  it("returns an empty safe result for missing session auth state", async () => {
    const store = new InMemoryBaileysAuthStateStore({ clock: fixedClock(5_000) });

    const loaded = await store.load(missingSessionId);
    const cleared = await store.clear(missingSessionId);

    expect(loaded.ok).toBe(true);
    expect(loaded.ok ? loaded.value : "unexpected").toBeUndefined();
    expect(cleared.ok).toBe(true);
    expect(cleared.ok ? cleared.value : "unexpected").toBeUndefined();
    expect(JSON.stringify(loaded)).not.toContain(rawSecret);
    expect(JSON.stringify(cleared)).not.toContain(rawSecret);
  });

  it("reloads durable-json auth state after restart", async () => {
    const filePath = join(mkdtempSync(join(tmpdir(), "omniwa-baileys-auth-")), "auth-state.json");
    const store = new DurableJsonBaileysAuthStateStore(filePath, { clock: fixedClock(6_000) });

    const saved = await store.save(sessionId, authState);
    expect(saved.ok).toBe(true);

    const rawFile = readFileSync(filePath, "utf8");
    expect(rawFile).not.toContain(rawSecret);
    expect(rawFile).not.toContain("private-app-state-key");

    const reloaded = new DurableJsonBaileysAuthStateStore(filePath, { clock: fixedClock(7_000) });
    const loaded = await reloaded.load(sessionId);

    expect(loaded.ok).toBe(true);
    expect(loaded.ok ? loaded.value?.state : undefined).toEqual(authState);
    expect(loaded.ok ? loaded.value?.revision : undefined).toBe(1);
  });

  it("returns safe durable-json integrity errors without raw auth payloads", async () => {
    const filePath = join(mkdtempSync(join(tmpdir(), "omniwa-baileys-auth-")), "auth-state.json");
    const store = new DurableJsonBaileysAuthStateStore(filePath, { clock: fixedClock(8_000) });
    await store.save(sessionId, authState);

    const rawEnvelope = JSON.parse(readFileSync(filePath, "utf8")) as {
      state: {
        records: Array<{ checksum: string }>;
      };
    };
    rawEnvelope.state.records[0] = {
      ...rawEnvelope.state.records[0],
      checksum: "sha256:corrupt",
    };
    writeFileSync(filePath, `${JSON.stringify(rawEnvelope, null, 2)}\n`, "utf8");

    const reloaded = new DurableJsonBaileysAuthStateStore(filePath, { clock: fixedClock(9_000) });
    const result = await reloaded.load(sessionId);

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error).toMatchObject({
      code: "baileys_auth_state_integrity_mismatch",
      dataClassification: "secret",
    });
    expect(JSON.stringify(result)).not.toContain(rawSecret);
    expect(JSON.stringify(result)).not.toContain("private-app-state-key");
  });

  it("keeps save, clear, and error results free of raw auth payloads", async () => {
    const store = new InMemoryBaileysAuthStateStore({ clock: fixedClock(10_000) });

    const saved = await store.save(sessionId, authState);
    store.corruptChecksumForTest(sessionId, "sha256:bad-checksum");
    const failedLoad = await store.load(sessionId);
    const cleared = await store.clear(sessionId);

    expect(JSON.stringify(saved)).not.toContain(rawSecret);
    expect(JSON.stringify(saved)).not.toContain("private-app-state-key");
    expect(JSON.stringify(failedLoad)).not.toContain(rawSecret);
    expect(JSON.stringify(failedLoad)).not.toContain("private-app-state-key");
    expect(JSON.stringify(cleared)).not.toContain(rawSecret);
    expect(JSON.stringify(cleared)).not.toContain("private-app-state-key");
  });
});

function fixedClock(epochMilliseconds: number): Pick<Clock, "epochMilliseconds"> {
  return {
    epochMilliseconds: () => epochMilliseconds,
  };
}
