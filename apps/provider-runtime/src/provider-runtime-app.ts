import {
  type ApplicationPortContext,
  type MessagingProviderPort,
  type ProviderConnectionResult,
  type ProviderQrPairingChallenge,
} from "@omniwa/application";
import type { SecretProvider } from "@omniwa/config";
import type { MetricRecorder, StructuredLogger } from "@omniwa/observability";
import { createCorrelationId, createRequestContext, createRequestId } from "@omniwa/shared";
import { randomUUID } from "node:crypto";

import {
  InMemoryProviderRuntimeOwnershipGuard,
  ProviderRuntime,
  type ProviderRuntimeConnectionInput,
  type ProviderRuntimeDisconnectInput,
  type ProviderRuntimeOperationResult,
  type ProviderRuntimeOwnershipGuard,
  type ProviderRuntimeQrPairingInput,
  type ProviderRuntimeSignalSink,
  type ProviderRuntimeSnapshot,
} from "./provider-runtime.js";

export const providerRuntimeAppActorRef = "provider-runtime";

export const providerRuntimeAppActions = [
  "connect",
  "reconnect",
  "request_qr_pairing",
  "disconnect",
] as const;

export type ProviderRuntimeAppAction = (typeof providerRuntimeAppActions)[number];

export type ProviderRuntimeAppCommand =
  | Readonly<{
      action: "connect";
      input: ProviderRuntimeConnectionInput;
    }>
  | Readonly<{
      action: "reconnect";
      input: Omit<ProviderRuntimeConnectionInput, "intent">;
    }>
  | Readonly<{
      action: "request_qr_pairing";
      input: ProviderRuntimeQrPairingInput;
    }>
  | Readonly<{
      action: "disconnect";
      input: ProviderRuntimeDisconnectInput;
    }>;

export type ProviderRuntimeAppResult = Readonly<{
  action: ProviderRuntimeAppAction;
  result: ProviderRuntimeOperationResult<ProviderConnectionResult | ProviderQrPairingChallenge>;
  snapshot: ProviderRuntimeSnapshot;
}>;

export type ProviderRuntimeAppOptions = Readonly<{
  runtime: ProviderRuntime;
  contextFactory?: () => ApplicationPortContext;
}>;

export type ProviderRuntimeAppFactoryOptions = Readonly<{
  provider: MessagingProviderPort;
  secretProvider: SecretProvider;
  ownershipGuard?: ProviderRuntimeOwnershipGuard;
  ownerRef?: string;
  logger?: StructuredLogger;
  metrics?: MetricRecorder;
  signalSink?: ProviderRuntimeSignalSink;
  contextFactory?: () => ApplicationPortContext;
}>;

export class ProviderRuntimeApp {
  private readonly runtime: ProviderRuntime;
  private readonly contextFactory: () => ApplicationPortContext;

  constructor(options: ProviderRuntimeAppOptions) {
    this.runtime = options.runtime;
    this.contextFactory = options.contextFactory ?? createProviderRuntimeContext;
  }

  async runOnce(
    command: ProviderRuntimeAppCommand,
    context: ApplicationPortContext = this.contextFactory(),
  ): Promise<ProviderRuntimeAppResult> {
    const result = await this.execute(command, context);

    return Object.freeze({
      action: command.action,
      result,
      snapshot: this.runtime.snapshot(),
    });
  }

  private execute(
    command: ProviderRuntimeAppCommand,
    context: ApplicationPortContext,
  ): Promise<
    ProviderRuntimeOperationResult<ProviderConnectionResult | ProviderQrPairingChallenge>
  > {
    switch (command.action) {
      case "connect":
        return this.runtime.connect(command.input, context);
      case "reconnect":
        return this.runtime.connect(
          Object.freeze({
            ...command.input,
            intent: "reconnect",
          }),
          context,
        );
      case "request_qr_pairing":
        return this.runtime.requestQrPairing(command.input, context);
      case "disconnect":
        return this.runtime.disconnect(command.input, context);
    }
  }
}

export function createProviderRuntimeApp(options: ProviderRuntimeAppFactoryOptions) {
  return new ProviderRuntimeApp({
    runtime: new ProviderRuntime({
      provider: options.provider,
      secretProvider: options.secretProvider,
      ownershipGuard: options.ownershipGuard ?? new InMemoryProviderRuntimeOwnershipGuard(),
      ...optional("ownerRef", options.ownerRef),
      ...optional("logger", options.logger),
      ...optional("metrics", options.metrics),
      ...optional("signalSink", options.signalSink),
    }),
    ...optional("contextFactory", options.contextFactory),
  });
}

export function createProviderRuntimeContext(): ApplicationPortContext {
  const id = randomUUID();

  return Object.freeze({
    requestContext: createRequestContext({
      correlationId: createCorrelationId(`provider-runtime:${id}`),
      requestId: createRequestId(`provider-runtime:${id}`),
    }),
    actorRef: providerRuntimeAppActorRef,
    idempotencyKey: `provider-runtime:${id}`,
    dataClassification: "internal",
  });
}

function optional<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Record<TKey, TValue>);
}
