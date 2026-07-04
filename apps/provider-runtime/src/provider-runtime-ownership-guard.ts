import {
  DurableJsonStateStore,
  type PostgresqlConnection,
} from "@omniwa/infrastructure-persistence";
import { systemClock, type Clock } from "@omniwa/shared";

import type {
  ProviderRuntimeSupervisorOwnershipDecision,
  ProviderRuntimeSupervisorOwnershipGuard,
  ProviderRuntimeSupervisorSessionRef,
} from "./provider-runtime-supervisor.js";

export type DurableJsonProviderRuntimeSupervisorOwnershipGuardOptions = Readonly<{
  filePath: string;
  leaseTtlMilliseconds?: number;
  clock?: Pick<Clock, "epochMilliseconds" | "isoNow">;
}>;

export type PostgresqlProviderRuntimeSupervisorOwnershipGuardOptions = Readonly<{
  connection: PostgresqlConnection;
  leaseTtlMilliseconds?: number;
  clock?: Pick<Clock, "epochMilliseconds" | "isoNow">;
  autoMigrate?: boolean;
}>;

export type ProviderRuntimeOwnershipLeaseSnapshot = Readonly<{
  sessionKey: string;
  ownerRef: string;
  acquiredAt: string;
  expiresAtEpochMilliseconds: number;
}>;

type ProviderRuntimeOwnershipLeaseRecord = ProviderRuntimeOwnershipLeaseSnapshot &
  Readonly<{
    instanceId: string;
    providerId: string;
    sessionId?: string;
  }>;

type ProviderRuntimeOwnershipState = Readonly<{
  leases: readonly ProviderRuntimeOwnershipLeaseRecord[];
}>;

const defaultLeaseTtlMilliseconds = 60_000;

export class DurableJsonProviderRuntimeSupervisorOwnershipGuard implements ProviderRuntimeSupervisorOwnershipGuard {
  private readonly stateStore: DurableJsonStateStore<ProviderRuntimeOwnershipState>;
  private readonly leaseTtlMilliseconds: number;
  private readonly clock: Pick<Clock, "epochMilliseconds" | "isoNow">;

  constructor(options: DurableJsonProviderRuntimeSupervisorOwnershipGuardOptions) {
    this.stateStore = new DurableJsonStateStore(options.filePath, emptyState);
    this.leaseTtlMilliseconds = options.leaseTtlMilliseconds ?? defaultLeaseTtlMilliseconds;
    this.clock = options.clock ?? systemClock;

    assertPositiveInteger(this.leaseTtlMilliseconds, "leaseTtlMilliseconds");
  }

  acquire(
    session: ProviderRuntimeSupervisorSessionRef,
    ownerRef: string,
  ): ProviderRuntimeSupervisorOwnershipDecision {
    const state = this.readWithoutExpiredLeases();
    const key = sessionKey(session);
    const existing = state.leases.find((lease) => lease.sessionKey === key);

    if (existing !== undefined && existing.ownerRef !== ownerRef) {
      return Object.freeze({
        acquired: false,
        ownerRef: existing.ownerRef,
      });
    }

    const nextLease = this.createLease(session, ownerRef);
    this.writeState({
      leases: [...state.leases.filter((lease) => lease.sessionKey !== key), nextLease],
    });

    return Object.freeze({ acquired: true });
  }

  release(session: ProviderRuntimeSupervisorSessionRef, ownerRef: string): boolean {
    const state = this.readWithoutExpiredLeases();
    const key = sessionKey(session);
    const existing = state.leases.find((lease) => lease.sessionKey === key);

    if (existing === undefined || existing.ownerRef !== ownerRef) {
      return false;
    }

    this.writeState({
      leases: state.leases.filter((lease) => lease.sessionKey !== key),
    });

    return true;
  }

  currentOwner(session: ProviderRuntimeSupervisorSessionRef): string | undefined {
    const state = this.readWithoutExpiredLeases();
    const lease = state.leases.find((candidate) => candidate.sessionKey === sessionKey(session));

    return lease?.ownerRef;
  }

  snapshot(): readonly ProviderRuntimeOwnershipLeaseSnapshot[] {
    return Object.freeze(
      this.readWithoutExpiredLeases().leases.map((lease) =>
        Object.freeze({
          sessionKey: lease.sessionKey,
          ownerRef: lease.ownerRef,
          acquiredAt: lease.acquiredAt,
          expiresAtEpochMilliseconds: lease.expiresAtEpochMilliseconds,
        }),
      ),
    );
  }

  private createLease(
    session: ProviderRuntimeSupervisorSessionRef,
    ownerRef: string,
  ): ProviderRuntimeOwnershipLeaseRecord {
    return createLeaseRecord({
      session,
      ownerRef,
      leaseTtlMilliseconds: this.leaseTtlMilliseconds,
      clock: this.clock,
    });
  }

