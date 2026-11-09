import type { IncomingMessage, ServerResponse } from "node:http";
import type { ProbePaths } from "../config/service-config.js";
import { stripQuery } from "./request-path.js";

/** Answers the request if it is a probe and reports whether it did. */
export type ProbeHandler = (request: IncomingMessage, response: ServerResponse) => boolean;

export function createProbeHandler(paths: ProbePaths, isShuttingDown: () => boolean): ProbeHandler {
  return (request, response) => {
    if (request.method !== "GET" && request.method !== "HEAD") return false;

    const path = stripQuery(request.url ?? "");
    if (path === paths.readiness) {
      respond(response, isShuttingDown() ? 503 : 200);
      return true;
    }
    if (path === paths.liveness) {
      respond(response, 200);
      return true;
    }
    return false;
  };
}

function respond(response: ServerResponse, statusCode: number): void {
  response.statusCode = statusCode;
  response.setHeader("cache-control", "no-store");
  response.end();
}
