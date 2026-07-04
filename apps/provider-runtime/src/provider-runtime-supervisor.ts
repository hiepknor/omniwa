import {
  type ApplicationPortContext,
  type ApplicationPortFailure,
  type ApplicationPortResult,
  type ProviderSignalIngress,
  type TranslatedProviderSignal,
} from "@omniwa/application";
import {
  type BaileysSocketProvider,
  type BaileysSocketRequest,
} from "@omniwa/infrastructure-provider-baileys";
import {
  createFailureCategory,
  type InstanceId,
  type ProviderId,
  type SessionId,
} from "@omniwa/domain";
import { err, ok } from "@omniwa/shared";
import { randomUUID } from "node:crypto";

export const providerRuntimeSupervisorStates = [
  "CREATED",
  "STARTING",
  "QR_REQUIRED",
  "PAIRING",
  "CONNECTED",
  "RECONNECTING",
  "DISCONNECTED",
  "LOGGED_OUT",
  "DESTROYED",
] as const;

export type ProviderRuntimeSupervisorState = (typeof providerRuntimeSupervisorStates)[number];

export type ProviderRuntimeSupervisorSessionRef = Readonly<{
  instanceId: InstanceId;
  providerId: ProviderId;
  sessionId: SessionId;
}>;

export type ProviderRuntimeSupervisorStartInput = ProviderRuntimeSupervisorSessionRef &
  Readonly<{
    reasonCode: string;
  }>;

export type ProviderRuntimeSupervisorStopInput = ProviderRuntimeSupervisorSessionRef &
  Readonly<{
    reasonCode: string;
  }>;

export type ProviderRuntimeSupervisorFailure = Readonly<{
  code: string;
  message: string;
  retryable: boolean;
  source: "runtime" | "provider" | "ingress";
}>;

export type ProviderRuntimeSupervisorSessionSnapshot = ProviderRuntimeSupervisorSessionRef &
  Readonly<{
    state: ProviderRuntimeSupervisorState;
    ownerRef: string;
    transitions: readonly ProviderRuntimeSupervisorState[];
    lastSignalRef?: string;
    failure?: ProviderRuntimeSupervisorFailure;
  }>;

export type ProviderRuntimeSupervisorSnapshot = Readonly<{
  ownerRef: string;
  sessions: readonly ProviderRuntimeSupervisorSessionSnapshot[];
}>;

export type ProviderRuntimeSupervisorDrainResult = Readonly<{
  signalRef: string;
  occurrenceRef: string;
  state: ProviderRuntimeSupervisorState;
  eventId?: string;
  failure?: ProviderRuntimeSupervisorFailure;
}>;

export type ProviderRuntimeSupervisorTickReceipt = Readonly<{
  drainedSignals: readonly ProviderRuntimeSupervisorDrainResult[];
  snapshot: ProviderRuntimeSupervisorSnapshot;
}>;

export type ProviderRuntimeSupervisorOwnershipGuard = Readonly<{
  acquire(
    session: ProviderRuntimeSupervisorSessionRef,
    ownerRef: string,
  ): MaybePromise<ProviderRuntimeSupervisorOwnershipDecision>;
  release(session: ProviderRuntimeSupervisorSessionRef, ownerRef: string): MaybePromise<boolean>;
  currentOwner(session: ProviderRuntimeSupervisorSessionRef): MaybePromise<string | undefined>;
}>;

type MaybePromise<T> = T | Promise<T>;

export type ProviderRuntimeSupervisorOwnershipDecision =
  | Readonly<{
      acquired: true;
    }>
  | Readonly<{
      acquired: false;
      ownerRef: string;
    }>;

export type ProviderRuntimeSupervisorOptions = Readonly<{
  socketProvider: BaileysSocketProvider;
  signalIngress: ProviderSignalIngress;
  ownershipGuard?: ProviderRuntimeSupervisorOwnershipGuard;
  ownerRef?: string;
}>;

type ProviderRuntimeSupervisorSessionRecord = ProviderRuntimeSupervisorSessionRef & {
  state: ProviderRuntimeSupervisorState;
  ownerRef: string;
  transitions: ProviderRuntimeSupervisorState[];
  lastSignalRef?: string;
  failure?: ProviderRuntimeSupervisorFailure;
};

export class InMemoryProviderRuntimeSupervisorOwnershipGuard implements ProviderRuntimeSupervisorOwnershipGuard {
  private readonly owners = new Map<string, string>();

