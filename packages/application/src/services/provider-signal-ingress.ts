import { createFailureCategory } from "@omniwa/domain";
import { err, ok } from "@omniwa/shared";

import {
  createApplicationPortFailure,
  type ApplicationPortContext,
  type ApplicationPortFailure,
  type ApplicationPortResult,
} from "../ports/application-port.js";
import type {
  EventLogPort,
  PlatformEventPayload,
  PlatformEventRecord,
} from "../ports/event-log.js";
import type { TranslatedProviderSignal } from "../ports/messaging-provider.js";

export type ProviderSignalIngressReceipt = Readonly<{
  event: PlatformEventRecord;
}>;

export type ProviderSignalIngressOptions = Readonly<{
  eventLog: EventLogPort;
  nowIso: () => string;
}>;

export type ProviderSignalIngress = Readonly<{
  ingestSignal(
    signal: TranslatedProviderSignal,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<ProviderSignalIngressReceipt>>;
}>;

const providerSignalKinds = [
  "auth",
  "connection",
  "message_status",
  "inbound_message",
  "failure",
] as const satisfies readonly TranslatedProviderSignal["kind"][];

const providerSignalDataClassifications = [
  "internal",
  "confidential",
] as const satisfies readonly TranslatedProviderSignal["dataClassification"][];

const safeTokenPattern = /^[A-Za-z0-9_.:-]+$/u;
const safeQrChallengeRefPattern = /^qr_challenge_[a-f0-9]{16}$/u;
const providerSignalSafeMetadataKeys = [
  "challengeRef",
  "expiresAtEpochMilliseconds",
  "refreshPolicy",
  "reasonCode",
  "backoffMs",
] as const;

export function createProviderSignalIngress(
  options: ProviderSignalIngressOptions,
): ProviderSignalIngress {
  return new DefaultProviderSignalIngress(options);
}

export class DefaultProviderSignalIngress implements ProviderSignalIngress {
  private readonly eventLog: EventLogPort;
  private readonly nowIso: () => string;

  constructor(options: ProviderSignalIngressOptions) {
    this.eventLog = options.eventLog;
    this.nowIso = options.nowIso;
  }

  async ingestSignal(
    signal: TranslatedProviderSignal,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<ProviderSignalIngressReceipt>> {
    const validation = validateSignal(signal);

    if (!validation.ok) {
      return validation;
    }

    const appendResult = this.eventLog.appendEvent({
      id: deterministicProviderSignalEventId(signal),
      type: providerSignalEventType(signal.kind),
      timestamp: this.nowIso(),
      dataClassification: signal.dataClassification,
      source: "provider_runtime",
      resourceRef: signal.targetRef,
      correlationId: String(context.requestContext.correlationId),
      payload: providerSignalPayload(signal),
    });

    if (!appendResult.ok) {
      return appendResult;
    }

    return ok(
      Object.freeze({
        event: appendResult.value,
      }),
    );
  }
}

function validateSignal(
  signal: TranslatedProviderSignal,
): ApplicationPortResult<TranslatedProviderSignal> {
  if (!isProviderSignalKind(signal.kind)) {
    return err(
      providerSignalIngressFailure({
        code: "provider_signal_kind_unsupported",
        message: "Provider signal kind is not supported by SignalIngress.",
      }),
    );
  }

  if (!isProviderSignalDataClassification(signal.dataClassification)) {
    return err(
      providerSignalIngressFailure({
        code: "provider_signal_classification_unsupported",
        message: "Provider signal data classification is not supported by SignalIngress.",
        safeMetadata: {
          signalKind: signal.kind,
        },
      }),
    );
  }

  const tokenFields = [
    ["providerId", String(signal.providerId)],
    ["signalRef", signal.signalRef],
    ["targetRef", signal.targetRef],
    ["occurrenceRef", signal.occurrenceRef],
  ] as const;

  for (const [fieldName, value] of tokenFields) {
    if (!isSafeToken(value)) {
      return err(
        providerSignalIngressFailure({
          code: "provider_signal_ref_invalid",
          message: "Provider signal references must use safe opaque tokens.",
          safeMetadata: {
            fieldName,
            signalKind: signal.kind,
          },
        }),
      );
    }
  }

  if (signal.failureCategory !== undefined && !isSafeToken(String(signal.failureCategory))) {
    return err(
      providerSignalIngressFailure({
        code: "provider_signal_failure_category_invalid",
        message: "Provider signal failure category is not safe.",
        safeMetadata: {
          signalKind: signal.kind,
        },
      }),
    );
  }

  const metadataValidation = validateSafeMetadata(signal);

  if (!metadataValidation.ok) {
    return metadataValidation;
  }

  return ok(signal);
}

function providerSignalEventType(kind: TranslatedProviderSignal["kind"]): string {
  switch (kind) {
    case "auth":
      return "provider.auth.v1";
    case "connection":
      return "provider.connection.v1";
    case "message_status":
      return "provider.message_status.v1";
    case "inbound_message":
      return "provider.inbound_message.v1";
    case "failure":
      return "provider.failure.v1";
  }
}

function providerSignalPayload(signal: TranslatedProviderSignal): PlatformEventPayload {
  return Object.freeze({
    providerId: String(signal.providerId),
    signalRef: signal.signalRef,
    signalKind: signal.kind,
    targetRef: signal.targetRef,
    occurrenceRef: signal.occurrenceRef,
    dataClassification: signal.dataClassification,
    ...optional("failureCategory", signal.failureCategory?.toString()),
    ...(signal.safeMetadata ?? {}),
  });
}

function deterministicProviderSignalEventId(signal: TranslatedProviderSignal): string {
  return [
    "provider_signal",
    stableToken(String(signal.providerId)),
    stableToken(signal.occurrenceRef),
    signal.kind,
  ].join(":");
}

function isProviderSignalKind(value: unknown): value is TranslatedProviderSignal["kind"] {
  return providerSignalKinds.some((kind) => kind === value);
}

function isProviderSignalDataClassification(
  value: unknown,
): value is TranslatedProviderSignal["dataClassification"] {
  return providerSignalDataClassifications.some(
    (dataClassification) => dataClassification === value,
  );
}

function isSafeToken(value: string): boolean {
  return value.trim().length > 0 && safeTokenPattern.test(value);
}

function validateSafeMetadata(
  signal: TranslatedProviderSignal,
): ApplicationPortResult<TranslatedProviderSignal> {
  if (signal.safeMetadata === undefined) {
    return ok(signal);
  }

  for (const [key, value] of Object.entries(signal.safeMetadata)) {
    if (!isSupportedSafeMetadataKey(key)) {
      return err(
        providerSignalIngressFailure({
          code: "provider_signal_metadata_key_unsupported",
          message: "Provider signal metadata key is not supported by SignalIngress.",
          safeMetadata: {
            signalKind: signal.kind,
          },
        }),
      );
    }

    if (!isSafeMetadataValue(key, value)) {
      return err(
        providerSignalIngressFailure({
          code: "provider_signal_metadata_invalid",
          message: "Provider signal metadata value is not safe.",
          safeMetadata: {
            fieldName: key,
            signalKind: signal.kind,
          },
        }),
      );
    }
  }

  return ok(signal);
}

function isSupportedSafeMetadataKey(
  key: string,
): key is (typeof providerSignalSafeMetadataKeys)[number] {
  return providerSignalSafeMetadataKeys.some((safeKey) => safeKey === key);
}

function isSafeMetadataValue(key: string, value: unknown): boolean {
  switch (key) {
    case "challengeRef":
      return typeof value === "string" && safeQrChallengeRefPattern.test(value);
    case "expiresAtEpochMilliseconds":
    case "backoffMs":
      return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
    case "refreshPolicy":
      return value === "replace_active";
    case "reasonCode":
      return typeof value === "string" && isSafeToken(value);
    default:
      return false;
  }
}

function stableToken(value: string): string {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

function providerSignalIngressFailure(
  input: Readonly<{
    code: string;
    message: string;
    safeMetadata?: NonNullable<ApplicationPortFailure["safeMetadata"]>;
  }>,
): ApplicationPortFailure {
  return createApplicationPortFailure({
    category: "rejected",
    code: input.code,
    message: input.message,
    retryable: false,
    ownerContext: "provider_integration",
    failureCategory: createFailureCategory("provider"),
    ...optional("safeMetadata", input.safeMetadata),
  });
}

function optional<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Record<TKey, TValue>);
}
