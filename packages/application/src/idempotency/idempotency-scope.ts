import type { ApplicationCommandEnvelope } from "../commands/command-model.js";
import { getApplicationCommandDefinition } from "../commands/command-catalog.js";

export type IdempotencyScope = Readonly<{
  commandName: ApplicationCommandEnvelope["name"];
  commandRef: string;
  key: string;
  targetRef?: string;
}>;

const unsafeKeyPatterns = [
  /secret/iu,
  /token/iu,
  /password/iu,
  /session[_:-]/iu,
  /api[_-]?key/iu,
  /webhook[_-]?secret/iu,
  /\+\d{8,}/u,
] as const;

export function createIdempotencyScope(command: ApplicationCommandEnvelope): IdempotencyScope {
  const definition = getApplicationCommandDefinition(command.name);

  if (command.idempotencyKey === undefined) {
    if (definition.idempotencyRequired) {
      throw new TypeError("Idempotency key is required for this command.");
    }

    return Object.freeze({
      commandName: command.name,
      commandRef: command.commandRef,
      key: `${command.name}:${command.commandRef}`,
      ...(command.targetRef === undefined ? {} : { targetRef: command.targetRef }),
    });
  }

  assertSafeIdempotencyKey(command.idempotencyKey);

  return Object.freeze({
    commandName: command.name,
    commandRef: command.commandRef,
    key: command.idempotencyKey,
    ...(command.targetRef === undefined ? {} : { targetRef: command.targetRef }),
  });
}

export function assertSafeIdempotencyKey(value: string): void {
  if (value.trim().length === 0) {
    throw new TypeError("Idempotency key must not be empty.");
  }

  if (unsafeKeyPatterns.some((pattern) => pattern.test(value))) {
    throw new TypeError("Idempotency key must not contain Secret or raw Confidential data.");
  }
}