  acquire(
    session: ProviderRuntimeSupervisorSessionRef,
    ownerRef: string,
  ): ProviderRuntimeSupervisorOwnershipDecision {
    const key = sessionKey(session);
    const currentOwner = this.owners.get(key);

    if (currentOwner !== undefined && currentOwner !== ownerRef) {
      return Object.freeze({
        acquired: false,
        ownerRef: currentOwner,
      });
    }

    this.owners.set(key, ownerRef);

    return Object.freeze({
      acquired: true,
    });
  }

  release(session: ProviderRuntimeSupervisorSessionRef, ownerRef: string): boolean {
    const key = sessionKey(session);

    if (this.owners.get(key) !== ownerRef) {
      return false;
    }

    this.owners.delete(key);

    return true;
  }

  currentOwner(session: ProviderRuntimeSupervisorSessionRef): string | undefined {
    return this.owners.get(sessionKey(session));
  }
}

export class ProviderRuntimeSupervisor {
  private readonly socketProvider: BaileysSocketProvider;
  private readonly signalIngress: ProviderSignalIngress;
  private readonly ownershipGuard: ProviderRuntimeSupervisorOwnershipGuard;
  private readonly ownerRef: string;
  private readonly sessions = new Map<string, ProviderRuntimeSupervisorSessionRecord>();
  private loopTimer: ReturnType<typeof setInterval> | undefined;

  constructor(options: ProviderRuntimeSupervisorOptions) {
    this.socketProvider = options.socketProvider;
    this.signalIngress = options.signalIngress;
    this.ownershipGuard =
      options.ownershipGuard ?? new InMemoryProviderRuntimeSupervisorOwnershipGuard();
    this.ownerRef = options.ownerRef ?? `provider-runtime-supervisor:${randomUUID()}`;
  }

