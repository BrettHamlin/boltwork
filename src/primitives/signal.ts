/**
 * Primitive: Signal
 *
 * Publish events to and wait for events from the boltwork bus.
 * This is the user-facing API. It uses bus/client.ts internally.
 * Includes auto-reconnect for dropped SSE connections.
 */

import { busPublish, busSubscribe } from "../bus/client.ts";
import { SignalTimeout, SignalError } from "../errors.ts";

export interface SignalOptions {
  /** Bus server URL. Default: http://localhost:8080 */
  busUrl?: string;
  /** Timeout in ms for waitForSignal. Default: 300_000 (5 min) */
  timeout?: number;
}

/**
 * Publish a signal to a channel.
 *
 * ```ts
 * await publish("ticket-123", "HOOK_Stop", { source: "drone:auth" });
 * ```
 */
export async function publish(
  channel: string,
  type: string,
  payload: Record<string, unknown> = {},
  options?: SignalOptions,
): Promise<void> {
  try {
    await busPublish(channel, type, payload, { url: options?.busUrl ?? "http://localhost:8080" });
  } catch (err) {
    throw new SignalError(
      `Failed to publish "${type}" to "${channel}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Wait for a specific signal on a channel. Resolves when it arrives.
 * Rejects with SignalTimeout if the timeout expires.
 * Auto-reconnects if the SSE connection drops.
 *
 * ```ts
 * const event = await waitForSignal("ticket-123", "HOOK_Stop");
 * console.log(event.payload); // { source: "drone:auth" }
 * ```
 */
export async function waitForSignal<T extends Record<string, unknown> = Record<string, unknown>>(
  channel: string,
  type: string,
  options?: SignalOptions,
): Promise<{ channel: string; type: string; payload: T; timestamp: number }> {
  const timeout = options?.timeout ?? 300_000;
  const busUrl = options?.busUrl ?? "http://localhost:8080";
  const controller = new AbortController();
  const deadline = Date.now() + timeout;

  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    // Retry loop — reconnects on connection drop
    while (Date.now() < deadline) {
      try {
        for await (const event of busSubscribe(channel, { url: busUrl, signal: controller.signal })) {
          if (event.type === type) {
            return event as { channel: string; type: string; payload: T; timestamp: number };
          }
        }
        // Stream ended cleanly (server closed) — reconnect if still within timeout
      } catch (err) {
        if (controller.signal.aborted) {
          // Timeout triggered — stop retrying
          throw new SignalTimeout(channel, type, timeout);
        }
        // Connection error — wait briefly and reconnect
        if (Date.now() + 1000 < deadline) {
          await Bun.sleep(1000);
          continue;
        }
        throw err;
      }

      // Stream ended without error but no matching event — reconnect
      if (Date.now() + 1000 < deadline) {
        await Bun.sleep(1000);
      }
    }

    throw new SignalTimeout(channel, type, timeout);
  } catch (err) {
    if (err instanceof SignalTimeout || err instanceof SignalError) {
      throw err;
    }
    if (err instanceof Error && err.name === "AbortError") {
      throw new SignalTimeout(channel, type, timeout);
    }
    throw new SignalError(
      `Failed waiting for "${type}" on "${channel}": ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
