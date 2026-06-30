import { createUuid, type Uuid, type UUIDGenerator } from "@omniwa/shared";

export class DeterministicUUIDGenerator implements UUIDGenerator {
  readonly #values: Uuid[];
  #index = 0;

  constructor(values: readonly string[]) {
    this.#values = values.map((value) => createUuid(value));
  }

  random(): Uuid {
    const value = this.#values[this.#index];

    if (value === undefined) {
      throw new Error("DeterministicUUIDGenerator exhausted.");
    }

    this.#index += 1;
    return value;
  }
}
