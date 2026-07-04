export type PublicCollectionQueryOptions = Readonly<{
  limit: number;
  filters: Readonly<Record<string, string>>;
  cursorOffset: number;
  cursorContext: string;
  cursor?: string;
  sort?: string;
  search?: string;
}>;

export type PublicPaginationMeta = Readonly<{
  nextCursor: string | null;
  previousCursor: string | null;
  hasMore: boolean;
  limit: number;
  sort?: string;
  search?: string;
  filters?: Readonly<Record<string, string>>;
}>;

export type PublicCollectionPage = Readonly<{
  items: readonly unknown[];
  nextCursor: string | null;
  previousCursor: string | null;
  hasMore: boolean;
}>;

export type PublicCollectionCursorEncoder = (offset: number, context: string) => string;

export function publicCollectionPage(
  data: unknown,
  resourceType: string,
  queryOptions: PublicCollectionQueryOptions,
  encodeCursor: PublicCollectionCursorEncoder,
): PublicCollectionPage {
  const filteredItems = applyCollectionFilters(
    publicCollectionItems(data, resourceType),
    queryOptions,
  );
  const startOffset = Math.min(queryOptions.cursorOffset, filteredItems.length);
  const endOffset = Math.min(startOffset + queryOptions.limit, filteredItems.length);
  const pageItems = Object.freeze(filteredItems.slice(startOffset, endOffset));
  const hasMore = endOffset < filteredItems.length;

  return Object.freeze({
    items: pageItems,
    nextCursor: hasMore ? encodeCursor(endOffset, queryOptions.cursorContext) : null,
    previousCursor:
      startOffset > 0
        ? encodeCursor(Math.max(0, startOffset - queryOptions.limit), queryOptions.cursorContext)
        : null,
    hasMore,
  });
}

export function publicResourceData(
  resourceType: string,
  item: unknown,
  fallbackResourceId?: string,
): Readonly<Record<string, unknown>> {
  const record = asRecord(item);
  const schema = publicResourceSchemas[resourceType] ?? defaultPublicResourceSchema;
  const output: Record<string, unknown> = {
    resourceType,
  };
  const id = firstSafeString(record, schema.idFields) ?? fallbackResourceId;

  if (id !== undefined) {
    output.id = id;
  }

  for (const field of schema.fields) {
    const value = publicFieldValue(record, field);

    if (value !== undefined) {
      output[field.publicName] = value;
    }
  }

  return Object.freeze(output);
}

export function paginationMetaFromOptions(
  options: PublicCollectionQueryOptions,
  page: PublicCollectionPage,
): PublicPaginationMeta {
  return Object.freeze({
    nextCursor: page.nextCursor,
    previousCursor: page.previousCursor,
    hasMore: page.hasMore,
    limit: options.limit,
    ...optional("sort", options.sort),
    ...optional("search", options.search),
    ...optional(
      "filters",
      Object.keys(options.filters).length === 0 ? undefined : Object.freeze({ ...options.filters }),
    ),
  });
}

function publicCollectionItems(data: unknown, resourceType: string): readonly unknown[] {
  if (Array.isArray(data)) {
    return Object.freeze(data.map((item) => publicResourceData(resourceType, item)));
  }

  const record = asRecord(data);
  const items = record.items;

  if (Array.isArray(items)) {
    return Object.freeze(items.map((item) => publicResourceData(resourceType, item)));
  }

  return Object.freeze([]);
}

function applyCollectionFilters(
  items: readonly unknown[],
  queryOptions: PublicCollectionQueryOptions,
): readonly Readonly<Record<string, unknown>>[] {
  const filtered = items
    .map(asRecord)
    .filter((item) => itemMatchesFilters(item, queryOptions.filters))
    .filter((item) => itemMatchesSearch(item, queryOptions.search));

  return Object.freeze(sortCollectionItems(filtered, queryOptions.sort));
}

