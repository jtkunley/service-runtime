import { createServer, type RequestListener, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { HEADERS_TIMEOUT_MARGIN_MS, IDLE_CONNECTION_SWEEP_MS } from "../config/defaults.js";

export function createHttpServer(listener: RequestListener, keepAliveTimeoutMs: number): Server {
  const server = createServer(listener);
  server.keepAliveTimeout = keepAliveTimeoutMs;
  server.headersTimeout = keepAliveTimeoutMs + HEADERS_TIMEOUT_MARGIN_MS;
  server.requestTimeout = Math.max(server.requestTimeout, server.headersTimeout);
  return server;
}

/** Binds the server, resolving with the bound address or rejecting with the binding error. */
export function listenOn(
  server: Server,
  port: number,
  host: string | undefined,
): Promise<AddressInfo> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve(server.address() as AddressInfo);
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

/**
 * Stops accepting connections and resolves once every connection has ended.
 * Idle keep-alive connections, including ones that become idle while draining, are closed promptly.
 */
export function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    const idleSweep = setInterval(() => {
      server.closeIdleConnections();
    }, IDLE_CONNECTION_SWEEP_MS);
    idleSweep.unref();

    server.close((error) => {
      clearInterval(idleSweep);
      if (error) reject(error);
      else resolve();
    });
    server.closeIdleConnections();
  });
}
