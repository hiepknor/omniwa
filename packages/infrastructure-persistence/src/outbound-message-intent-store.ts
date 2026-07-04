import {
  createApplicationPortFailure,
  createOutboundMessageIntentRef,
  createTextOutboundMessageIntentInput,
  type ApplicationPortContext,
  type ApplicationPortFailure,
  type ApplicationPortFailureCategory,
  type ApplicationPortResult,
  type OutboundMessageIntentBinding,
  type OutboundMessageIntentReceipt,
  type OutboundMessageIntentRef,
  type OutboundMessageIntentStorePort,
  type StoredTextOutboundMessageIntent,
  type TextOutboundMessageIntentInput,
} from "@omniwa/application";
import type { MessageId } from "@omniwa/domain";
import {
  cryptoUUIDGenerator,
  err,
  ok,
  systemClock,
  type Clock,
  type UUIDGenerator,
} from "@omniwa/shared";

import { DurableJsonStateStore } from "./durable-json-state-store.js";

export type OutboundMessageIntentStoreOptions = Readonly<{
  clock?: Pick<Clock, "epochMilliseconds">;
  uuidGenerator?: UUIDGenerator;
}>;

export type DurableJsonOutboundMessageIntentStoreOptions = OutboundMessageIntentStoreOptions;

type EncodedIntentPayload = Readonly<{
  encoding: "base64-json";
  value: string;
}>;

type StoredEncodedTextIntent = Readonly<{
  outboundIntentRef: string;
  kind: "text";
  payload: EncodedIntentPayload;
  createdAtEpochMilliseconds: number;
  expiresAtEpochMilliseconds?: number;
  messageId?: string;
  messageIds?: readonly string[];
}>;

type OutboundMessageIntentStoreState = Readonly<{
  intents: readonly StoredEncodedTextIntent[];
}>;

type DecodedTextPayload = Readonly<{
  recipientRef: string;
  text: string;
}>;

export class InMemoryOutboundMessageIntentStore implements OutboundMessageIntentStorePort {
  protected state: OutboundMessageIntentStoreState = emptyState();
  private readonly clock: Pick<Clock, "epochMilliseconds">;
  private readonly uuidGenerator: UUIDGenerator;

  constructor(options: OutboundMessageIntentStoreOptions = {}) {
    this.clock = options.clock ?? systemClock;
    this.uuidGenerator = options.uuidGenerator ?? cryptoUUIDGenerator;
  }

