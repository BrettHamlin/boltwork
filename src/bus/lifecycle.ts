/**
 * Bus Lifecycle
 *
 * Start and stop the bus server as a background process.
 * Includes health monitoring to restart the bus if it dies.
 */

import { resolve, dirname } from "path";

export interface BusHandle {
  /** The bus server URL */
  url: string;
  /** The port the bus is listening on */
  port: number;
  /** Stop the bus server and health monitor */
  stop(): void;
}

export interface StartBusOptions {
  /** Port to listen on. Default: 8080 */
  port?: number;
}

// Keep strong references so GC doesn't collect them
const activeBuses = new Map<number, { proc: ReturnType<typeof Bun.spawn>; monitor: Timer }>();

/**
 * Start the bus server as a background process.
 * Monitors health and restarts if it dies.
 * Waits for the health check to confirm it's ready.
 */
export async function startBus(options?: StartBusOptions): Promise<BusHandle> {
  const port = options?.port ?? 8080;
  const url = `http://127.0.0.1:${port}`;

  // Check if a bus is already running on this port
  try {
    const res = await fetch(`${url}/health`);
    if (res.ok) {
      return {
        url,
        port,
        stop() { /* external bus — don't kill it */ },
      };
    }
  } catch {
    // Not running — start it
  }

  const serverScript = resolve(dirname(import.meta.path), "server.ts");

  function spawnBus(): ReturnType<typeof Bun.spawn> {
    return Bun.spawn(["bun", "run", serverScript], {
      env: { ...process.env, BOLTWORK_BUS_PORT: String(port) },
      stdout: "ignore",
      stderr: "ignore",
    });
  }

  let proc = spawnBus();

  // Health monitor — restart bus if it dies
  const monitor = setInterval(async () => {
    try {
      const res = await fetch(`${url}/health`);
      if (!res.ok) throw new Error("unhealthy");
    } catch {
      // Bus is dead — restart it
      try { proc.kill(); } catch { /* already dead */ }
      proc = spawnBus();
      // Update the stored reference
      const entry = activeBuses.get(port);
      if (entry) entry.proc = proc;
    }
  }, 5_000);

  // Store strong references
  activeBuses.set(port, { proc, monitor });

  // Wait for the server to be ready
  const maxWait = 10_000;
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) {
        return {
          url,
          port,
          stop() {
            clearInterval(monitor);
            const entry = activeBuses.get(port);
            if (entry) {
              try { entry.proc.kill(); } catch { /* already dead */ }
              activeBuses.delete(port);
            }
          },
        };
      }
    } catch {
      // not ready yet
    }
    await Bun.sleep(200);
  }

  clearInterval(monitor);
  proc.kill();
  activeBuses.delete(port);
  throw new Error(`Bus server failed to start on port ${port} within ${maxWait}ms`);
}
