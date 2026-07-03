import type {
  ApplicationCommandEnvelope,
  ApplicationCommandOutcome,
} from "../../commands/command-model.js";
import type { ApplicationCommandName } from "../../commands/command-catalog.js";
import type { ApplicationQueryName } from "../../queries/query-catalog.js";
import type {
  ApplicationQueryEnvelope,
  ApplicationQueryOutcome,
} from "../../queries/query-model.js";

export type CommandHandler = (
  envelope: ApplicationCommandEnvelope,
) => Promise<ApplicationCommandOutcome>;

export type QueryHandler = (envelope: ApplicationQueryEnvelope) => Promise<ApplicationQueryOutcome>;

export type CommandHandlerRegistry = ReadonlyMap<ApplicationCommandName, CommandHandler>;

export type QueryHandlerRegistry = ReadonlyMap<ApplicationQueryName, QueryHandler>;
