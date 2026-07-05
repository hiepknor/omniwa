import type { ApplicationPortContext } from "@omniwa/application";
import type { StructuredLogLineSink } from "@omniwa/infrastructure-observability";

import type {
  WebhookDispatchAuditEntry,
  WebhookDispatchAuditSink,
} from "./webhook-dispatcher-app.js";

export type JsonLineWebhookDispatchAuditSinkOptions = Readonly<{
  sink: StructuredLogLineSink;
}>;

export class JsonLineWebhookDispatchAuditSink implements WebhookDispatchAuditSink {
  private readonly sink: StructuredLogLineSink;

  constructor(options: JsonLineWebhookDispatchAuditSinkOptions) {
    this.sink = options.sink;
  }

  recordWebhookDispatch(entry: WebhookDispatchAuditEntry, context: ApplicationPortContext): void {
    this.sink.writeLine(`${JSON.stringify(toPublicWebhookDispatchAuditRecord(entry, context))}\n`);
  }
}

export function toPublicWebhookDispatchAuditRecord(
  entry: WebhookDispatchAuditEntry,
  context: ApplicationPortContext,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    runtimeRole: "webhook",
    event: "webhook_dispatch",
    outcome: entry.outcome,
    correlationId: entry.correlationId,
    requestId: String(context.requestContext.requestId),
    actorRef: context.actorRef,
    ...optional("jobId", entry.jobId),
    ...optional("reservationRef", entry.reservationRef),
    ...optional("attempt", entry.attempt),
    ...optional("reasonCode", entry.reasonCode),
  });
}

function optional<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Record<TKey, TValue>);
}
