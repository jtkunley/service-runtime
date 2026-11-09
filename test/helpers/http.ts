import {
  request as httpRequest,
  type Agent,
  type IncomingHttpHeaders,
  type OutgoingHttpHeaders,
} from "node:http";
import type { AddressInfo } from "node:net";

export interface HttpResult {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
}

export interface RequestOptions {
  readonly method?: string;
  readonly path?: string;
  readonly headers?: OutgoingHttpHeaders;
  readonly body?: string;
  /** Defaults to a fresh, non-pooled connection per request. */
  readonly agent?: Agent;
}

export function request(address: AddressInfo, options: RequestOptions = {}): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: address.family === "IPv6" ? "::1" : "127.0.0.1",
        port: address.port,
        method: options.method ?? "GET",
        path: options.path ?? "/",
        headers: options.headers,
        agent: options.agent ?? false,
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => (body += chunk));
        res.on("end", () => {
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body });
        });
      },
    );
    req.on("error", reject);
    req.end(options.body);
  });
}
