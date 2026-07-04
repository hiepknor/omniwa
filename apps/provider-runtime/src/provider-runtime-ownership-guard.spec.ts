import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createInstanceId, createProviderId, createSessionId } from "@omniwa/domain";
import {
  createPostgresqlConnectionPool,
  type PostgresqlConnection,
  type PostgresqlTransactionClient,
} from "@omniwa/infrastructure-persistence";
import { toIsoTimestamp } from "@omniwa/shared";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import {
  DurableJsonProviderRuntimeSupervisorOwnershipGuard,
  PostgresqlProviderRuntimeSupervisorOwnershipGuard,
} from "./provider-runtime-ownership-guard.js";

const temporaryDirectories: string[] = [];
const session = Object.freeze({
  instanceId: createInstanceId("provider-runtime-lease-instance"),
  providerId: createProviderId("provider.baileys"),
  sessionId: createSessionId("provider-runtime-lease-session"),
  reasonCode: "provider_runtime_lease_test",
});

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("DurableJsonProviderRuntimeSupervisorOwnershipGuard", () => {
  it("persists active ownership across guard restarts", () => {
    const filePath = ownershipFilePath();
    const firstGuard = new DurableJsonProviderRuntimeSupervisorOwnershipGuard({ filePath });

    expect(firstGuard.acquire(session, "provider-owner-a")).toEqual({ acquired: true });

    const restartedGuard = new DurableJsonProviderRuntimeSupervisorOwnershipGuard({ filePath });

    expect(restartedGuard.currentOwner(session)).toBe("provider-owner-a");
    expect(restartedGuard.acquire(session, "provider-owner-b")).toEqual({
      acquired: false,
      ownerRef: "provider-owner-a",
    });
  });

  it("releases only the active owner", () => {
    const guard = new DurableJsonProviderRuntimeSupervisorOwnershipGuard({
      filePath: ownershipFilePath(),
    });

    expect(guard.acquire(session, "provider-owner-a")).toEqual({ acquired: true });
    expect(guard.release(session, "provider-owner-b")).toBe(false);
    expect(guard.currentOwner(session)).toBe("provider-owner-a");
    expect(guard.release(session, "provider-owner-a")).toBe(true);
    expect(guard.currentOwner(session)).toBeUndefined();
  });

  it("allows a new owner after lease expiry", () => {
    const clock = new ManualClock(1_000);
    const guard = new DurableJsonProviderRuntimeSupervisorOwnershipGuard({
      filePath: ownershipFilePath(),
      leaseTtlMilliseconds: 100,
      clock,
    });

    expect(guard.acquire(session, "provider-owner-a")).toEqual({ acquired: true });
    clock.advance(100);

    expect(guard.currentOwner(session)).toBeUndefined();
    expect(guard.acquire(session, "provider-owner-b")).toEqual({ acquired: true });
    expect(guard.currentOwner(session)).toBe("provider-owner-b");
  });

  it("renews an existing owner lease without creating duplicate records", () => {
    const clock = new ManualClock(1_000);
    const guard = new DurableJsonProviderRuntimeSupervisorOwnershipGuard({
      filePath: ownershipFilePath(),
      leaseTtlMilliseconds: 1_000,
      clock,
    });

    expect(guard.acquire(session, "provider-owner-a")).toEqual({ acquired: true });
    const firstSnapshot = guard.snapshot();
    clock.advance(500);
    expect(guard.acquire(session, "provider-owner-a")).toEqual({ acquired: true });

    expect(guard.snapshot()).toHaveLength(1);
    expect(guard.snapshot()[0]?.expiresAtEpochMilliseconds).toBeGreaterThan(
      firstSnapshot[0]?.expiresAtEpochMilliseconds ?? 0,
    );
  });

  it("does not expose raw provider payloads in snapshots or conflict decisions", () => {
    const rawProviderPayload = "raw-provider-socket-secret";
    const guard = new DurableJsonProviderRuntimeSupervisorOwnershipGuard({
      filePath: ownershipFilePath(),
    });

    expect(guard.acquire(session, "provider-owner-a")).toEqual({ acquired: true });
    const conflict = guard.acquire(session, "provider-owner-b");
    const serialized = JSON.stringify({
      conflict,
      snapshot: guard.snapshot(),
    });

    expect(serialized).toContain("provider-owner-a");
    expect(serialized).not.toContain(rawProviderPayload);
  });

  it("rejects invalid lease TTL", () => {
    expect(
      () =>
        new DurableJsonProviderRuntimeSupervisorOwnershipGuard({
          filePath: ownershipFilePath(),
          leaseTtlMilliseconds: 0,
        }),
    ).toThrow(/positive integer/u);
  });

  it("uses PostgreSQL lease rows to block competing runtime owners", async () => {
    const connection = new FakePostgresqlConnection();
    const guardA = new PostgresqlProviderRuntimeSupervisorOwnershipGuard({
      connection,
      clock: new ManualClock(1_000),
    });
    const guardB = new PostgresqlProviderRuntimeSupervisorOwnershipGuard({
      connection,
      clock: new ManualClock(1_500),
    });

    await expect(guardA.acquire(session, "provider-owner-a")).resolves.toEqual({
      acquired: true,
    });
    await expect(guardB.acquire(session, "provider-owner-b")).resolves.toEqual({
      acquired: false,
      ownerRef: "provider-owner-a",
    });
    await expect(guardB.currentOwner(session)).resolves.toBe("provider-owner-a");
    expect(connection.schemaStatements.length).toBeGreaterThanOrEqual(3);
  });

  it("lets the same PostgreSQL owner renew and a different owner acquire after expiry", async () => {
    const clock = new ManualClock(1_000);
    const connection = new FakePostgresqlConnection();
    const guard = new PostgresqlProviderRuntimeSupervisorOwnershipGuard({
      connection,
      leaseTtlMilliseconds: 100,
      clock,
    });

    await expect(guard.acquire(session, "provider-owner-a")).resolves.toEqual({
      acquired: true,
    });
    clock.advance(50);
    await expect(guard.acquire(session, "provider-owner-a")).resolves.toEqual({
      acquired: true,
    });
    clock.advance(100);
    await expect(guard.currentOwner(session)).resolves.toBeUndefined();
    await expect(guard.acquire(session, "provider-owner-b")).resolves.toEqual({
      acquired: true,
    });
    await expect(guard.currentOwner(session)).resolves.toBe("provider-owner-b");
  });

  it("releases PostgreSQL leases only for the active owner", async () => {
    const connection = new FakePostgresqlConnection();
    const guard = new PostgresqlProviderRuntimeSupervisorOwnershipGuard({ connection });

    await expect(guard.acquire(session, "provider-owner-a")).resolves.toEqual({
      acquired: true,
    });
    await expect(guard.release(session, "provider-owner-b")).resolves.toBe(false);
    await expect(guard.currentOwner(session)).resolves.toBe("provider-owner-a");
    await expect(guard.release(session, "provider-owner-a")).resolves.toBe(true);
    await expect(guard.currentOwner(session)).resolves.toBeUndefined();
  });

  it("returns safe PostgreSQL lease snapshots without provider payloads", async () => {
    const rawProviderPayload = "raw-provider-socket-secret";
    const connection = new FakePostgresqlConnection();
    const guard = new PostgresqlProviderRuntimeSupervisorOwnershipGuard({ connection });

    await expect(guard.acquire(session, "provider-owner-a")).resolves.toEqual({
      acquired: true,
    });

    const snapshot = await guard.snapshot();
    const serialized = JSON.stringify(snapshot);

    expect(snapshot).toEqual([
      expect.objectContaining({
        ownerRef: "provider-owner-a",
        sessionKey: expect.stringContaining("provider-runtime-lease-instance"),
      }),
    ]);
    expect(serialized).not.toContain(rawProviderPayload);
  });
});

