import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type DurableJsonStateEnvelope<TState> = Readonly<{
  version: 1;
  state: TState;
}>;

export class DurableJsonStateStore<TState> {
  private readonly filePath: string;
  private readonly emptyStateFactory: () => TState;

  constructor(filePath: string, emptyStateFactory: () => TState) {
    this.filePath = filePath;
    this.emptyStateFactory = emptyStateFactory;
    mkdirSync(dirname(filePath), { recursive: true });
  }

  exists(): boolean {
    return existsSync(this.filePath);
  }

  read(): TState {
    if (!this.exists()) {
      return this.emptyStateFactory();
    }

    const envelope = JSON.parse(
      readFileSync(this.filePath, "utf8"),
    ) as DurableJsonStateEnvelope<TState>;

    if (envelope.version !== 1) {
      throw new TypeError("Unsupported durable JSON state version.");
    }

    return envelope.state;
  }

  write(state: TState): void {
    const temporaryPath = `${this.filePath}.tmp`;
    const envelope: DurableJsonStateEnvelope<TState> = {
      version: 1,
      state,
    };

    writeFileSync(temporaryPath, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
    renameSync(temporaryPath, this.filePath);
  }
}