function itemMatchesFilters(
  item: Readonly<Record<string, unknown>>,
  filters: Readonly<Record<string, string>>,
): boolean {
  return Object.entries(filters).every(
    ([key, value]) => publicComparableValue(item[key]) === value,
  );
}

function itemMatchesSearch(
  item: Readonly<Record<string, unknown>>,
  search: string | undefined,
): boolean {
  if (search === undefined) {
    return true;
  }

  const expected = search.toLocaleLowerCase("en-US");

  return Object.values(item).some((value) => {
    if (typeof value === "string") {
      return value.toLocaleLowerCase("en-US").includes(expected);
    }

    if (Array.isArray(value)) {
      return value.some(
        (entry) => typeof entry === "string" && entry.toLocaleLowerCase("en-US").includes(expected),
      );
    }

    return false;
  });
}

function sortCollectionItems(
  items: readonly Readonly<Record<string, unknown>>[],
  sort: string | undefined,
): readonly Readonly<Record<string, unknown>>[] {
  if (sort === undefined) {
    return [...items];
  }

  const descending = sort.startsWith("-");
  const field = descending ? sort.slice(1) : sort;

  return items
    .map((item, index) => Object.freeze({ item, index }))
    .sort((left, right) => {
      const comparison = comparePublicValues(left.item[field], right.item[field]);

      if (comparison !== 0) {
        return descending ? -comparison : comparison;
      }

      return left.index - right.index;
    })
    .map((entry) => entry.item);
}

function comparePublicValues(left: unknown, right: unknown): number {
  const leftValue = publicComparableValue(left);
  const rightValue = publicComparableValue(right);

  if (leftValue === undefined && rightValue === undefined) return 0;
  if (leftValue === undefined) return 1;
  if (rightValue === undefined) return -1;

  return leftValue.localeCompare(rightValue, "en-US", {
    numeric: true,
    sensitivity: "base",
  });
}

function publicComparableValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";

  return undefined;
}

type PublicResourceField = Readonly<{
  publicName: string;
  sourceNames: readonly string[];
  kind?: "string" | "number" | "boolean" | "string_array";
}>;

type PublicResourceSchema = Readonly<{
  idFields: readonly string[];
  fields: readonly PublicResourceField[];
}>;

const defaultPublicResourceSchema: PublicResourceSchema = Object.freeze({
  idFields: Object.freeze(["id", "resourceId"]),
  fields: Object.freeze([
    publicStringField("status"),
    publicStringField("createdAt"),
    publicStringField("updatedAt"),
  ]),
});

