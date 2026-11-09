/** Shared through the global symbol registry so duplicate copies of this package agree. */
const RESERVATION = Symbol.for("service-runtime.listen-reservation");

type ReservationScope = typeof globalThis & { [RESERVATION]?: boolean };

const scope = globalThis as ReservationScope;

export function reserveListen(): void {
  if (scope[RESERVATION]) throw new Error("Only one service can listen per process");
  scope[RESERVATION] = true;
}

export function releaseListen(): void {
  scope[RESERVATION] = false;
}
