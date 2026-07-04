import { DurableJsonStateStore } from "@omniwa/infrastructure-persistence";
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
    const now = this.clock.epochMilliseconds();

    return Object.freeze({
      sessionKey: sessionKey(session),
      instanceId: String(session.instanceId),
      providerId: String(session.providerId),
      ...optional(
        "sessionId",
        session.sessionId === undefined ? undefined : String(session.sessionId),
      ),
      ownerRef,
      acquiredAt: String(this.clock.isoNow()),
      expiresAtEpochMilliseconds: now + this.leaseTtlMilliseconds,
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
