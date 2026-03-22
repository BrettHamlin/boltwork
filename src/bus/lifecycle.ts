/**
 * Bus Lifecycle
 *
 * Start and stop the bus server as a background process.
 * Used by pipelines that need the bus running before spawning sessions.
 */

import { resolve, dirname } from "path";

export interface BusHandle {
  /** The bus server URL */
  url: string;
  /** The port the bus is listening on */
  port: number;
  /** The subprocess PID */
  pid: number;
  /** Stop the bus server */
  stop(): void;
}

export interface StartBusOptions {
  /** Port to listen on. Default: 8080 */
  port?: number;
}

/**
 * Start the bus server as a background subprocess.
 * Waits for the health check to confirm it's ready.
 *
 * ```ts
 * const bus = await startBus({ port: 8080 });
 * // ... run your pipeline ...
 * bus.stop();
 * ```
 */
export async function startBus(options?: StartBusOptions): Promise<BusHandle> {
  const port = options?.port ?? 8080;
  const url = `http://127.0.0.1:${port}`;

  // Resolve the server script path relative to this file
  const serverScript = resolve(dirname(import.meta.path), "server.ts");

  // Spawn as detached process so it survives if the parent exits early.
  // Use Bun.$ to get a shell that can background the process.
  const proc = Bun.spawn(["bun", "run", serverScript], {
    env: { ...process.env, BOLTWORK_BUS_PORT: String(port) },
    stdout: "ignore",
    stderr: "pipe",
    ipc: undefined,
  });

  // Unref so the parent process can exit without waiting for the bus
  proc.unref();

  // Wait for the server to be ready (poll health endpoint)
  const maxWait = 5_000;
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) {
        return {
          url,
          port,
          pid: proc.pid,
          stop() {
            proc.kill();
          },
        };
      }
    } catch {
      // not ready yet
    }
    await Bun.sleep(100);
  }

  proc.kill();
  throw new Error(`Bus server failed to start on port ${port} within ${maxWait}ms`);
}