  private readWithoutExpiredLeases(): ProviderRuntimeOwnershipState {
    const state = freezeState(this.stateStore.read());
    const now = this.clock.epochMilliseconds();
    const retainedLeases = state.leases.filter((lease) => lease.expiresAtEpochMilliseconds > now);

    if (retainedLeases.length !== state.leases.length) {
      this.writeState({ leases: retainedLeases });
    }

    return freezeState({ leases: retainedLeases });
  }

  private writeState(state: ProviderRuntimeOwnershipState): void {
    this.stateStore.write(freezeState(state));
  }
}

export class PostgresqlProviderRuntimeSupervisorOwnershipGuard implements ProviderRuntimeSupervisorOwnershipGuard {
  private readonly connection: PostgresqlConnection;
  private readonly leaseTtlMilliseconds: number;
  private readonly clock: Pick<Clock, "epochMilliseconds" | "isoNow">;
  private readonly autoMigrate: boolean;
  private schemaPromise: Promise<void> | undefined;

  constructor(options: PostgresqlProviderRuntimeSupervisorOwnershipGuardOptions) {
    this.connection = options.connection;
    this.leaseTtlMilliseconds = options.leaseTtlMilliseconds ?? defaultLeaseTtlMilliseconds;
    this.clock = options.clock ?? systemClock;
    this.autoMigrate = options.autoMigrate ?? true;

    assertPositiveInteger(this.leaseTtlMilliseconds, "leaseTtlMilliseconds");
  }

  async acquire(
    session: ProviderRuntimeSupervisorSessionRef,
    ownerRef: string,
  ): Promise<ProviderRuntimeSupervisorOwnershipDecision> {
    await this.ensureSchema();
    await this.deleteExpiredLeases();

    const lease = createLeaseRecord({
      session,
      ownerRef,
      leaseTtlMilliseconds: this.leaseTtlMilliseconds,
      clock: this.clock,
    });
    const acquired = await this.tryAcquireLease(lease);

    if (acquired) {
      return Object.freeze({ acquired: true });
    }

    const currentOwner = await this.currentOwner(session);

    if (currentOwner === undefined) {
      return this.acquire(session, ownerRef);
    }

    return Object.freeze({
      acquired: false,
      ownerRef: currentOwner,
    });
  }

  async release(session: ProviderRuntimeSupervisorSessionRef, ownerRef: string): Promise<boolean> {
    await this.ensureSchema();

    const result = await this.connection.query(
      "DELETE FROM omniwa_provider_runtime_leases WHERE session_key = $1 AND owner_ref = $2",
      [sessionKey(session), ownerRef],
    );

    return (result.rowCount ?? 0) > 0;
  }

  async currentOwner(session: ProviderRuntimeSupervisorSessionRef): Promise<string | undefined> {
    await this.ensureSchema();
    await this.deleteExpiredLeases();

    const result = await this.connection.query<{ owner_ref: string }>(
      `SELECT owner_ref
       FROM omniwa_provider_runtime_leases
       WHERE session_key = $1 AND expires_at_epoch_ms > $2`,
      [sessionKey(session), this.clock.epochMilliseconds()],
    );

    return result.rows[0]?.owner_ref;
  }

  async snapshot(): Promise<readonly ProviderRuntimeOwnershipLeaseSnapshot[]> {
    await this.ensureSchema();
    await this.deleteExpiredLeases();

    const result = await this.connection.query<ProviderRuntimeOwnershipLeaseRow>(
      `SELECT session_key, owner_ref, acquired_at, expires_at_epoch_ms
       FROM omniwa_provider_runtime_leases
       WHERE expires_at_epoch_ms > $1
       ORDER BY session_key ASC`,
      [this.clock.epochMilliseconds()],
    );

    return Object.freeze(result.rows.map(snapshotFromPostgresqlRow));
  }

  private async tryAcquireLease(lease: ProviderRuntimeOwnershipLeaseRecord): Promise<boolean> {
    const result = await this.connection.query<{ owner_ref: string }>(
      `INSERT INTO omniwa_provider_runtime_leases (
         session_key,
         instance_id,
         provider_id,
         session_id,
         owner_ref,
         acquired_at,
         expires_at_epoch_ms,
         updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7, now())
       ON CONFLICT (session_key) DO UPDATE
       SET owner_ref = EXCLUDED.owner_ref,
           instance_id = EXCLUDED.instance_id,
           provider_id = EXCLUDED.provider_id,
           session_id = EXCLUDED.session_id,
           acquired_at = EXCLUDED.acquired_at,
           expires_at_epoch_ms = EXCLUDED.expires_at_epoch_ms,
           updated_at = now()
       WHERE omniwa_provider_runtime_leases.owner_ref = $5
          OR omniwa_provider_runtime_leases.expires_at_epoch_ms <= $8
       RETURNING owner_ref`,
      [
        lease.sessionKey,
        lease.instanceId,
        lease.providerId,
        lease.sessionId ?? null,
        lease.ownerRef,
        lease.acquiredAt,
        lease.expiresAtEpochMilliseconds,
        this.clock.epochMilliseconds(),
      ],
    );

    return (result.rowCount ?? 0) > 0;
  }

