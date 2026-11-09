import { DEFAULT_LIVENESS_PATH, DEFAULT_READINESS_PATH } from "./defaults.js";
import type { ProbePaths } from "./service-config.js";
import { requireRecord } from "./validators.js";

export function validateProbes(probes: unknown): ProbePaths {
  const options = probes === undefined ? {} : requireRecord("probes", probes);
  const readiness = probePath("readiness", options.readiness, DEFAULT_READINESS_PATH);
  const liveness = probePath("liveness", options.liveness, DEFAULT_LIVENESS_PATH);

  if (readiness !== undefined && readiness === liveness) {
    throw new TypeError(`Readiness and liveness probes cannot share the path ${readiness}`);
  }
  return Object.freeze({ readiness, liveness });
}

function probePath(name: string, path: unknown, defaultPath: string): string | undefined {
  if (path === undefined) return defaultPath;
  if (path === false) return undefined;
  if (typeof path !== "string" || !path.startsWith("/") || /[?#]/.test(path)) {
    throw new TypeError(
      `probes.${name} must be false or an absolute path without a query string or fragment`,
    );
  }
  return path;
}
