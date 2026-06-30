import type { LogEntry, StructuredLogger } from "@omniwa/observability";

export class MemoryLogger implements StructuredLogger {
  readonly #entries: LogEntry[] = [];

  write(entry: LogEntry): void {
    this.#entries.push(entry);
  }

  entries(): readonly LogEntry[] {
    return [...this.#entries];
  }

  clear(): void {
    this.#entries.length = 0;
  }
}
