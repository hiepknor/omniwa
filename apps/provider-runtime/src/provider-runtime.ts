import {
  type ApplicationPortContext,
  type ApplicationPortFailure,
  type ApplicationPortFailureCategory,
  type MessagingProviderPort,
  type ProviderConnectionIntent,
  type ProviderConnectionRequest,
  type ProviderConnectionResult,
  type ProviderConnectionState,
  type ProviderQrPairingChallenge,
} from "@omniwa/application";
import { createSecretPurpose, type SecretName, type SecretProvider } from "@omniwa/config";
import {
  createFailureCategory,
  type FailureCategory,
  type InstanceId,
  type ProviderId,
  type SessionId,
} from "@omniwa/domain";
import type { ErrorCategory, OmniwaError } from "@omniwa/errors";
import {
  createMetricPoint,
  nullLogger,
  type MetricRecorder,
  type StructuredLogger,
} from "@omniwa/observability";
import { randomUUID } from "node:crypto";

export const providerRuntimeRole = "provider";
export const providerRuntimeSessionSecretPurpose = createSecretPurpose("provider-session");

export type ProviderRuntimeLifecycleState =
  | "idle"
  | "connecting"
  | "qr_required"
  | "connected"
  | "disconnected"
  | "logged_out"
  | "action_required"
  | "failed";

export type ProviderRuntimeFailureSource = "runtime" | "secret" | "provider";

export type ProviderRuntimeFailure = Readonly<{
  source: ProviderRuntimeFailureSource;
  category: ErrorCategory;
  code: string;
  message: string;
  retryable: boolean;
  providerPortCategory?: ApplicationPortFailureCategory;
  failureCategory?: FailureCategory;
}>;

export type ProviderRuntimeOperationResult<T> =
  | Readonly<{
      ok: true;
      state: ProviderRuntimeLifecycleState;
      value: T;
    }>
  | Readonly<{
      ok: false;
      state: "action_required" | "failed";
      failure: ProviderRuntimeFailure;
    }>;

export type ProviderRuntimeConnectionInput = Readonly<{
  instanceId: InstanceId;
  providerId: ProviderId;
  sessionId?: SessionId;
  sessionSecretName?: SecretName;
  intent?: Extract<ProviderConnectionIntent, "connect" | "reconnect">;
  reasonCode: string;
}>;

export type ProviderRuntimeQrPairingInput = Readonly<{
  instanceId: InstanceId;
  providerId: ProviderId;
  sessionId: SessionId;
  sessionSecretName?: SecretName;
  pairingAttemptRef: string;
}>;

export type ProviderRuntimeDisconnectInput = Readonly<{
  instanceId: InstanceId;
  providerId: ProviderId;
  sessionId?: SessionId;
  reasonCode: string;
}>;

export type ProviderRuntimeInstanceSnapshot = Readonly<{
  instanceId: InstanceId;
  providerId: ProviderId;
  state: ProviderRuntimeLifecycleState;
  ownerRef: string;
  providerSignalRef?: string;
  failure?: ProviderRuntimeFailure;
}>;

export type ProviderRuntimeSnapshot = Readonly<{
  ownerRef: string;
  instances: readonly ProviderRuntimeInstanceSnapshot[];
}>;

export type ProviderRuntimeOwnershipGuard = Readonly<{
  acquire(instanceId: InstanceId, ownerRef: string): ProviderRuntimeOwnershipDecision;
  release(instanceId: InstanceId, ownerRef: string): boolean;
  currentOwner(instanceId: InstanceId): string | undefined;
}>;

export type ProviderRuntimeOwnershipDecision =
  | Readonly<{
      acquired: true;
    }>
  | Readonly<{
      acquired: false;
      ownerRef: string;
    }>;

export type ProviderRuntimeOptions = Readonly<{
  provider: MessagingProviderPort;
  secretProvider: SecretProvider;
  ownershipGuard?: ProviderRuntimeOwnershipGuard;
  ownerRef?: string;
  logger?: StructuredLogger;
  metrics?: MetricRecorder;
}>;