const publicResourceSchemas: Readonly<Record<string, PublicResourceSchema>> = Object.freeze({
  auditRecord: Object.freeze({
    idFields: Object.freeze(["id", "auditRecordId", "resourceId"]),
    fields: Object.freeze([
      publicStringField("category"),
      publicStringField("status"),
      publicStringField("action"),
      publicStringField("auditedResourceType", ["resourceType"]),
      publicStringField("resourceRef"),
      publicStringField("createdAt"),
    ]),
  }),
  chat: Object.freeze({
    idFields: Object.freeze(["id", "chatId", "resourceId"]),
    fields: Object.freeze([
      publicStringField("instanceId"),
      publicStringField("status"),
      publicStringField("displayName"),
      publicStringField("type"),
      publicNumberField("unreadCount"),
      publicStringArrayField("labelIds"),
      publicStringField("lastMessageAt"),
      publicStringField("updatedAt"),
    ]),
  }),
  contact: Object.freeze({
    idFields: Object.freeze(["id", "contactId", "resourceId"]),
    fields: Object.freeze([
      publicStringField("instanceId"),
      publicStringField("status"),
      publicStringField("displayName"),
      publicStringArrayField("labelIds"),
      publicStringField("updatedAt"),
    ]),
  }),
  dashboard: Object.freeze({
    idFields: Object.freeze(["id", "resourceId"]),
    fields: Object.freeze([
      publicNumberField("instanceCount"),
      publicNumberField("connectedInstanceCount"),
      publicNumberField("queuedJobCount"),
      publicNumberField("failedWebhookCount"),
      publicStringField("updatedAt"),
    ]),
  }),
  event: Object.freeze({
    idFields: Object.freeze(["id", "eventId", "resourceId"]),
    fields: Object.freeze([
      publicStringField("type"),
      publicStringField("source"),
      publicStringField("resourceRef"),
      publicStringField("correlationId"),
      publicStringField("timestamp"),
    ]),
  }),
  group: Object.freeze({
    idFields: Object.freeze(["id", "groupId", "resourceId"]),
    fields: Object.freeze([
      publicStringField("instanceId"),
      publicStringField("status"),
      publicStringField("subject"),
      publicStringField("description"),
      publicNumberField("memberCount"),
      publicNumberField("adminCount"),
      publicBooleanField("muted"),
      publicBooleanField("archived"),
      publicBooleanField("pinned"),
      publicStringField("updatedAt"),
    ]),
  }),
  groupMember: Object.freeze({
    idFields: Object.freeze(["id", "memberId", "resourceId"]),
    fields: Object.freeze([
      publicStringField("groupId"),
      publicStringField("memberRef"),
      publicStringField("role"),
      publicStringField("status"),
      publicStringField("displayName"),
      publicStringField("joinedAt"),
      publicStringField("updatedAt"),
    ]),
  }),
  health: Object.freeze({
    idFields: Object.freeze(["id", "healthId", "resourceId"]),
    fields: Object.freeze([
      publicStringField("status"),
      publicStringField("category"),
      publicStringField("subjectRef"),
      publicStringField("checkedAt"),
      publicStringField("updatedAt"),
    ]),
  }),
  instance: Object.freeze({
    idFields: Object.freeze(["id", "instanceId", "resourceId"]),
    fields: Object.freeze([
      publicStringField("status"),
      publicStringField("displayName"),
      publicStringField("createdAt"),
      publicStringField("updatedAt"),
    ]),
  }),
  job: Object.freeze({
    idFields: Object.freeze(["id", "jobId", "resourceId"]),
    fields: Object.freeze([
      publicStringField("status"),
      publicStringField("workType"),
      publicStringField("ownerContext", ["ownerContext", "owner"]),
      publicStringField("resourceRef", ["resourceRef", "targetRef"]),
      publicNumberField("attemptCount"),
      publicStringField("createdAt"),
      publicStringField("updatedAt"),
      publicStringField("nextRunAt"),
    ]),
  }),
  label: Object.freeze({
    idFields: Object.freeze(["id", "labelId", "resourceId"]),
    fields: Object.freeze([
      publicStringField("instanceId"),
      publicStringField("status"),
      publicStringField("name"),
      publicStringField("color"),
      publicStringField("updatedAt"),
    ]),
  }),
  media: Object.freeze({
    idFields: Object.freeze(["id", "mediaId", "resourceId"]),
    fields: Object.freeze([
      publicStringField("instanceId"),
      publicStringField("status"),
      publicStringField("mediaType"),
      publicStringField("contentType"),
      publicNumberField("sizeBytes"),
      publicStringField("createdAt"),
      publicStringField("expiresAt"),
    ]),
  }),
  message: Object.freeze({
    idFields: Object.freeze(["id", "messageId", "resourceId"]),
    fields: Object.freeze([
      publicStringField("instanceId"),
      publicStringField("chatId"),
      publicStringField("groupId"),
      publicStringField("status"),
      publicStringField("type"),
      publicStringField("direction"),
      publicStringField("createdAt"),
      publicStringField("updatedAt"),
      publicStringField("deliveredAt"),
      publicStringField("readAt"),
    ]),
  }),
  metrics: Object.freeze({
    idFields: Object.freeze(["id", "resourceId"]),
    fields: Object.freeze([
      publicNumberField("value"),
      publicNumberField("count"),
      publicNumberField("totalJobCount"),
      publicNumberField("queuedJobCount"),
      publicNumberField("reservedJobCount"),
      publicNumberField("runningJobCount"),
      publicNumberField("retryingJobCount"),
      publicNumberField("completedJobCount"),
      publicNumberField("deadJobCount"),
      publicNumberField("activeJobCount"),
      publicStringField("status"),
      publicStringField("updatedAt"),
    ]),
  }),
  provider: Object.freeze({
    idFields: Object.freeze(["id", "providerId", "resourceId"]),
    fields: Object.freeze([
      publicStringField("status"),
      publicStringField("providerName"),
      publicStringField("capability"),
      publicStringField("updatedAt"),
    ]),
  }),
  session: Object.freeze({
    idFields: Object.freeze(["id", "sessionId", "resourceId"]),
    fields: Object.freeze([
      publicStringField("instanceId"),
      publicStringField("status"),
      publicStringField("createdAt"),
      publicStringField("updatedAt"),
      publicStringField("expiresAt"),
    ]),
  }),
  settings: Object.freeze({
    idFields: Object.freeze(["id", "settingsId", "resourceId"]),
    fields: Object.freeze([
      publicStringField("status"),
      publicStringField("profile"),
      publicStringField("updatedAt"),
    ]),
  }),
  webhook: Object.freeze({
    idFields: Object.freeze(["id", "webhookId", "resourceId"]),
    fields: Object.freeze([
      publicStringField("status"),
      publicStringArrayField("eventTypes"),
      publicStringField("createdAt"),
      publicStringField("updatedAt"),
    ]),
  }),
  webhookDelivery: Object.freeze({
    idFields: Object.freeze(["id", "deliveryId", "resourceId"]),
    fields: Object.freeze([
      publicStringField("webhookId"),
      publicStringField("status"),
      publicStringField("eventType"),
      publicNumberField("attemptCount"),
      publicStringField("createdAt"),
      publicStringField("updatedAt"),
      publicStringField("nextRetryAt"),
    ]),
  }),
});

