import {
  createApplicationPortFailure,
  createWebhookDeliveryOperationIntentInput,
  createWebhookDeliveryOperationIntentRef,
  type ApplicationPortContext,
  type ApplicationPortFailure,
  type ApplicationPortFailureCategory,
  type ApplicationPortResult,
  type StoredWebhookDeliveryOperationIntent,
  type WebhookDeliveryOperationIntentInput,
  type WebhookDeliveryOperationIntentReceipt,
  type WebhookDeliveryOperationIntentRef,
  type WebhookDeliveryOperationIntentStorePort,
} from "@omniwa/application";
import {
  cryptoUUIDGenerator,
  err,
  ok,
  systemClock,
  type Clock,
  type UUIDGenerator,
} from "@omniwa/shared";

import { DurableJsonStateStore } from "./durable-json-state-store.js";

export type WebhookDeliveryOperationIntentStoreOptions = Readonly<{
  clock?: Pick<Clock, "epochMilliseconds">;
  uuidGenerator?: UUIDGenerator;
}>;

export type DurableJsonWebhookDeliveryOperationIntentStoreOptions =
  WebhookDeliveryOperationIntentStoreOptions;

type EncodedIntentPayload = Readonly<{
  encoding: "base64-json";
  value: string;
}>;

type StoredEncodedWebhookDeliveryOperationIntent = Readonly<{
  webhookDeliveryOperationIntentRef: string;
  kind: WebhookDeliveryOperationIntentInput["kind"];
  payload: EncodedIntentPayload;
  createdAtEpochMilliseconds: number;
  expiresAtEpochMilliseconds?: number;
}>;

type WebhookDeliveryOperationIntentStoreState = Readonly<{
  intents: readonly StoredEncodedWebhookDeliveryOperationIntent[];
}>;

export class InMemoryWebhookDeliveryOperationIntentStore implements WebhookDeliveryOperationIntentStorePort {
  protected state: WebhookDeliveryOperationIntentStoreState = emptyState();
  private readonly clock: Pick<Clock, "epochMilliseconds">;
  private readonly uuidGenerator: UUIDGenerator;

  constructor(options: WebhookDeliveryOperationIntentStoreOptions = {}) {
    this.clock = options.clock ?? systemClock;
    this.uuidGenerator = options.uuidGenerator ?? cryptoUUIDGenerator;
  }

