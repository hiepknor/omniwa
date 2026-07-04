import {
  createApplicationPortFailure,
  createGroupMutationIntentInput,
  createGroupMutationIntentRef,
  type ApplicationPortContext,
  type ApplicationPortFailure,
  type ApplicationPortFailureCategory,
  type ApplicationPortResult,
  type GroupMutationIntentInput,
  type GroupMutationIntentReceipt,
  type GroupMutationIntentRef,
  type GroupMutationIntentStorePort,
  type StoredGroupMutationIntent,
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

export type GroupMutationIntentStoreOptions = Readonly<{
  clock?: Pick<Clock, "epochMilliseconds">;
  uuidGenerator?: UUIDGenerator;
}>;

export type DurableJsonGroupMutationIntentStoreOptions = GroupMutationIntentStoreOptions;

type EncodedIntentPayload = Readonly<{
  encoding: "base64-json";
  value: string;
}>;

type StoredEncodedGroupMutationIntent = Readonly<{
  groupMutationIntentRef: string;
  kind: GroupMutationIntentInput["kind"];
  payload: EncodedIntentPayload;
  createdAtEpochMilliseconds: number;
  expiresAtEpochMilliseconds?: number;
}>;

type GroupMutationIntentStoreState = Readonly<{
  intents: readonly StoredEncodedGroupMutationIntent[];
}>;

export class InMemoryGroupMutationIntentStore implements GroupMutationIntentStorePort {
  protected state: GroupMutationIntentStoreState = emptyState();
  private readonly clock: Pick<Clock, "epochMilliseconds">;
  private readonly uuidGenerator: UUIDGenerator;

  constructor(options: GroupMutationIntentStoreOptions = {}) {
    this.clock = options.clock ?? systemClock;
    this.uuidGenerator = options.uuidGenerator ?? cryptoUUIDGenerator;
  }

  storeGroupMutationIntent(
    intent: GroupMutationIntentInput,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<GroupMutationIntentReceipt>> {
    return Promise.resolve(
      this.capturePortFailure(() => {
        void context;

        const safeInput = createGroupMutationIntentInput(intent);
        const groupMutationIntentRef =
          safeInput.groupMutationIntentRef ?? this.createGeneratedGroupMutationIntentRef();
        const now = this.clock.epochMilliseconds();
        const existingIndex = this.indexOf(groupMutationIntentRef);
        const stored = freezeStoredIntent({
          groupMutationIntentRef: String(groupMutationIntentRef),
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

  resolveGroupMutationIntent(
    groupMutationIntentRef: GroupMutationIntentRef,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<StoredGroupMutationIntent>> {
    return Promise.resolve(
      this.capturePortFailure(() => {
        void context;

        const result = this.findAvailableGroupMutationIntent(groupMutationIntentRef);

        if (!result.ok) {
          return result;
        }

        const payload = decodePayload(result.value.payload);

        return ok(
          freezeResolvedIntent({
            ...payload,
            groupMutationIntentRef: createGroupMutationIntentRef(
              result.value.groupMutationIntentRef,
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

  snapshot(): GroupMutationIntentStoreState {
    return freezeState(this.state);
  }

  protected persist(): void {
    // In-memory store has no external durability boundary.
  }

  private createGeneratedGroupMutationIntentRef(): GroupMutationIntentRef {
    return createGroupMutationIntentRef(`group_mutation_intent:${this.uuidGenerator.random()}`);
  }

  private indexOf(groupMutationIntentRef: GroupMutationIntentRef): number {
    const key = String(groupMutationIntentRef);
    return this.state.intents.findIndex((intent) => intent.groupMutationIntentRef === key);
  }

  private findAvailableGroupMutationIntent(
    groupMutationIntentRef: GroupMutationIntentRef,
  ): ApplicationPortResult<StoredEncodedGroupMutationIntent> {
    const stored = this.state.intents[this.indexOf(groupMutationIntentRef)];

    if (stored === undefined) {
      return err(groupMutationIntentFailure("rejected", "group_mutation_intent_not_found"));
    }

    if (isExpired(stored, this.clock.epochMilliseconds())) {
      return err(groupMutationIntentFailure("rejected", "group_mutation_intent_expired"));
    }

    return ok(stored);
  }

  private capturePortFailure<T>(action: () => ApplicationPortResult<T>): ApplicationPortResult<T> {
    try {
      return action();
    } catch {
      return err(
        groupMutationIntentFailure("unsafe_payload", "group_mutation_intent_store_rejected"),
      );
    }
  }
}

export class DurableJsonGroupMutationIntentStore extends InMemoryGroupMutationIntentStore {
  private readonly store: DurableJsonStateStore<GroupMutationIntentStoreState>;

  constructor(filePath: string, options: DurableJsonGroupMutationIntentStoreOptions = {}) {
    const store = new DurableJsonStateStore(filePath, emptyState);
    super(options);
    this.store = store;
    this.state = freezeState(store.read());
  }

  protected override persist(): void {
    this.store.write(this.state);
  }
}

function emptyState(): GroupMutationIntentStoreState {
  return freezeState({ intents: Object.freeze([]) });
}

function encodePayload(payload: GroupMutationIntentInput): EncodedIntentPayload {
  return Object.freeze({
    encoding: "base64-json",
    value: Buffer.from(JSON.stringify(payload), "utf8").toString("base64"),
  });
}

function decodePayload(payload: EncodedIntentPayload): GroupMutationIntentInput {
  if (payload.encoding !== "base64-json") {
    throw new TypeError("Unsupported group mutation intent payload encoding.");
  }

  const decoded = JSON.parse(
    Buffer.from(payload.value, "base64").toString("utf8"),
  ) as GroupMutationIntentInput;

  return createGroupMutationIntentInput(decoded);
}

function receiptFor(intent: StoredEncodedGroupMutationIntent): GroupMutationIntentReceipt {
  return Object.freeze({
    groupMutationIntentRef: createGroupMutationIntentRef(intent.groupMutationIntentRef),
    kind: intent.kind,
    createdAtEpochMilliseconds: intent.createdAtEpochMilliseconds,
    ...(intent.expiresAtEpochMilliseconds === undefined
      ? {}
      : { expiresAtEpochMilliseconds: intent.expiresAtEpochMilliseconds }),
  });
}

function isExpired(intent: StoredEncodedGroupMutationIntent, now: number): boolean {
  return (
    intent.expiresAtEpochMilliseconds !== undefined && intent.expiresAtEpochMilliseconds <= now
  );
}

function freezeStoredIntent(
  input: StoredEncodedGroupMutationIntent,
): StoredEncodedGroupMutationIntent {
  return Object.freeze({
    ...input,
    payload: Object.freeze(input.payload),
  });
}

function freezeResolvedIntent(input: StoredGroupMutationIntent): StoredGroupMutationIntent {
  return Object.freeze(input);
}

function freezeState(state: GroupMutationIntentStoreState): GroupMutationIntentStoreState {
  return Object.freeze({
    intents: Object.freeze(state.intents.map((intent) => freezeStoredIntent(intent))),
  });
}

function groupMutationIntentFailure(
  category: ApplicationPortFailureCategory,
  code: string,
): ApplicationPortFailure {
  return createApplicationPortFailure({
    category,
    code,
    message: "Group mutation intent store operation failed.",
    retryable: false,
    ownerContext: "group",
  });
}
