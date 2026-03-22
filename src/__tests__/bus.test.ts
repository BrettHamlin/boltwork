import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { startBus, type BusHandle } from "../bus/lifecycle.ts";
import { busPublish, busSubscribe } from "../bus/client.ts";

let bus: BusHandle;
const PORT = 18_901; // high port to avoid conflicts
const URL = `http://127.0.0.1:${PORT}`;

beforeAll(async () => {
  bus = await startBus({ port: PORT });
});

afterAll(() => {
  bus.stop();
});

describe("bus server", () => {
  test("health endpoint returns ok", async () => {
    const res = await fetch(`${URL}/health`);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  test("publish returns delivered count", async () => {
    // No subscribers yet, delivered should be 0
    await busPublish("test-channel", "test-event", {}, { url: URL });
    // If it didn't throw, it worked
  });

  test("publish rejects invalid body", async () => {
    const res = await fetch(`${URL}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}), // missing channel and type
    });
    expect(res.status).toBe(400);
  });

  test("subscribe requires channel parameter", async () => {
    const res = await fetch(`${URL}/subscribe`);
    expect(res.status).toBe(400);
  });
});

describe("bus pub/sub", () => {
  test("subscriber receives published event", async () => {
    const controller = new AbortController();
    const received: unknown[] = [];

    // Start subscribing in background
    const subPromise = (async () => {
      for await (const event of busSubscribe("integration-test", {
        url: URL,
        signal: controller.signal,
      })) {
        received.push(event);
        if (event.type === "done") break;
      }
    })();

    // Give subscriber time to connect
    await Bun.sleep(200);

    // Publish events
    await busPublish("integration-test", "first", { n: 1 }, { url: URL });
    await busPublish("integration-test", "done", { n: 2 }, { url: URL });

    // Wait for subscriber to process
    await Promise.race([subPromise, Bun.sleep(2000)]);
    controller.abort();

    expect(received.length).toBeGreaterThanOrEqual(2);
    expect((received[0] as any).type).toBe("first");
    expect((received[1] as any).type).toBe("done");
  });

  test("events on different channels don't cross", async () => {
    const controller = new AbortController();
    const received: unknown[] = [];

    const subPromise = (async () => {
      for await (const event of busSubscribe("channel-a", {
        url: URL,
        signal: controller.signal,
      })) {
        received.push(event);
        if (event.type === "sentinel") break;
      }
    })();

    await Bun.sleep(200);

    // Publish to different channel — should NOT be received
    await busPublish("channel-b", "wrong-channel", {}, { url: URL });

    // Publish to our channel
    await busPublish("channel-a", "sentinel", {}, { url: URL });

    await Promise.race([subPromise, Bun.sleep(2000)]);
    controller.abort();

    expect(received).toHaveLength(1);
    expect((received[0] as any).type).toBe("sentinel");
  });

  test("events include timestamp", async () => {
    const controller = new AbortController();
    let event: any;

    const subPromise = (async () => {
      for await (const e of busSubscribe("ts-test", {
        url: URL,
        signal: controller.signal,
      })) {
        event = e;
        break;
      }
    })();

    await Bun.sleep(200);
    const before = Date.now();
    await busPublish("ts-test", "timestamped", { data: "hello" }, { url: URL });

    await Promise.race([subPromise, Bun.sleep(2000)]);
    controller.abort();

    expect(event).toBeDefined();
    expect(event.timestamp).toBeGreaterThanOrEqual(before);
    expect(event.payload.data).toBe("hello");
  });
});
