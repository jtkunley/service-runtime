import { EventEmitter } from "node:events";
import type { HostProcess } from "../../src/lib/lifecycle/host-process.js";

/** Stands in for `process`: events are plain emitter events and `exit` only records the code. */
export class FakeHost extends EventEmitter implements HostProcess {
  readonly exitCodes: number[] = [];
  readonly #exit = Promise.withResolvers<number>();

  /** Resolves with the first exit code. */
  get exited(): Promise<number> {
    return this.#exit.promise;
  }

  exit(code: number): void {
    this.exitCodes.push(code);
    this.#exit.resolve(code);
  }
}
