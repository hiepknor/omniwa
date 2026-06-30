import type {
  ApplicationCommandEnvelope,
  ApplicationCommandOutcome,
} from "../commands/command-model.js";
import type { ApplicationNotification } from "../ports/event-bus.js";
import type { ApplicationQueryEnvelope, ApplicationQueryOutcome } from "../queries/query-model.js";
import type { ApplicationCommandName } from "../commands/command-catalog.js";

export const applicationMessageKinds = [
  "command",
  "query",
  "command_outcome",
  "query_outcome",
  "notification",
  "internal_message",
] as const;

export type ApplicationMessageKind = (typeof applicationMessageKinds)[number];

export type ApplicationInternalMessage = Readonly<{
  kind: "internal_message";
  name: string;
  sourceRef: string;
  mapsToCommand: ApplicationCommandName;
}>;

export type ApplicationMessage =
  | ApplicationCommandEnvelope
  | ApplicationQueryEnvelope
  | ApplicationCommandOutcome
  | ApplicationQueryOutcome
  | (ApplicationNotification & Readonly<{ kind: "notification" }>)
  | ApplicationInternalMessage;

export function isApplicationMessageKind(value: string): value is ApplicationMessageKind {
  return applicationMessageKinds.includes(value as ApplicationMessageKind);
}
