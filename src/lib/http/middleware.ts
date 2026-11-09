import type { IncomingMessage, ServerResponse } from "node:http";
import { missingContextMessage } from "../context/resolve-context.js";
import type { RequestContext } from "../context/request-context.js";
import type { ContextSource } from "../context/types.js";
import type { ChildLogger } from "../logging/logger.js";
import { tryLogError } from "../logging/safe-log.js";
import { stripQuery } from "./request-path.js";

export type NextFunction = (error?: unknown) => void;

/** Request shape accepted by the middleware; Express adds `originalUrl` for mounted routers. */
export type MiddlewareRequest = IncomingMessage & { originalUrl?: string };

export type Middleware = (
  request: MiddlewareRequest,
  response: ServerResponse,
  next: NextFunction,
) => void;

export function createContextMiddleware(
  requestContext: Pick<RequestContext, "resolve" | "enter">,
  log: ChildLogger,
): Middleware {
  return (request, response, next) => {
    const source = toContextSource(request);

    let resolution;
    try {
      resolution = requestContext.resolve(source);
    } catch (error) {
      next(error);
      return;
    }

    if (resolution.missing.length > 0) {
      rejectMissingContext(response, log, source, resolution.missing);
      return;
    }

    requestContext.enter(resolution.store, () => {
      next();
    });
  };
}

function toContextSource(request: MiddlewareRequest): ContextSource {
  return {
    headers: request.headers,
    method: request.method,
    path: stripQuery(request.originalUrl ?? request.url ?? "/"),
  };
}

function rejectMissingContext(
  response: ServerResponse,
  log: ChildLogger,
  source: ContextSource,
  missing: readonly string[],
): void {
  const message = missingContextMessage(missing);
  tryLogError(log, message, new Error(message), {
    method: source.method,
    path: source.path,
    missing: [...missing],
  });

  response.statusCode = 400;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify({ error: message }));
}