const postgresqlTestDatabaseUrl = process.env.OMNIWA_POSTGRES_TEST_DATABASE_URL?.trim();

if (postgresqlTestDatabaseUrl === undefined || postgresqlTestDatabaseUrl.length === 0) {
  describe.skip("PostgresqlProviderRuntimeSupervisorOwnershipGuard PostgreSQL contract", () => {
    it("requires OMNIWA_POSTGRES_TEST_DATABASE_URL to run", () => {
      expect(true).toBe(true);
    });
  });
} else {
  describe("PostgresqlProviderRuntimeSupervisorOwnershipGuard PostgreSQL contract", () => {
    const connection = createPostgresqlConnectionPool(postgresqlTestDatabaseUrl);

    afterEach(async () => {
      await connection.query("DROP TABLE IF EXISTS omniwa_provider_runtime_leases");
    });

    afterAll(async () => {
      await connection.end?.();
    });

    it("atomically blocks competing owners and allows ownership after release", async () => {
      const firstGuard = new PostgresqlProviderRuntimeSupervisorOwnershipGuard({ connection });
      const secondGuard = new PostgresqlProviderRuntimeSupervisorOwnershipGuard({ connection });

      await expect(firstGuard.acquire(session, "provider-owner-a")).resolves.toEqual({
        acquired: true,
      });
      await expect(secondGuard.acquire(session, "provider-owner-b")).resolves.toEqual({
        acquired: false,
        ownerRef: "provider-owner-a",
      });
      await expect(firstGuard.release(session, "provider-owner-a")).resolves.toBe(true);
      await expect(secondGuard.acquire(session, "provider-owner-b")).resolves.toEqual({
        acquired: true,
      });
    });
  });
}

function ownershipFilePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "omniwa-provider-ownership-"));
  temporaryDirectories.push(directory);

  return join(directory, "leases.json");
}

class ManualClock {
  constructor(private currentEpochMilliseconds: number) {}

  epochMilliseconds(): number {
    return this.currentEpochMilliseconds;
  }

  isoNow() {
    return toIsoTimestamp(new Date(this.currentEpochMilliseconds));
  }

  advance(milliseconds: number): void {
    this.currentEpochMilliseconds += milliseconds;
  }
}

type FakeLeaseRow = {
  session_key: string;
  instance_id: string;
  provider_id: string;
  session_id: string | null;
  owner_ref: string;
  acquired_at: string;
  expires_at_epoch_ms: number;
};

class FakePostgresqlConnection implements PostgresqlConnection {
  readonly schemaStatements: string[] = [];
  private readonly leasesBySessionKey = new Map<string, FakeLeaseRow>();

  query<TRow extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = [],
  ) {
    const sql = normalizeSql(text);

    if (sql.startsWith("CREATE TABLE") || sql.startsWith("CREATE INDEX")) {
      this.schemaStatements.push(sql);
      return Promise.resolve(result<TRow>([], 0));
    }

    if (sql === "DELETE FROM omniwa_provider_runtime_leases WHERE expires_at_epoch_ms <= $1") {
      const now = Number(values[0]);
      let deleted = 0;

      for (const [key, lease] of this.leasesBySessionKey) {
        if (lease.expires_at_epoch_ms <= now) {
          this.leasesBySessionKey.delete(key);
          deleted += 1;
        }
      }

      return Promise.resolve(result<TRow>([], deleted));
    }

    if (sql.startsWith("INSERT INTO omniwa_provider_runtime_leases")) {
      const lease = {
        session_key: String(values[0]),
        instance_id: String(values[1]),
        provider_id: String(values[2]),
        session_id: values[3] === null ? null : String(values[3]),
        owner_ref: String(values[4]),
        acquired_at: String(values[5]),
        expires_at_epoch_ms: Number(values[6]),
      } satisfies FakeLeaseRow;
      const now = Number(values[7]);
      const existing = this.leasesBySessionKey.get(lease.session_key);

      if (
        existing === undefined ||
        existing.owner_ref === lease.owner_ref ||
        existing.expires_at_epoch_ms <= now
      ) {
        this.leasesBySessionKey.set(lease.session_key, lease);
        return Promise.resolve(result(rowsAs<TRow>([{ owner_ref: lease.owner_ref }]), 1));
      }

      return Promise.resolve(result<TRow>([], 0));
    }

    if (sql.startsWith("SELECT owner_ref FROM omniwa_provider_runtime_leases")) {
      const lease = this.leasesBySessionKey.get(String(values[0]));
      const now = Number(values[1]);
      const rows =
        lease !== undefined && lease.expires_at_epoch_ms > now
          ? rowsAs<TRow>([{ owner_ref: lease.owner_ref }])
          : [];

      return Promise.resolve(result(rows, rows.length));
    }

    if (
      sql === "DELETE FROM omniwa_provider_runtime_leases WHERE session_key = $1 AND owner_ref = $2"
    ) {
      const sessionKey = String(values[0]);
      const lease = this.leasesBySessionKey.get(sessionKey);

      if (lease?.owner_ref === values[1]) {
        this.leasesBySessionKey.delete(sessionKey);
        return Promise.resolve(result<TRow>([], 1));
      }

      return Promise.resolve(result<TRow>([], 0));
    }

    if (sql.startsWith("SELECT session_key, owner_ref, acquired_at, expires_at_epoch_ms")) {
      const now = Number(values[0]);
      const rows = rowsAs<TRow>(
        [...this.leasesBySessionKey.values()]
          .filter((lease) => lease.expires_at_epoch_ms > now)
          .sort((left, right) => left.session_key.localeCompare(right.session_key))
          .map((lease) => ({
            session_key: lease.session_key,
            owner_ref: lease.owner_ref,
            acquired_at: lease.acquired_at,
            expires_at_epoch_ms: lease.expires_at_epoch_ms,
          })),
      );

      return Promise.resolve(result(rows, rows.length));
    }

    throw new Error(`Unexpected SQL in fake PostgreSQL connection: ${sql}`);
  }

  connect(): Promise<PostgresqlTransactionClient> {
    throw new Error("FakePostgresqlConnection does not support transactions.");
  }
}

function normalizeSql(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

function result<TRow>(rows: TRow[], rowCount = rows.length) {
  return {
    rows,
    rowCount,
    command: "",
    oid: 0,
    fields: [],
  };
}

function rowsAs<TRow>(rows: readonly Record<string, unknown>[]): TRow[] {
  return rows as unknown as TRow[];
}