  async startSession(
    input: ProviderRuntimeSupervisorStartInput,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<ProviderRuntimeSupervisorSessionSnapshot>> {
    const existing = this.sessions.get(sessionKey(input));

    if (existing !== undefined && existing.state !== "DESTROYED") {
      return err(
        supervisorFailureAsApplicationPortFailure(
          duplicateSessionFailure("Provider runtime supervisor already owns this session."),
        ),
      );
    }

    const ownership = await this.ownershipGuard.acquire(input, this.ownerRef);

    if (!ownership.acquired) {
      return err(
        supervisorFailureAsApplicationPortFailure(
          duplicateSessionFailure("Another provider runtime supervisor already owns this session."),
        ),
      );
    }

    const session = this.createSession(input);
    this.transition(session, "STARTING");

    try {
      await this.socketProvider.startSession(socketRequest(input), context);
    } catch {
      const failure = safeFailure({
        code: "provider_runtime_supervisor_start_failed",
        message: "Provider runtime supervisor failed to start the provider socket.",
        retryable: true,
        source: "provider",
      });
      this.transition(session, "DISCONNECTED", undefined, failure);
      await this.ownershipGuard.release(input, this.ownerRef);

      return err(supervisorFailureAsApplicationPortFailure(failure));
    }

    return ok(snapshotSession(session));
  }

  async stopSession(
    input: ProviderRuntimeSupervisorStopInput,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<ProviderRuntimeSupervisorSessionSnapshot>> {
    const session = this.sessions.get(sessionKey(input));

    if (session === undefined) {
      return err(
        supervisorFailureAsApplicationPortFailure(
          safeFailure({
            code: "provider_runtime_supervisor_session_missing",
            message: "Provider runtime supervisor session is not active.",
            retryable: false,
            source: "runtime",
          }),
        ),
      );
    }

    try {
      await this.socketProvider.closeSession(socketRequest(input), context);
    } catch {
      const failure = safeFailure({
        code: "provider_runtime_supervisor_stop_failed",
        message: "Provider runtime supervisor failed to stop the provider socket.",
        retryable: true,
        source: "provider",
      });
      this.transition(session, "DISCONNECTED", undefined, failure);

      return err(supervisorFailureAsApplicationPortFailure(failure));
    } finally {
      await this.ownershipGuard.release(input, this.ownerRef);
    }

    this.transition(session, "DESTROYED");

    return ok(snapshotSession(session));
  }

  async tick(
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<ProviderRuntimeSupervisorTickReceipt>> {
    const drainedSignals: ProviderRuntimeSupervisorDrainResult[] = [];

    for (const session of this.sessions.values()) {
      if (session.state === "DESTROYED") {
        continue;
      }

      const renewal = shouldHoldOwnership(session.state)
        ? await this.ownershipGuard.acquire(session, this.ownerRef)
        : Object.freeze({ acquired: true } as const);

      if (!renewal.acquired) {
        this.transition(
          session,
          "DISCONNECTED",
          undefined,
          safeFailure({
            code: "provider_runtime_supervisor_ownership_lost",
            message: "Provider runtime supervisor lost ownership for this session.",
            retryable: true,
            source: "runtime",
          }),
        );
        continue;
      }

      const signals = this.socketProvider.drainSignals({
        sessionId: session.sessionId,
      });

      for (const signal of signals) {
        const ingressResult = await this.signalIngress.ingestSignal(signal, context);

        if (!ingressResult.ok) {
          const failure = safeFailure({
            code: "provider_runtime_supervisor_ingress_failed",
            message: "Provider runtime supervisor could not ingest a provider signal.",
            retryable: true,
            source: "ingress",
          });
          this.transition(session, "DISCONNECTED", signal.signalRef, failure);
          drainedSignals.push(
            Object.freeze({
              signalRef: signal.signalRef,
              occurrenceRef: signal.occurrenceRef,
              state: session.state,
              failure,
            }),
          );
          continue;
        }

        const nextState = stateFromSignal(signal, session.state);
        const failure = failureFromSignal(signal);

        if (nextState !== undefined) {
          this.transition(session, nextState, signal.signalRef, failure);
        } else {
          this.rememberSignal(session, signal.signalRef);
        }

        if (shouldSurrenderOwnership(signal)) {
          await this.ownershipGuard.release(session, this.ownerRef);
        }

        drainedSignals.push(
          Object.freeze({
            signalRef: signal.signalRef,
            occurrenceRef: signal.occurrenceRef,
            state: session.state,
            eventId: ingressResult.value.event.id,
          }),
        );
      }
    }

    return ok(
      Object.freeze({
        drainedSignals: Object.freeze(drainedSignals),
        snapshot: this.snapshot(),
      }),
    );
  }

  startDrainLoop(
    context: ApplicationPortContext,
    intervalMs = 1_000,
  ): Readonly<{ stop: () => void; keepsProcessAlive: true }> {
    if (this.loopTimer !== undefined) {
      return Object.freeze({
        stop: () => this.stopDrainLoop(),
        keepsProcessAlive: true,
      });
    }

    this.loopTimer = setInterval(() => {
      void this.tick(context);
    }, intervalMs);

    return Object.freeze({
      stop: () => this.stopDrainLoop(),
      keepsProcessAlive: true,
    });
  }

  stopDrainLoop(): void {
    if (this.loopTimer === undefined) {
      return;
    }

    clearInterval(this.loopTimer);
    this.loopTimer = undefined;
  }

  shutdown(): void {
    this.stopDrainLoop();

    for (const session of this.sessions.values()) {
      void Promise.resolve(this.ownershipGuard.release(session, this.ownerRef));
      if (session.state !== "DESTROYED") {
        this.transition(session, "DESTROYED");
      }
    }
  }

  snapshot(): ProviderRuntimeSupervisorSnapshot {
    return Object.freeze({
      ownerRef: this.ownerRef,
      sessions: Object.freeze([...this.sessions.values()].map(snapshotSession)),
    });
  }

  private createSession(
    input: ProviderRuntimeSupervisorSessionRef,
  ): ProviderRuntimeSupervisorSessionRecord {
    const session: ProviderRuntimeSupervisorSessionRecord = {
      instanceId: input.instanceId,
      providerId: input.providerId,
      sessionId: input.sessionId,
      ownerRef: this.ownerRef,
      state: "CREATED",
      transitions: ["CREATED"],
    };

    this.sessions.set(sessionKey(input), session);

    return session;
  }

  private transition(
    session: ProviderRuntimeSupervisorSessionRecord,
    state: ProviderRuntimeSupervisorState,
    signalRef?: string,
    failure?: ProviderRuntimeSupervisorFailure,
  ): void {
    if (session.state !== state) {
      session.state = state;
      session.transitions.push(state);
    }

    this.rememberSignal(session, signalRef);
    if (failure === undefined) {
      delete session.failure;
      return;
    }

    session.failure = failure;
  }

  private rememberSignal(
    session: ProviderRuntimeSupervisorSessionRecord,
    signalRef: string | undefined,
  ): void {
    if (signalRef !== undefined) {
      session.lastSignalRef = signalRef;
    }
  }
}

function socketRequest(
  input: ProviderRuntimeSupervisorStartInput | ProviderRuntimeSupervisorStopInput,
): BaileysSocketRequest {
  return Object.freeze({
    instanceId: input.instanceId,
    providerId: input.providerId,
    sessionId: input.sessionId,
    reasonCode: input.reasonCode,
  });
}

function stateFromSignal(
  signal: TranslatedProviderSignal,
  currentState: ProviderRuntimeSupervisorState,
): ProviderRuntimeSupervisorState | undefined {
  const signalCode = signal.signalRef.split(".").at(-1) ?? "";

  if (signal.kind === "auth") {
    if (signalCode === "qr_required") return "QR_REQUIRED";
    if (signalCode === "pairing") return "PAIRING";
    if (signalCode === "authenticated") return "CONNECTED";
    return currentState;
  }

  if (signal.kind === "connection") {
    if (signalCode === "connecting") return "STARTING";
    if (signalCode === "connected") return "CONNECTED";
    if (signalCode === "reconnecting") return "RECONNECTING";
    if (signalCode === "logged_out") return "LOGGED_OUT";
    if (signalCode === "disconnected") return "DISCONNECTED";
    return currentState;
  }

  if (signal.kind === "failure") {
    if (signalCode === "logged_out") return "LOGGED_OUT";
    if (signalCode === "connection_replaced") return "DISCONNECTED";
    return "DISCONNECTED";
  }

  return undefined;
}

function shouldHoldOwnership(state: ProviderRuntimeSupervisorState): boolean {
  return (
    state === "STARTING" ||
    state === "QR_REQUIRED" ||
    state === "PAIRING" ||
    state === "CONNECTED" ||
    state === "RECONNECTING"
  );
}

function failureFromSignal(
  signal: TranslatedProviderSignal,
): ProviderRuntimeSupervisorFailure | undefined {
  if (signal.kind !== "failure") {
    return undefined;
  }

  const signalCode = signal.signalRef.split(".").at(-1) ?? "failure";

  return safeFailure({
    code: `provider_signal_${signalCode}`,
    message: "Provider runtime supervisor received a provider failure signal.",
    retryable: signalCode !== "logged_out" && signalCode !== "connection_replaced",
    source: "provider",
  });
}

function shouldSurrenderOwnership(signal: TranslatedProviderSignal): boolean {
  return signal.kind === "failure" && signal.signalRef.split(".").at(-1) === "connection_replaced";
}

function snapshotSession(
  session: ProviderRuntimeSupervisorSessionRecord,
): ProviderRuntimeSupervisorSessionSnapshot {
  return Object.freeze({
    instanceId: session.instanceId,
    providerId: session.providerId,
    sessionId: session.sessionId,
    state: session.state,
    ownerRef: session.ownerRef,
    transitions: Object.freeze([...session.transitions]),
    ...optional("lastSignalRef", session.lastSignalRef),
    ...optional("failure", session.failure),
  });
}

function sessionKey(session: ProviderRuntimeSupervisorSessionRef): string {
  return `${String(session.instanceId)}::${String(session.sessionId)}`;
}

function duplicateSessionFailure(message: string): ProviderRuntimeSupervisorFailure {
  return safeFailure({
    code: "provider_runtime_supervisor_session_already_active",
    message,
    retryable: true,
    source: "runtime",
  });
}

function safeFailure(input: ProviderRuntimeSupervisorFailure): ProviderRuntimeSupervisorFailure {
  return Object.freeze({
    code: input.code,
    message: input.message,
    retryable: input.retryable,
    source: input.source,
  });
}

function supervisorFailureAsApplicationPortFailure(
  failure: ProviderRuntimeSupervisorFailure,
): ApplicationPortFailure {
  return Object.freeze({
    category: "unavailable",
    code: failure.code,
    message: failure.message,
    retryable: failure.retryable,
    ownerContext: "provider_integration",
    failureCategory: createFailureCategory("provider"),
    safeMetadata: Object.freeze({
      source: failure.source,
    }),
  });
}

function optional<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Record<TKey, TValue>);
}
