/**
 * Bus Client
 *
 * HTTP client for the boltwork event bus.
 * Publishes events and subscribes to SSE streams.
 * Used internally by the signal primitive — not typically used directly.
 */

export interface BusClientOptions {
  /** Bus server URL. Default: http://localhost:8080 */
  url: string;
}

export interface BusEvent {
  channel: string;
  type: string;
  payload: Record<string, unknown>;
  timestamp: number;
}

const DEFAULT_URL = "http://localhost:8080";

/**
 * Publish an event to a channel.
 */
export async function busPublish(
  channel: string,
  type: string,
  payload: Record<string, unknown> = {},
  options?: Partial<BusClientOptions>,
): Promise<void> {
  const url = options?.url ?? DEFAULT_URL;

  const response = await fetch(`${url}/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ channel, type, payload }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Bus publish failed: ${response.status} ${body}`);
  }
}

/**
 * Subscribe to a channel. Returns an async iterator of events.
 * The connection stays open (SSE) until you break out of the loop
 * or call abort on the controller.
 *
 * ```ts
 * const controller = new AbortController();
 * for await (const event of busSubscribe("my-channel", { signal: controller.signal })) {
 *   if (event.type === "done") break;
 * }
 * ```
 */
export async function* busSubscribe(
  channel: string,
  options?: Partial<BusClientOptions> & { signal?: AbortSignal },
): AsyncGenerator<BusEvent> {
  const url = options?.url ?? DEFAULT_URL;

  const response = await fetch(
    `${url}/subscribe?channel=${encodeURIComponent(channel)}`,
    { signal: options?.signal },
  );

  if (!response.ok || !response.body) {
    throw new Error(`Bus subscribe failed: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          yield JSON.parse(line.slice(6)) as BusEvent;
        } catch {
          // skip malformed SSE lines
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
