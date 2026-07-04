import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createWebhookDispatcherRuntimeComposition,
  readWebhookDispatcherRepositoryProfile,
  readWebhookDispatcherRuntimeProfile,
} from "./runtime-composition.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Webhook Dispatcher runtime composition", () => {
  it("composes a local in-memory dispatcher runtime by default", async () => {
    const composition = createWebhookDispatcherRuntimeComposition({
      NODE_ENV: "test",
    });

    expect(composition).toMatchObject({
      profile: "test",
      repositoryProfile: "in-memory",
    });
    await expect(composition.queueProvider.recoverVisibleJobs?.()).resolves.toEqual({
      recovered: 0,
    });
    await expect(composition.app.runOnce()).resolves.toMatchObject({
      outcome: "idle",
    });
  });

  it("composes durable JSON repository profile when a state directory is provided", async () => {
    const directory = createTemporaryDirectory();
    const composition = createWebhookDispatcherRuntimeComposition({
      OMNIWA_WEBHOOK_DISPATCHER_RUNTIME_PROFILE: "local",
      OMNIWA_WEBHOOK_DISPATCHER_REPOSITORY_PROFILE: "durable-json",
      OMNIWA_WEBHOOK_DISPATCHER_REPOSITORY_STATE_DIR: directory,
    });

    expect(composition.repositoryProfile).toBe("durable-json");
    await expect(composition.app.runOnce()).resolves.toMatchObject({
      outcome: "idle",
    });
  });

  it("falls back to API repository state directory for shared local stack configuration", () => {
    const directory = createTemporaryDirectory();
    const composition = createWebhookDispatcherRuntimeComposition({
      OMNIWA_WEBHOOK_DISPATCHER_RUNTIME_PROFILE: "local",
      OMNIWA_WEBHOOK_DISPATCHER_REPOSITORY_PROFILE: "durable-json",
      OMNIWA_API_REPOSITORY_STATE_DIR: directory,
    });

    expect(composition.repositoryProfile).toBe("durable-json");
  });

  it("keeps production runtime blocked until remaining production adapters are complete", () => {
    expect(() =>
      createWebhookDispatcherRuntimeComposition({
        OMNIWA_WEBHOOK_DISPATCHER_RUNTIME_PROFILE: "production",
      }),
    ).toThrow(/production queue, webhook HTTP gateway, secret, and observability adapters/u);
  });

  it("supports PostgreSQL repository profile once webhook repositories are implemented", () => {
    expect(
      readWebhookDispatcherRepositoryProfile({
        OMNIWA_WEBHOOK_DISPATCHER_REPOSITORY_PROFILE: "postgresql",
      }),
    ).toBe("postgresql");
  });

  it("requires a PostgreSQL database URL for PostgreSQL composition", () => {
    expect(() =>
      createWebhookDispatcherRuntimeComposition({
        OMNIWA_WEBHOOK_DISPATCHER_RUNTIME_PROFILE: "local",
        OMNIWA_WEBHOOK_DISPATCHER_REPOSITORY_PROFILE: "postgresql",
      }),
    ).toThrow(/OMNIWA_POSTGRES_DATABASE_URL/u);
  });

  it("composes PostgreSQL repository profile when a database URL is provided", () => {
    const composition = createWebhookDispatcherRuntimeComposition({
      OMNIWA_WEBHOOK_DISPATCHER_RUNTIME_PROFILE: "local",
      OMNIWA_WEBHOOK_DISPATCHER_REPOSITORY_PROFILE: "postgresql",
      OMNIWA_POSTGRES_DATABASE_URL: "postgresql://omniwa:omniwa@127.0.0.1:55432/omniwa",
      OMNIWA_POSTGRES_AUTO_MIGRATE: "true",
    });

    expect(composition.repositoryProfile).toBe("postgresql");
  });

  it("requires a repository state directory for durable JSON composition", () => {
    expect(() =>
      createWebhookDispatcherRuntimeComposition({
        OMNIWA_WEBHOOK_DISPATCHER_RUNTIME_PROFILE: "local",
        OMNIWA_WEBHOOK_DISPATCHER_REPOSITORY_PROFILE: "durable-json",
      }),
    ).toThrow(/OMNIWA_WEBHOOK_DISPATCHER_REPOSITORY_STATE_DIR/u);
  });

  it("normalizes dispatcher runtime and repository profile values", () => {
    expect(readWebhookDispatcherRuntimeProfile({ NODE_ENV: "development" })).toBe("local");
    expect(
      readWebhookDispatcherRuntimeProfile({
        OMNIWA_WEBHOOK_DISPATCHER_RUNTIME_PROFILE: "production",
      }),
    ).toBe("production");
    expect(readWebhookDispatcherRepositoryProfile({})).toBe("in-memory");
    expect(
      readWebhookDispatcherRepositoryProfile({
        OMNIWA_WEBHOOK_DISPATCHER_REPOSITORY_PROFILE: "durable-json",
      }),
    ).toBe("durable-json");
    expect(
      readWebhookDispatcherRepositoryProfile({
        OMNIWA_WEBHOOK_DISPATCHER_REPOSITORY_PROFILE: "postgresql",
      }),
    ).toBe("postgresql");
  });
});

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "omniwa-webhook-dispatcher-runtime-"));
  temporaryDirectories.push(directory);

  return directory;
}