  private async deleteExpiredLeases(): Promise<void> {
    await this.connection.query(
      "DELETE FROM omniwa_provider_runtime_leases WHERE expires_at_epoch_ms <= $1",
      [this.clock.epochMilliseconds()],
    );
  }

  private async ensureSchema(): Promise<void> {
    if (!this.autoMigrate) {
      return;
    }

    this.schemaPromise ??= (async () => {
      for (const statement of postgresqlOwnershipLeaseSchemaStatements) {
        await this.connection.query(statement);
      }
    })();

    await this.schemaPromise;
  }
}

function emptyState(): ProviderRuntimeOwnershipState {
  return Object.freeze({
    leases: Object.freeze([]),
  });
}

function freezeState(state: ProviderRuntimeOwnershipState): ProviderRuntimeOwnershipState {
  return Object.freeze({
    leases: Object.freeze(state.leases.map(freezeLeaseRecord)),
  });
}

function freezeLeaseRecord(
  lease: ProviderRuntimeOwnershipLeaseRecord,
): ProviderRuntimeOwnershipLeaseRecord {
  return Object.freeze({
    sessionKey: lease.sessionKey,
    instanceId: lease.instanceId,
    providerId: lease.providerId,
    ...optional("sessionId", lease.sessionId),
    ownerRef: lease.ownerRef,
    acquiredAt: lease.acquiredAt,
    expiresAtEpochMilliseconds: lease.expiresAtEpochMilliseconds,
  });
}

function createLeaseRecord(input: {
  session: ProviderRuntimeSupervisorSessionRef;
  ownerRef: string;
  leaseTtlMilliseconds: number;
  clock: Pick<Clock, "epochMilliseconds" | "isoNow">;
}): ProviderRuntimeOwnershipLeaseRecord {
  const now = input.clock.epochMilliseconds();

  return Object.freeze({
    sessionKey: sessionKey(input.session),
    instanceId: String(input.session.instanceId),
    providerId: String(input.session.providerId),
    ...optional(
      "sessionId",
      input.session.sessionId === undefined ? undefined : String(input.session.sessionId),
    ),
    ownerRef: input.ownerRef,
    acquiredAt: String(input.clock.isoNow()),
    expiresAtEpochMilliseconds: now + input.leaseTtlMilliseconds,
  });
}

type ProviderRuntimeOwnershipLeaseRow = Readonly<{
  session_key: string;
  owner_ref: string;
  acquired_at: string | Date;
  expires_at_epoch_ms: string | number;
}>;

function snapshotFromPostgresqlRow(
  row: ProviderRuntimeOwnershipLeaseRow,
): ProviderRuntimeOwnershipLeaseSnapshot {
  const acquiredAt =
    row.acquired_at instanceof Date ? row.acquired_at.toISOString() : String(row.acquired_at);

  return Object.freeze({
    sessionKey: row.session_key,
    ownerRef: row.owner_ref,
    acquiredAt,
    expiresAtEpochMilliseconds: Number(row.expires_at_epoch_ms),
  });
}

const postgresqlOwnershipLeaseSchemaStatements = Object.freeze([
  `CREATE TABLE IF NOT EXISTS omniwa_provider_runtime_leases (
    session_key text PRIMARY KEY,
    instance_id text NOT NULL,
    provider_id text NOT NULL,
    session_id text NULL,
    owner_ref text NOT NULL,
    acquired_at timestamptz NOT NULL,
    expires_at_epoch_ms bigint NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  "CREATE INDEX IF NOT EXISTS omniwa_provider_runtime_leases_owner_ref_idx ON omniwa_provider_runtime_leases (owner_ref)",
  "CREATE INDEX IF NOT EXISTS omniwa_provider_runtime_leases_expires_at_idx ON omniwa_provider_runtime_leases (expires_at_epoch_ms)",
]);

function sessionKey(session: ProviderRuntimeSupervisorSessionRef): string {
  return [
    String(session.instanceId),
    String(session.providerId),
    session.sessionId === undefined ? "session:none" : String(session.sessionId),
  ].join(":");
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
}

function optional<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Record<TKey, TValue>);
}