  storeTextIntent(
    intent: TextOutboundMessageIntentInput,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<OutboundMessageIntentReceipt>> {
    return Promise.resolve(
      this.capturePortFailure(() => {
        void context;

        const safeInput = createTextOutboundMessageIntentInput(intent);
        const outboundIntentRef =
          safeInput.outboundIntentRef ?? this.createGeneratedOutboundIntentRef();
        const now = this.clock.epochMilliseconds();
        const existingIndex = this.indexOf(outboundIntentRef);
        const stored = freezeStoredIntent({
          outboundIntentRef: String(outboundIntentRef),
          kind: "text",
          payload: encodePayload({
            recipientRef: safeInput.recipientRef,
            text: safeInput.text,
          }),
          createdAtEpochMilliseconds:
            existingIndex < 0
              ? now
              : (this.state.intents[existingIndex]?.createdAtEpochMilliseconds ?? now),
          ...optional("expiresAtEpochMilliseconds", safeInput.expiresAtEpochMilliseconds),
        });
        const intents = [...this.state.intents];

        if (existingIndex < 0) {
          intents.push(stored);
        } else {
          intents[existingIndex] = mergeExistingBinding(stored, this.state.intents[existingIndex]);
        }

        this.state = freezeState({ intents: Object.freeze(intents) });
        this.persist();

        return ok(receiptFor(stored));
      }),
    );
  }

  bindMessageIntent(
    binding: OutboundMessageIntentBinding,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<OutboundMessageIntentBinding>> {
    return Promise.resolve(
      this.capturePortFailure(() => {
        void context;

        const index = this.indexOf(binding.outboundIntentRef);
        const existing = index < 0 ? undefined : this.state.intents[index];

        if (existing === undefined) {
          return err(
            intentFailure("rejected", "outbound_intent_not_found", binding.outboundIntentRef),
          );
        }

        const intents = [...this.state.intents];
        intents[index] = freezeStoredIntent({
          ...existing,
          messageId: String(binding.messageId),
          messageIds: addBindingMessageId(existing, binding.messageId),
        });
        this.state = freezeState({ intents: Object.freeze(intents) });
        this.persist();

        return ok(Object.freeze({ ...binding }));
      }),
    );
  }

  verifyTextIntent(
    outboundIntentRef: OutboundMessageIntentRef,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<OutboundMessageIntentReceipt>> {
    return Promise.resolve(
      this.capturePortFailure(() => {
        void context;

        const result = this.findAvailableTextIntent(outboundIntentRef);

        return result.ok ? ok(receiptFor(result.value)) : result;
      }),
    );
  }

  findTextIntentByMessage(
    messageId: MessageId,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<OutboundMessageIntentReceipt>> {
    return Promise.resolve(
      this.capturePortFailure(() => {
        void context;

        const result = this.findAvailableTextIntentByMessage(messageId);

        return result.ok ? ok(receiptFor(result.value)) : result;
      }),
    );
  }

  resolveTextIntent(
    outboundIntentRef: OutboundMessageIntentRef,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<StoredTextOutboundMessageIntent>> {
    return Promise.resolve(
      this.capturePortFailure(() => {
        void context;

        const result = this.findAvailableTextIntent(outboundIntentRef);

        if (!result.ok) {
          return result;
        }

        const payload = decodePayload(result.value.payload);

        return ok(
          freezeResolvedIntent({
            outboundIntentRef: createOutboundMessageIntentRef(result.value.outboundIntentRef),
            kind: "text",
            recipientRef: payload.recipientRef,
            text: payload.text,
            createdAtEpochMilliseconds: result.value.createdAtEpochMilliseconds,
            ...optional("expiresAtEpochMilliseconds", result.value.expiresAtEpochMilliseconds),
            ...optional("messageId", result.value.messageId as MessageId | undefined),
          }),
        );
      }),
    );
  }

  snapshot(): OutboundMessageIntentStoreState {
    return freezeState(this.state);
  }

  protected persist(): void {
    // In-memory store has no external durability boundary.
  }

  private createGeneratedOutboundIntentRef(): OutboundMessageIntentRef {
    return createOutboundMessageIntentRef(`outbound_intent:${this.uuidGenerator.random()}`);
  }

  private indexOf(outboundIntentRef: OutboundMessageIntentRef): number {
    const key = String(outboundIntentRef);
    return this.state.intents.findIndex((intent) => intent.outboundIntentRef === key);
  }

  private findAvailableTextIntent(
    outboundIntentRef: OutboundMessageIntentRef,
  ): ApplicationPortResult<StoredEncodedTextIntent> {
    const stored = this.state.intents[this.indexOf(outboundIntentRef)];

    if (stored === undefined) {
      return err(intentFailure("rejected", "outbound_intent_not_found", outboundIntentRef));
    }

    if (isExpired(stored, this.clock.epochMilliseconds())) {
      return err(intentFailure("rejected", "outbound_intent_expired", outboundIntentRef));
    }

    return ok(stored);
  }

  private findAvailableTextIntentByMessage(
    messageId: MessageId,
  ): ApplicationPortResult<StoredEncodedTextIntent> {
    const key = String(messageId);
    const stored = this.state.intents.find((intent) => intentIsBoundToMessage(intent, key));

    if (stored === undefined) {
      return err(intentFailureForMessage("rejected", "outbound_intent_not_found", messageId));
    }

    if (isExpired(stored, this.clock.epochMilliseconds())) {
      return err(intentFailureForMessage("rejected", "outbound_intent_expired", messageId));
    }

    return ok(stored);
  }

  private capturePortFailure<T>(action: () => ApplicationPortResult<T>): ApplicationPortResult<T> {
    try {
      return action();
    } catch {
      return err(intentFailure("unsafe_payload", "outbound_intent_store_rejected"));
    }
  }
}

export class DurableJsonOutboundMessageIntentStore extends InMemoryOutboundMessageIntentStore {
  private readonly store: DurableJsonStateStore<OutboundMessageIntentStoreState>;

  constructor(filePath: string, options: DurableJsonOutboundMessageIntentStoreOptions = {}) {
    const store = new DurableJsonStateStore(filePath, emptyState);
    super(options);
    this.store = store;
    this.state = freezeState(store.read());
  }

  protected override persist(): void {
    this.store.write(this.state);
  }
}

function emptyState(): OutboundMessageIntentStoreState {
  return freezeState({ intents: Object.freeze([]) });
}

function encodePayload(payload: DecodedTextPayload): EncodedIntentPayload {
  return Object.freeze({
    encoding: "base64-json",
    value: Buffer.from(JSON.stringify(payload), "utf8").toString("base64"),
  });
}

function decodePayload(payload: EncodedIntentPayload): DecodedTextPayload {
  if (payload.encoding !== "base64-json") {
    throw new TypeError("Unsupported outbound intent payload encoding.");
  }

  const decoded = JSON.parse(
    Buffer.from(payload.value, "base64").toString("utf8"),
  ) as Partial<DecodedTextPayload>;

  if (typeof decoded.recipientRef !== "string" || typeof decoded.text !== "string") {
    throw new TypeError("Outbound intent payload is invalid.");
  }

  return Object.freeze({
    recipientRef: decoded.recipientRef,
    text: decoded.text,
  });
}

function isExpired(intent: StoredEncodedTextIntent, now: number): boolean {
  return (
    intent.expiresAtEpochMilliseconds !== undefined && intent.expiresAtEpochMilliseconds <= now
  );
}

function receiptFor(intent: StoredEncodedTextIntent): OutboundMessageIntentReceipt {
  return Object.freeze({
    outboundIntentRef: createOutboundMessageIntentRef(intent.outboundIntentRef),
    kind: "text",
    createdAtEpochMilliseconds: intent.createdAtEpochMilliseconds,
    ...optional("expiresAtEpochMilliseconds", intent.expiresAtEpochMilliseconds),
  });
}

function mergeExistingBinding(
  next: StoredEncodedTextIntent,
  existing: StoredEncodedTextIntent | undefined,
): StoredEncodedTextIntent {
  if (existing?.messageId === undefined) {
    return existing?.messageIds === undefined
      ? next
      : freezeStoredIntent({
          ...next,
          messageIds: existing.messageIds,
        });
  }

  return freezeStoredIntent({
    ...next,
    messageId: existing.messageId,
    messageIds: addBindingMessageId(existing, existing.messageId as MessageId),
  });
}

function freezeStoredIntent(input: StoredEncodedTextIntent): StoredEncodedTextIntent {
  return Object.freeze({
    ...input,
    payload: Object.freeze(input.payload),
    ...(input.messageIds === undefined ? {} : { messageIds: Object.freeze([...input.messageIds]) }),
  });
}

function freezeResolvedIntent(
  input: StoredTextOutboundMessageIntent,
): StoredTextOutboundMessageIntent {
  return Object.freeze(input);
}

function freezeState(state: OutboundMessageIntentStoreState): OutboundMessageIntentStoreState {
  return Object.freeze({
    intents: Object.freeze(state.intents.map((intent) => freezeStoredIntent(intent))),
  });
}

function intentFailure(
  category: ApplicationPortFailureCategory,
  code: string,
  outboundIntentRef?: OutboundMessageIntentRef,
): ApplicationPortFailure {
  return createApplicationPortFailure({
    category,
    code,
    message: "Outbound message intent store operation failed.",
    retryable: false,
    ownerContext: "messaging",
    ...(outboundIntentRef === undefined
      ? {}
      : {
          safeMetadata: {
            outboundIntentRef: String(outboundIntentRef),
          },
        }),
  });
}

function intentFailureForMessage(
  category: ApplicationPortFailureCategory,
  code: string,
  messageId: MessageId,
): ApplicationPortFailure {
  return createApplicationPortFailure({
    category,
    code,
    message: "Outbound message intent store operation failed.",
    retryable: false,
    ownerContext: "messaging",
    safeMetadata: {
      messageId: String(messageId),
    },
  });
}

function addBindingMessageId(
  existing: StoredEncodedTextIntent,
  messageId: MessageId,
): readonly string[] {
  return Object.freeze(
    [...new Set([...(existing.messageIds ?? []), existing.messageId, String(messageId)])].filter(
      (value): value is string => value !== undefined,
    ),
  );
}

function intentIsBoundToMessage(intent: StoredEncodedTextIntent, messageId: string): boolean {
  return intent.messageId === messageId || (intent.messageIds ?? []).includes(messageId);
}

function optional<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Record<TKey, TValue>);
}