export class InMemoryProviderRuntimeOwnershipGuard implements ProviderRuntimeOwnershipGuard {
  private readonly ownersByInstanceId = new Map<string, string>();

  acquire(instanceId: InstanceId, ownerRef: string): ProviderRuntimeOwnershipDecision {
    const key = instanceKey(instanceId);
    const currentOwner = this.ownersByInstanceId.get(key);

    if (currentOwner !== undefined && currentOwner !== ownerRef) {
      return Object.freeze({
        acquired: false,
        ownerRef: currentOwner,
      });
    }

    this.ownersByInstanceId.set(key, ownerRef);

    return Object.freeze({
      acquired: true,
    });
  }

  release(instanceId: InstanceId, ownerRef: string): boolean {
    const key = instanceKey(instanceId);

    if (this.ownersByInstanceId.get(key) !== ownerRef) {
      return false;
    }

    this.ownersByInstanceId.delete(key);

    return true;
  }

  currentOwner(instanceId: InstanceId): string | undefined {
    return this.ownersByInstanceId.get(instanceKey(instanceId));
  }

  snapshot(): ReadonlyMap<string, string> {
    return new Map(this.ownersByInstanceId);
  }
}

export class ProviderRuntime {
  private readonly provider: MessagingProviderPort;
  private readonly secretProvider: SecretProvider;
  private readonly ownershipGuard: ProviderRuntimeOwnershipGuard;
  private readonly ownerRef: string;
  private readonly logger: StructuredLogger;
  private readonly metrics: MetricRecorder | undefined;
  private readonly instancesById = new Map<string, ProviderRuntimeInstanceSnapshot>();

  constructor(options: ProviderRuntimeOptions) {
    this.provider = options.provider;
    this.secretProvider = options.secretProvider;
    this.ownershipGuard = options.ownershipGuard ?? new InMemoryProviderRuntimeOwnershipGuard();
    this.ownerRef = options.ownerRef ?? `provider-runtime:${randomUUID()}`;
    this.logger = options.logger ?? nullLogger;
    this.metrics = options.metrics;
  }

  async connect(
    input: ProviderRuntimeConnectionInput,
    context: ApplicationPortContext,
  ): Promise<ProviderRuntimeOperationResult<ProviderConnectionResult>> {
    const ownership = this.acquireOwnership(input.instanceId);

    if (!ownership.ok) {
      return this.recordFailure("connect", input, ownership, context);
    }

    const secret = await this.restoreSessionSecret(input.sessionSecretName);

    if (!secret.ok) {
      this.ownershipGuard.release(input.instanceId, this.ownerRef);
      return this.recordFailure("connect", input, secret, context);
    }

    this.setState(input, "connecting");

    const result = await this.provider.requestConnection(
      connectionRequestFromInput(input, input.intent ?? "connect"),
      context,
    );

    if (!result.ok) {
      this.ownershipGuard.release(input.instanceId, this.ownerRef);
      return this.recordFailure("connect", input, providerFailure(result.error), context);
    }

    return this.recordSuccess("connect", input, result.value, context);
  }

  async requestQrPairing(
    input: ProviderRuntimeQrPairingInput,
    context: ApplicationPortContext,
  ): Promise<ProviderRuntimeOperationResult<ProviderQrPairingChallenge>> {
    const ownership = this.acquireOwnership(input.instanceId);

    if (!ownership.ok) {
      return this.recordFailure("request_qr_pairing", input, ownership, context);
    }

    const secret = await this.restoreSessionSecret(input.sessionSecretName);

    if (!secret.ok) {
      this.ownershipGuard.release(input.instanceId, this.ownerRef);
      return this.recordFailure("request_qr_pairing", input, secret, context);
    }

    this.setState(input, "qr_required");

    const result = await this.provider.requestQrPairing(
      Object.freeze({
        instanceId: input.instanceId,
        providerId: input.providerId,
        sessionId: input.sessionId,
        pairingAttemptRef: input.pairingAttemptRef,
      }),
      context,
    );

    if (!result.ok) {
      this.ownershipGuard.release(input.instanceId, this.ownerRef);
      return this.recordFailure(
        "request_qr_pairing",
        input,
        providerFailure(result.error),
        context,
      );
    }

    return this.recordSuccess("request_qr_pairing", input, result.value, context, "qr_required");
  }

