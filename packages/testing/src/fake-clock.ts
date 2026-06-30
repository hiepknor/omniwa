import { toIsoTimestamp, type Clock, type IsoTimestamp } from "@omniwa/shared";

export class FakeClock implements Clock {
  #current: Date;

  constructor(initial: Date | string) {
    this.#current = new Date(initial);
  }

  now(): Date {
    return new Date(this.#current);
  }

  epochMilliseconds(): number {
    return this.#current.getTime();
  }

  isoNow(): IsoTimestamp {
    return toIsoTimestamp(this.#current);
  }

  setNow(next: Date | string): void {
    this.#current = new Date(next);
  }

  advanceMilliseconds(milliseconds: number): void {
    this.#current = new Date(this.#current.getTime() + milliseconds);
  }
}