function publicStringField(
  publicName: string,
  sourceNames?: readonly string[],
): PublicResourceField {
  return Object.freeze({
    publicName,
    sourceNames: Object.freeze(sourceNames ?? [publicName]),
    kind: "string",
  });
}

function publicNumberField(
  publicName: string,
  sourceNames?: readonly string[],
): PublicResourceField {
  return Object.freeze({
    publicName,
    sourceNames: Object.freeze(sourceNames ?? [publicName]),
    kind: "number",
  });
}

function publicBooleanField(
  publicName: string,
  sourceNames?: readonly string[],
): PublicResourceField {
  return Object.freeze({
    publicName,
    sourceNames: Object.freeze(sourceNames ?? [publicName]),
    kind: "boolean",
  });
}

function publicStringArrayField(
  publicName: string,
  sourceNames?: readonly string[],
): PublicResourceField {
  return Object.freeze({
    publicName,
    sourceNames: Object.freeze(sourceNames ?? [publicName]),
    kind: "string_array",
  });
}

function publicFieldValue(
  record: Readonly<Record<string, unknown>>,
  field: PublicResourceField,
): unknown {
  for (const sourceName of field.sourceNames) {
    const value = record[sourceName];

    if (field.kind === "number" && typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    if (field.kind === "boolean" && typeof value === "boolean") {
      return value;
    }

    if (field.kind === "string_array" && Array.isArray(value)) {
      const items = value.filter((item): item is string => typeof item === "string");

      return items.length === value.length ? Object.freeze(items) : undefined;
    }

    if ((field.kind === undefined || field.kind === "string") && isSafePublicString(value)) {
      return value;
    }
  }

  return undefined;
}

function firstSafeString(
  record: Readonly<Record<string, unknown>>,
  fieldNames: readonly string[],
): string | undefined {
  for (const fieldName of fieldNames) {
    const value = record[fieldName];

    if (isSafePublicString(value)) {
      return value;
    }
  }

  return undefined;
}

function isSafePublicString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && !hasControlCharacter(value);
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && codePoint <= 0x1f;
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? { ...value } : {};
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optional<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Record<TKey, TValue>);
}
