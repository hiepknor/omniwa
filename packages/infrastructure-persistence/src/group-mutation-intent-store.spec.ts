import { createGroupMutationIntentRef } from "@omniwa/application";
import { createCorrelationId, createRequestContext, createRequestId } from "@omniwa/shared";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import {
  DurableJsonGroupMutationIntentStore,
  InMemoryGroupMutationIntentStore,
} from "./group-mutation-intent-store.js";

const context = {
  requestContext: createRequestContext({
    requestId: createRequestId("group-intent-store-request"),
    correlationId: createCorrelationId("group-intent-store-correlation"),
  }),
  actorRef: "api_key:test",
};

describe("group mutation intent store", () => {
  it("stores and resolves group mutation intents behind safe refs", async () => {
    const store = new InMemoryGroupMutationIntentStore({
      clock: { epochMilliseconds: () => 1_782_864_000_000 },
    });

    const receipt = await store.storeGroupMutationIntent(
      {
        groupMutationIntentRef: createGroupMutationIntentRef("group_intent_1"),
        kind: "metadata",
        subject: "New subject",
      },
      context,
    );
    const resolved =
      receipt.ok &&
      (await store.resolveGroupMutationIntent(receipt.value.groupMutationIntentRef, context));

    expect(receipt.ok ? receipt.value : undefined).toEqual({
      groupMutationIntentRef: "group_intent_1",
      kind: "metadata",
      createdAtEpochMilliseconds: 1_782_864_000_000,
    });
    expect(resolved && resolved.ok ? resolved.value : undefined).toMatchObject({
      groupMutationIntentRef: "group_intent_1",
      kind: "metadata",
      subject: "New subject",
    });
  });

  it("returns safe missing intent errors", async () => {
    const store = new InMemoryGroupMutationIntentStore();

    const result = await store.resolveGroupMutationIntent(
      createGroupMutationIntentRef("group_intent_missing"),
      context,
    );

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error).toMatchObject({
      category: "rejected",
      code: "group_mutation_intent_not_found",
      ownerContext: "group",
    });
  });

  it("does not expose raw member JID in snapshot or safe errors", async () => {
    const rawJid = "12025550123@s.whatsapp.net";
    const store = new InMemoryGroupMutationIntentStore();

    await store.storeGroupMutationIntent(
      {
        groupMutationIntentRef: createGroupMutationIntentRef("group_intent_member"),
        kind: "add_member",
        memberJid: rawJid,
      },
      context,
    );
    const missing = await store.resolveGroupMutationIntent(
      createGroupMutationIntentRef("group_intent_missing"),
      context,
    );

    expect(JSON.stringify(store.snapshot())).not.toContain(rawJid);
    expect(JSON.stringify(missing)).not.toContain(rawJid);
  });

  it("reloads durable JSON intents after restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "omniwa-group-intent-"));

    try {
      const filePath = join(directory, "group-mutation-intents.json");
      const first = new DurableJsonGroupMutationIntentStore(filePath);
      const ref = createGroupMutationIntentRef("group_intent_durable");

      await first.storeGroupMutationIntent(
        {
          groupMutationIntentRef: ref,
          kind: "remove_member",
          memberRef: "group_1:member:1",
        },
        context,
      );

      const second = new DurableJsonGroupMutationIntentStore(filePath);
      const resolved = await second.resolveGroupMutationIntent(ref, context);

      expect(resolved.ok ? resolved.value : undefined).toMatchObject({
        groupMutationIntentRef: "group_intent_durable",
        kind: "remove_member",
        memberRef: "group_1:member:1",
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
