import { createServer, type Server } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { getRequestListener } from "@hono/node-server";

const HOST = "127.0.0.1";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function closeServer(server: Server, ms = 250): Promise<void> {
  return Promise.race([
    new Promise<void>((resolve) => {
      server.close(() => resolve());
      try {
        server.closeAllConnections?.();
      } catch {
        /* ignore */
      }
    }),
    sleep(ms),
  ]);
}

export async function listenHono(
  fetch: (request: Request) => Response | Promise<Response>,
  preferredPort: number,
  options: { allowFallback?: boolean } = {}
): Promise<{ server: Server; port: number }> {
  const allowFallback = options.allowFallback ?? true;
  const maxPorts = allowFallback ? 40 : 1;
  const listener = getRequestListener(fetch);
  let lastError: unknown;

  for (let offset = 0; offset < maxPorts; offset++) {
    const port = preferredPort + offset;
    for (let attempt = 0; attempt < 8; attempt++) {
      const server = createServer(listener as (req: IncomingMessage, res: ServerResponse) => void);
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            server.removeListener("error", onError);
            server.removeListener("listening", onListening);
            reject(
              Object.assign(new Error(`listen timed out on ${port}`), { code: "ETIMEDOUT" })
            );
          }, 1000);

          const onError = (err: Error) => {
            clearTimeout(timer);
            server.off("listening", onListening);
            reject(err);
          };
          const onListening = () => {
            clearTimeout(timer);
            server.off("error", onError);
            resolve();
          };

          server.once("error", onError);
          server.once("listening", onListening);
          server.listen(port, HOST);
        });
        if (port !== preferredPort) {
          console.log(`[opend] port ${preferredPort} busy, using ${port}`);
        }
        return { server, port };
      } catch (err) {
        lastError = err;
        await closeServer(server);
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "EADDRINUSE" || code === "EACCES" || code === "ETIMEDOUT") {
          await sleep(150);
          continue;
        }
        throw err;
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`No free port near ${preferredPort}`);
}
