export type ProcessListener = (value: unknown) => void;

/** The subset of `process` the lifecycle uses, so tests can supply a stand-in. */
export interface HostProcess {
  on(event: string, listener: ProcessListener): unknown;
  removeListener(event: string, listener: ProcessListener): unknown;
  exit(code: number): void;
}

/** Tracks the handlers one listening attempt installs so exactly those can be removed. */
export class ProcessHandlers {
  readonly #host: HostProcess;
  readonly #installed: [event: string, listener: ProcessListener][] = [];

  constructor(host: HostProcess) {
    this.#host = host;
  }

  install(event: string, listener: ProcessListener): void {
    this.#host.on(event, listener);
    this.#installed.push([event, listener]);
  }

  removeAll(): void {
    for (const [event, listener] of this.#installed) this.#host.removeListener(event, listener);
    this.#installed.length = 0;
  }
}
