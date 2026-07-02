import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createWorkerRuntimeComposition,
  readWorkerRepositoryProfile,
  readWorkerRuntimeProfile,
} from "./runtime-composition.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Worker runtime composition", () => {
  it("composes a local in-memory worker runtime by default", async () => {
    const composition = createWorkerRuntimeComposition({
      NODE_ENV: "test",
    });

    expect(composition).toMatchObject({
      profile: "test",
      repositoryProfile: "in-memory",
    });
    await expect(composition.app.recoverVisibleJobs()).resolves.toEqual({
      recovered: 0,
      supported: true,
    });
  });

  it("composes durable JSON repository profile when a state directory is provided", () => {
    const directory = createTemporaryDirectory();
    const composition = createWorkerRuntimeComposition({
      OMNIWA_WORKER_RUNTIME_PROFILE: "local",
      OMNIWA_WORKER_REPOSITORY_PROFILE: "durable-json",
      OMNIWA_WORKER_REPOSITORY_STATE_DIR: directory,
    });

    expect(composition.repositoryProfile).toBe("durable-json");
  });

  it("falls back to API repository profile for shared local stack configuration", () => {
    expect(
      readWorkerRepositoryProfile({
        OMNIWA_API_REPOSITORY_PROFILE: "postgresql",
      }),
    ).toBe("postgresql");
  });

  it("rejects PostgreSQL profile without a database URL", () => {
    expect(() =>
      createWorkerRuntimeComposition({
        OMNIWA_WORKER_RUNTIME_PROFILE: "local",
        OMNIWA_WORKER_REPOSITORY_PROFILE: "postgresql",
      }),
    ).toThrow(/OMNIWA_POSTGRES_DATABASE_URL/u);
  });

  it("keeps production runtime blocked until remaining production adapters are complete", () => {
    expect(() =>
      createWorkerRuntimeComposition({
        OMNIWA_WORKER_RUNTIME_PROFILE: "production",
      }),
    ).toThrow(/distributed queue, provider, secret, and observability adapters/u);
  });

  it("normalizes worker runtime profile values", () => {
    expect(readWorkerRuntimeProfile({ OMNIWA_WORKER_RUNTIME_PROFILE: "development" })).toBe(
      "local",
    );
    expect(readWorkerRuntimeProfile({ OMNIWA_WORKER_RUNTIME_PROFILE: "production" })).toBe(
      "production",
    );
    expect(() => readWorkerRuntimeProfile({ OMNIWA_WORKER_RUNTIME_PROFILE: "invalid" })).toThrow(
      /Unsupported OmniWA Worker runtime profile/u,
    );
  });
});

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "omniwa-worker-runtime-"));
  temporaryDirectories.push(directory);

  return directory;
}
