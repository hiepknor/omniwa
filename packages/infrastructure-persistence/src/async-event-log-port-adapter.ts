import type {
  ApplicationPortResult,
  AsyncEventLogPort,
  EventLogPort,
  EventLogReplayRequest,
  EventLogReplayResult,
  EventOutboxPublishResult,
  EventOutboxQuery,
  EventOutboxRecord,
  PlatformEventAppendInput,
  PlatformEventRecord,
} from "@omniwa/application";

export function createAsyncEventLogPortFromSync(eventLog: EventLogPort): AsyncEventLogPort {
  return Object.freeze({
    async appendEvent(
      input: PlatformEventAppendInput,
    ): Promise<ApplicationPortResult<PlatformEventRecord>> {
      return eventLog.appendEvent(input);
    },

    async replayEvents(
      request: EventLogReplayRequest,
    ): Promise<ApplicationPortResult<EventLogReplayResult>> {
      return eventLog.replayEvents(request);
    },

    async listOutbox(
      query?: EventOutboxQuery,
    ): Promise<ApplicationPortResult<readonly EventOutboxRecord[]>> {
      return eventLog.listOutbox(query);
    },

    async markOutboxPublished(
      eventId: string,
      publishedAt: string,
    ): Promise<ApplicationPortResult<EventOutboxPublishResult>> {
      return eventLog.markOutboxPublished(eventId, publishedAt);
    },
  });
}
