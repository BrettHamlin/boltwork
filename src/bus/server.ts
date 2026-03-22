/**
 * Bus Server
 *
 * Standalone HTTP SSE server for event routing between sessions.
 * Run as a separate process: `bun run src/bus/server.ts`
 *
 * Endpoints:
 *   POST /publish       — publish an event to a channel
 *   GET  /subscribe     — SSE stream for a channel
 *   GET  /health        — health check
 *
 * Events are ephemeral — no persistence, no replay.
 * If nobody is listening when an event is published, it's dropped.
 */

interface Subscriber {
  channel: string;
  controller: ReadableStreamDefaultController;
}

const subscribers: Subscriber[] = [];

function removeSubscriber(sub: Subscriber): void {
  const idx = subscribers.indexOf(sub);
  if (idx !== -1) subscribers.splice(idx, 1);
}

function publishToChannel(
  channel: string,
  event: { type: string; payload: Record<string, unknown> },
): number {
  const data = JSON.stringify({
    channel,
    type: event.type,
    payload: event.payload,
    timestamp: Date.now(),
  });

  let delivered = 0;
  for (const sub of subscribers) {
    if (sub.channel === channel) {
      try {
        sub.controller.enqueue(`data: ${data}\n\n`);
        delivered++;
      } catch {
        removeSubscriber(sub);
      }
    }
  }
  return delivered;
}

const port = parseInt(process.env.BOLTWORK_BUS_PORT ?? "8080", 10);

Bun.serve({
  port,
  hostname: "127.0.0.1",

  async fetch(req) {
    const url = new URL(req.url);

    // Health check
    if (url.pathname === "/health") {
      return Response.json({
        ok: true,
        subscribers: subscribers.length,
        uptime: process.uptime(),
      });
    }

    // Publish
    if (req.method === "POST" && url.pathname === "/publish") {
      try {
        const body = (await req.json()) as {
          channel: string;
          type: string;
          payload?: Record<string, unknown>;
        };

        if (!body.channel || !body.type) {
          return Response.json(
            { error: "channel and type are required" },
            { status: 400 },
          );
        }

        const delivered = publishToChannel(body.channel, {
          type: body.type,
          payload: body.payload ?? {},
        });

        return Response.json({ ok: true, delivered });
      } catch {
        return Response.json({ error: "invalid JSON body" }, { status: 400 });
      }
    }

    // Subscribe (SSE)
    if (req.method === "GET" && url.pathname === "/subscribe") {
      const channel = url.searchParams.get("channel");
      if (!channel) {
        return Response.json(
          { error: "channel query parameter required" },
          { status: 400 },
        );
      }

      const stream = new ReadableStream({
        start(controller) {
          const sub: Subscriber = { channel, controller };
          subscribers.push(sub);

          // Send initial keepalive
          controller.enqueue(": connected\n\n");

          // Clean up on client disconnect
          req.signal.addEventListener("abort", () => {
            removeSubscriber(sub);
            try {
              controller.close();
            } catch {
              // already closed
            }
          });
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    return Response.json({ error: "not found" }, { status: 404 });
  },
});

console.log(`boltwork bus running on http://127.0.0.1:${port}`);
