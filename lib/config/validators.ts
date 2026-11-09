type AnyFunction = (...args: never[]) => unknown;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function requireRecord(name: string, value: unknown): Record<string, unknown> {
  if (!isRecord(value) || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
  return value;
}

export function requireIntegerInRange(
  name: string,
  value: unknown,
  min: number,
  max: number,
): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer from ${min} through ${max}`);
  }
  return value;
}

export function optionalString(name: string, value: unknown): string | undefined {
  if (value !== undefined && typeof value !== "string") {
    throw new TypeError(`${name} must be a string`);
  }
  return value;
}

export function optionalFunction(name: string, value: unknown): AnyFunction | undefined {
  if (value !== undefined && typeof value !== "function") {
    throw new TypeError(`${name} must be a function`);
  }
  return value as AnyFunction | undefined;
}

export function requireFunctionList(name: string, value: unknown): readonly AnyFunction[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "function")) {
    throw new TypeError(`${name} must be an array of functions`);
  }
  return Object.freeze([...(value as AnyFunction[])]);
}