  async disconnect(
    input: ProviderRuntimeDisconnectInput,
    context: ApplicationPortContext,
  ): Promise<ProviderRuntimeOperationResult<ProviderConnectionResult>> {
    const result = await this.provider.disconnect(
      connectionRequestFromInput(input, "disconnect"),
      context,
    );

    if (!result.ok) {
      return this.recordFailure("disconnect", input, providerFailure(result.error), context);
    }

    this.ownershipGuard.release(input.instanceId, this.ownerRef);

    return this.recordSuccess("disconnect", input, result.value, context);
  }

  snapshot(): ProviderRuntimeSnapshot {
    return Object.freeze({
      ownerRef: this.ownerRef,
      instances: Object.freeze([...this.instancesById.values()]),
    });
  }

  private acquireOwnership(instanceId: InstanceId): ProviderRuntimeOperationResult<true> {
    const decision = this.ownershipGuard.acquire(instanceId, this.ownerRef);

    if (decision.acquired) {
      return Object.freeze({
        ok: true,
        state: "idle",
        value: true,
      });
    }

    return Object.freeze({
      ok: false,
      state: "action_required",
      failure: Object.freeze({
        source: "runtime",
        category: "infrastructure",
        code: "provider_runtime_already_active",
        message: "Another provider runtime already owns this instance.",
        retryable: true,
        failureCategory: createFailureCategory("provider"),
      }),
    });
  }

  private async restoreSessionSecret(
    sessionSecretName: SecretName | undefined,
  ): Promise<ProviderRuntimeOperationResult<true>> {
    if (sessionSecretName === undefined) {
      return Object.freeze({
        ok: true,
        state: "idle",
        value: true,
      });
    }

    const secret = await this.secretProvider.readSecret({
      name: sessionSecretName,
      purpose: providerRuntimeSessionSecretPurpose,
    });

    if (!secret.ok) {
      return Object.freeze({
        ok: false,
        state: "action_required",
        failure: secretFailure(secret.error),
      });
    }

    return Object.freeze({
      ok: true,
      state: "idle",
      value: true,
    });
  }

  private recordSuccess<T>(
    operation: string,
    input:
      | ProviderRuntimeConnectionInput
      | ProviderRuntimeQrPairingInput
      | ProviderRuntimeDisconnectInput,
    value: T,
    context: ApplicationPortContext,
    overrideState?: ProviderRuntimeLifecycleState,
  ): ProviderRuntimeOperationResult<T> {
    const state = overrideState ?? stateFromProviderValue(value);
    this.setState(input, state, providerSignalRefFromValue(value));
    this.recordTelemetry(operation, input, state, "success", context);

    return Object.freeze({
      ok: true,
      state,
      value,
    });
  }

  private recordFailure<T>(
    operation: string,
    input:
      | ProviderRuntimeConnectionInput
      | ProviderRuntimeQrPairingInput
      | ProviderRuntimeDisconnectInput,
    result: ProviderRuntimeOperationResult<T>,
    context: ApplicationPortContext,
  ): ProviderRuntimeOperationResult<T> {
    if (result.ok) {
      return result;
    }

    this.setState(input, result.state, undefined, result.failure);
    this.recordTelemetry(operation, input, result.state, "failure", context, result.failure);

    return result;
  }

  private setState(
    input:
      | ProviderRuntimeConnectionInput
      | ProviderRuntimeQrPairingInput
      | ProviderRuntimeDisconnectInput,
    state: ProviderRuntimeLifecycleState,
    providerSignalRef?: string,
    failure?: ProviderRuntimeFailure,
  ): void {
    this.instancesById.set(
      instanceKey(input.instanceId),
      freezeInstanceSnapshot({
        instanceId: input.instanceId,
        providerId: input.providerId,
        state,
        ownerRef: this.ownerRef,
        ...optionalValue("providerSignalRef", providerSignalRef),
        ...optionalValue("failure", failure),
      }),
    );
  }