  storeWebhookDeliveryOperationIntent(
    intent: WebhookDeliveryOperationIntentInput,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<WebhookDeliveryOperationIntentReceipt>> {
    return Promise.resolve(
      this.capturePortFailure(() => {
        void context;

        const safeInput = createWebhookDeliveryOperationIntentInput(intent);
        const webhookDeliveryOperationIntentRef =
          safeInput.webhookDeliveryOperationIntentRef ??
          this.createGeneratedWebhookDeliveryOperationIntentRef();
        const now = this.clock.epochMilliseconds();
        const existingIndex = this.indexOf(webhookDeliveryOperationIntentRef);
        const stored = freezeStoredIntent({
          webhookDeliveryOperationIntentRef: String(webhookDeliveryOperationIntentRef),
          kind: safeInput.kind,
          payload: encodePayload(safeInput),
          createdAtEpochMilliseconds:
            existingIndex < 0
              ? now
              : (this.state.intents[existingIndex]?.createdAtEpochMilliseconds ?? now),
          ...(safeInput.expiresAtEpochMilliseconds === undefined
            ? {}
            : { expiresAtEpochMilliseconds: safeInput.expiresAtEpochMilliseconds }),
        });
        const intents = [...this.state.intents];

        if (existingIndex < 0) {
          intents.push(stored);
        } else {
          intents[existingIndex] = stored;
        }

        this.state = freezeState({ intents: Object.freeze(intents) });
        this.persist();

        return ok(receiptFor(stored));
      }),
    );
  }

  resolveWebhookDeliveryOperationIntent(
    webhookDeliveryOperationIntentRef: WebhookDeliveryOperationIntentRef,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<StoredWebhookDeliveryOperationIntent>> {
    return Promise.resolve(
      this.capturePortFailure(() => {
        void context;

        const result = this.findAvailableWebhookDeliveryOperationIntent(
          webhookDeliveryOperationIntentRef,
        );

        if (!result.ok) {
          return result;
        }

        const payload = decodePayload(result.value.payload);

        return ok(
          freezeResolvedIntent({
            ...payload,
            webhookDeliveryOperationIntentRef: createWebhookDeliveryOperationIntentRef(
              result.value.webhookDeliveryOperationIntentRef,
            ),
            createdAtEpochMilliseconds: result.value.createdAtEpochMilliseconds,
            ...(result.value.expiresAtEpochMilliseconds === undefined
              ? {}
              : { expiresAtEpochMilliseconds: result.value.expiresAtEpochMilliseconds }),
          }),
        );
      }),
    );
  }

  snapshot(): WebhookDeliveryOperationIntentStoreState {
    return freezeState(this.state);
  }

  protected persist(): void {
    // In-memory store has no external durability boundary.
  }

  private createGeneratedWebhookDeliveryOperationIntentRef(): WebhookDeliveryOperationIntentRef {
    return createWebhookDeliveryOperationIntentRef(
      `webhook_delivery_operation_intent:${this.uuidGenerator.random()}`,
    );
  }

  private indexOf(webhookDeliveryOperationIntentRef: WebhookDeliveryOperationIntentRef): number {
    const key = String(webhookDeliveryOperationIntentRef);
    return this.state.intents.findIndex(
      (intent) => intent.webhookDeliveryOperationIntentRef === key,
    );
  }

  private findAvailableWebhookDeliveryOperationIntent(
    webhookDeliveryOperationIntentRef: WebhookDeliveryOperationIntentRef,
  ): ApplicationPortResult<StoredEncodedWebhookDeliveryOperationIntent> {
    const stored = this.state.intents[this.indexOf(webhookDeliveryOperationIntentRef)];

    if (stored === undefined) {
      return err(
        webhookDeliveryOperationIntentFailure(
          "rejected",
          "webhook_delivery_operation_intent_not_found",
        ),
      );
    }

    if (isExpired(stored, this.clock.epochMilliseconds())) {
      return err(
        webhookDeliveryOperationIntentFailure(
          "rejected",
          "webhook_delivery_operation_intent_expired",
        ),
      );
    }

    return ok(stored);
  }

  private capturePortFailure<T>(action: () => ApplicationPortResult<T>): ApplicationPortResult<T> {
    try {
      return action();
    } catch {
      return err(
        webhookDeliveryOperationIntentFailure(
          "unsafe_payload",
          "webhook_delivery_operation_intent_store_rejected",
        ),
      );
    }
  }
}

export class DurableJsonWebhookDeliveryOperationIntentStore extends InMemoryWebhookDeliveryOperationIntentStore {
  private readonly store: DurableJsonStateStore<WebhookDeliveryOperationIntentStoreState>;

  constructor(
    filePath: string,
    options: DurableJsonWebhookDeliveryOperationIntentStoreOptions = {},
  ) {
    const store = new DurableJsonStateStore(filePath, emptyState);
    super(options);
    this.store = store;
    this.state = freezeState(store.read());
  }

  protected override persist(): void {
    this.store.write(this.state);
  }
}

function emptyState(): WebhookDeliveryOperationIntentStoreState {
  return freezeState({ intents: Object.freeze([]) });
}

function encodePayload(payload: WebhookDeliveryOperationIntentInput): EncodedIntentPayload {
  return Object.freeze({
    encoding: "base64-json",
    value: Buffer.from(JSON.stringify(payload), "utf8").toString("base64"),
  });
}

function decodePayload(payload: EncodedIntentPayload): WebhookDeliveryOperationIntentInput {
  if (payload.encoding !== "base64-json") {
    throw new TypeError("Unsupported webhook delivery operation intent payload encoding.");
  }

  const decoded = JSON.parse(
    Buffer.from(payload.value, "base64").toString("utf8"),
  ) as WebhookDeliveryOperationIntentInput;

  return createWebhookDeliveryOperationIntentInput(decoded);
}

function receiptFor(
  intent: StoredEncodedWebhookDeliveryOperationIntent,
): WebhookDeliveryOperationIntentReceipt {
  const payload = decodePayload(intent.payload);

  return Object.freeze({
    webhookDeliveryOperationIntentRef: createWebhookDeliveryOperationIntentRef(
      intent.webhookDeliveryOperationIntentRef,
    ),
    kind: intent.kind,
    deliveryCount: payload.kind === "bulk_redrive" ? payload.deliveryRefs.length : 0,
    createdAtEpochMilliseconds: intent.createdAtEpochMilliseconds,
    ...(intent.expiresAtEpochMilliseconds === undefined
      ? {}
      : { expiresAtEpochMilliseconds: intent.expiresAtEpochMilliseconds }),
  });
}

function isExpired(intent: StoredEncodedWebhookDeliveryOperationIntent, now: number): boolean {
  return (
    intent.expiresAtEpochMilliseconds !== undefined && intent.expiresAtEpochMilliseconds <= now
  );
}

function freezeStoredIntent(
  input: StoredEncodedWebhookDeliveryOperationIntent,
): StoredEncodedWebhookDeliveryOperationIntent {
  return Object.freeze({
    ...input,
    payload: Object.freeze(input.payload),
  });
}

function freezeResolvedIntent(
  input: StoredWebhookDeliveryOperationIntent,
): StoredWebhookDeliveryOperationIntent {
  return Object.freeze(input);
}

function freezeState(
  state: WebhookDeliveryOperationIntentStoreState,
): WebhookDeliveryOperationIntentStoreState {
  return Object.freeze({
    intents: Object.freeze(state.intents.map((intent) => freezeStoredIntent(intent))),
  });
}

function webhookDeliveryOperationIntentFailure(
  category: ApplicationPortFailureCategory,
  code: string,
): ApplicationPortFailure {
  return createApplicationPortFailure({
    category,
    code,
    message: "Webhook delivery operation intent store operation failed.",
    retryable: false,
    ownerContext: "webhook_delivery",
  });
}
