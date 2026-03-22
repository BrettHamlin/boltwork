/**
 * Bus Lifecycle
 *
 * Start and stop the bus server.
 * Uses a tmux pane for isolation — the bus survives regardless of
 * what happens to the parent process.
 */

import { resolve, dirname } from "path";

export interface BusHandle {
  /** The bus server URL */
  url: string;
  /** The port the bus is listening on */
  port: number;
  /** The tmux pane ID running the bus */
  paneId: string;
  /** Stop the bus server */
  stop(): void;
}

export interface StartBusOptions {
  /** Port to listen on. Default: 8080 */
  port?: number;
}

/**
 * Start the bus server in a tmux pane.
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

  // Check if a bus is already running on this port
  try {
    const res = await fetch(`${url}/health`);
    if (res.ok) {
      // Bus already running — return a handle that doesn't kill it on stop
      return {
        url,
        port,
        paneId: "",
        stop() { /* external bus — don't kill it */ },
      };
    }
  } catch {
    // Not running — start it
  }

  const serverScript = resolve(dirname(import.meta.path), "server.ts");

  // Start in a tmux pane so it's fully independent of this process
  const split = Bun.spawnSync([
    "tmux", "split-window", "-h", "-d", "-P", "-F", "#{pane_id}",
  ]);
  if (split.exitCode !== 0) {
    throw new Error(`Failed to create bus tmux pane: ${split.stderr.toString().trim()}`);
  }
  const paneId = split.stdout.toString().trim();

  // Rebalance tmux layout
  Bun.spawnSync(["tmux", "select-layout", "tiled"]);

  // Send the bus server command to the pane
  const cmd = `BOLTWORK_BUS_PORT=${port} bun run ${serverScript}`;
  Bun.spawnSync(["tmux", "send-keys", "-t", paneId, cmd, "Enter"]);

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
          paneId,
          stop() {
            Bun.spawnSync(["tmux", "kill-pane", "-t", paneId]);
          },
        };
      }
    } catch {
      // not ready yet
    }
    await Bun.sleep(200);
  }

  // Failed to start — clean up
  Bun.spawnSync(["tmux", "kill-pane", "-t", paneId]);
  throw new Error(`Bus server failed to start on port ${port} within ${maxWait}ms`);
}