  private recordTelemetry(
    operation: string,
    input:
      | ProviderRuntimeConnectionInput
      | ProviderRuntimeQrPairingInput
      | ProviderRuntimeDisconnectInput,
    state: ProviderRuntimeLifecycleState,
    outcome: "success" | "failure",
    context: ApplicationPortContext,
    failure?: ProviderRuntimeFailure,
  ): void {
    this.metrics?.recordMetric(
      createMetricPoint({
        name: "provider_runtime.operation.total",
        kind: "counter",
        value: 1,
        runtimeRole: providerRuntimeRole,
        labels: {
          operation,
          outcome,
          state,
          providerId: String(input.providerId),
          ...(failure === undefined ? {} : { failureCode: failure.code }),
        },
        context: {
          runtimeRole: providerRuntimeRole,
          correlationId: context.requestContext.correlationId,
          ...optionalValue("requestId", context.requestContext.requestId),
          ...optionalValue("traceId", context.requestContext.traceId),
        },
      }),
    );

    this.logger.write({
      level: outcome === "success" ? "info" : "warn",
      message: "Provider runtime operation completed.",
      context: {
        runtimeRole: providerRuntimeRole,
        correlationId: context.requestContext.correlationId,
        ...optionalValue("requestId", context.requestContext.requestId),
        ...optionalValue("traceId", context.requestContext.traceId),
      },
      fields: {
        operation,
        outcome,
        state,
        instanceId: String(input.instanceId),
        providerId: String(input.providerId),
        ...(failure === undefined
          ? {}
          : {
              failureCode: failure.code,
              failureSource: failure.source,
            }),
      },
    });
  }
}

function connectionRequestFromInput(
  input: ProviderRuntimeConnectionInput | ProviderRuntimeDisconnectInput,
  intent: ProviderConnectionIntent,
): ProviderConnectionRequest {
  return Object.freeze({
    instanceId: input.instanceId,
    providerId: input.providerId,
    intent,
    reasonCode: input.reasonCode,
    ...optionalValue("sessionId", input.sessionId),
  });
}

function stateFromProviderValue(value: unknown): ProviderRuntimeLifecycleState {
  if (isProviderConnectionResult(value)) {
    return runtimeStateFromProviderState(value.state);
  }

  return "qr_required";
}

function providerSignalRefFromValue(value: unknown): string | undefined {
  if (!isProviderConnectionResult(value)) {
    return undefined;
  }

  return value.providerSignalRef;
}

function runtimeStateFromProviderState(
  state: ProviderConnectionState,
): ProviderRuntimeLifecycleState {
  return state;
}

function isProviderConnectionResult(value: unknown): value is ProviderConnectionResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "state" in value &&
    typeof value.state === "string"
  );
}

function providerFailure(error: ApplicationPortFailure): ProviderRuntimeOperationResult<never> {
  return Object.freeze({
    ok: false,
    state: error.retryable ? "failed" : "action_required",
    failure: Object.freeze({
      source: "provider",
      category: "provider",
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      providerPortCategory: error.category,
      ...optionalValue("failureCategory", error.failureCategory),
    }),
  });
}

function secretFailure(error: OmniwaError): ProviderRuntimeFailure {
  return Object.freeze({
    source: "secret",
    category: error.category,
    code: error.code,
    message: error.message,
    retryable: error.retryable,
    failureCategory: createFailureCategory("configuration"),
  });
}

function freezeInstanceSnapshot(
  snapshot: ProviderRuntimeInstanceSnapshot,
): ProviderRuntimeInstanceSnapshot {
  return Object.freeze({
    ...snapshot,
    ...optionalValue("failure", snapshot.failure),
  });
}

function instanceKey(instanceId: InstanceId): string {
  return String(instanceId);
}

function optionalValue<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Partial<Record<TKey, TValue>>);
}
