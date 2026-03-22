# boltwork

Composable primitives for AI agent pipelines. Built around [Claude Code](https://docs.anthropic.com/en/docs/claude-code).

Think of it like CI/CD primitives, but for AI agents. You pick the building blocks you need, compose them with regular TypeScript, and run your pipeline with `bun`.

## Install

```bash
bun add boltwork
```

Or install from a local clone:

```bash
git clone https://github.com/yourorg/boltwork.git
bun add ./path/to/boltwork
```

**Requirements:**
- [Bun](https://bun.sh) runtime
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI (`claude` command) — needed for `llmCall` and `spawnSession`
- [tmux](https://github.com/tmux/tmux) — needed for `spawnSession`
- Git — needed for worktree isolation

Not every primitive needs all requirements. `gate` works with just Bun. `llmCall` adds the Claude Code CLI. `spawnSession` and `feedbackLoop` add tmux and git.

## Quick Start

```typescript
import { llmCall, gate } from "boltwork";

// Read a file, ask Claude Code to review it, gate on the result
const code = await Bun.file("src/auth.ts").text();
const review = await llmCall(`Review this code for bugs:\n\n${code}`);
gate(review.includes("PASS"), "Code review must pass");

console.log("Review passed!");
```

Run it:

```bash
bun run my-pipeline.ts
```

That's it. No framework. No config files. No runner. Just TypeScript.

## Primitives

### llmCall — One-Shot LLM Call

Send a prompt to `claude -p`, get a response. No conversation, no tools. One prompt in, one string out.

```typescript
import { llmCall } from "boltwork";

// Basic call
const response = await llmCall("What is 2 + 2?");

// With options
const review = await llmCall(buildReviewPrompt(diff), {
  model: "opus",
  maxTokens: 4096,
  timeout: 180_000,
});

// Parse structured responses
const tasks = JSON.parse(await llmCall("Return JSON: list the affected modules"));
```

### gate — Force-Override

Deterministic boolean check. If it fails, the pipeline stops. No LLM can override it.

```typescript
import { gate, gateAsync } from "boltwork";

// Synchronous gate
gate(tests.passed, "Tests must pass");
gate(boundary.clean, "No boundary violations allowed");

// Async gate
await gateAsync(async () => {
  const proc = Bun.spawn(["bun", "test"]);
  return (await proc.exited) === 0;
}, "Tests must pass");
```

### spawnSession — Spawn Claude Code Session

Start an isolated Claude Code session in a tmux pane. Optionally in a git worktree for branch isolation.

```typescript
import { spawnSession } from "boltwork";

const drone = await spawnSession({
  brief: "Implement the login page. Run tests when done.",
  worktree: true,                  // isolated git branch
  branch: "feat/login",
  signalChannel: "ticket-123",     // wires Stop hook to bus
  model: "sonnet",
  files: {                         // write files before launch
    "INSTRUCTIONS.md": briefContent,
  },
});

// Check if alive
if (await drone.alive()) { /* still running */ }

// Send feedback to the SAME session (preserves context)
await drone.sendFeedback("Tests failed. Fix the auth handler.");

// Clean up when done
await drone.kill();
await drone.cleanupWorktree();
```

When you pass `signalChannel`, boltwork automatically wires a Claude Code Stop hook that publishes `HOOK_Stop` to the bus when the session finishes. No manual hook setup needed.

### publish / waitForSignal — Signal Bus

Pub/sub between sessions via the boltwork event bus. Event-driven, not polling.

```typescript
import { publish, waitForSignal } from "boltwork";

// Publish a signal
await publish("ticket-123", "HOOK_Stop", { source: "drone:auth" });

// Wait for a signal (blocks until it arrives or times out)
const event = await waitForSignal("ticket-123", "HOOK_Stop");
console.log(event.payload.source); // "drone:auth"

// With custom timeout
const event = await waitForSignal("ticket-123", "HOOK_Stop", {
  timeout: 60_000,  // 1 minute
});
```

### feedbackLoop — Check, Feedback, Retry

Run checks on an agent's work. If they fail, send feedback to the same session and retry.

```typescript
import { feedbackLoop, waitForSignal } from "boltwork";

const result = await feedbackLoop({
  name: "code-review",
  maxIterations: 3,
  session: drone,

  async check(iteration) {
    // Wait for the drone to signal it's done
    await waitForSignal("ticket-123", "HOOK_Stop");

    // Run tests
    const tests = Bun.spawnSync(["bun", "test"], { cwd: drone.cwd });
    return {
      passed: tests.exitCode === 0,
      output: tests.stderr.toString(),
    };
  },

  passed(result) {
    return result.passed;
  },

  feedback(result) {
    return `Tests failed:\n${result.output}\n\nFix the failing tests.`;
  },
});
```

The session stays alive between iterations — no context is lost.

## Event Bus

The bus is an HTTP SSE server that routes events between sessions. Start it before spawning sessions that use signals.

### Start the bus programmatically

```typescript
import { startBus } from "boltwork";

const bus = await startBus({ port: 8080 });

// ... run your pipeline ...

bus.stop();
```

### Start the bus manually

```bash
bun run node_modules/boltwork/src/bus/server.ts
# or set a custom port:
BOLTWORK_BUS_PORT=9090 bun run node_modules/boltwork/src/bus/server.ts
```

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | /publish | Publish an event `{ channel, type, payload }` |
| GET | /subscribe?channel=X | SSE stream of events for a channel |
| GET | /health | Health check with subscriber count |

### Direct bus access

For advanced use cases, you can use the bus client directly:

```typescript
import { busPublish, busSubscribe } from "boltwork";

// Publish
await busPublish("my-channel", "my-event", { data: "hello" }, { url: "http://localhost:8080" });

// Subscribe (async iterator)
for await (const event of busSubscribe("my-channel")) {
  console.log(event.type, event.payload);
  if (event.type === "done") break;
}
```

## Errors

All primitives throw from a centralized set of error types:

| Error | Thrown by | Meaning |
|-------|----------|---------|
| `GateRejection` | `gate`, `gateAsync` | A boolean check failed |
| `LLMCallError` | `llmCall` | `claude -p` returned non-zero |
| `SessionSpawnError` | `spawnSession` | tmux pane or worktree creation failed |
| `SignalTimeout` | `waitForSignal` | Timed out waiting for an event |
| `SignalError` | `publish`, `waitForSignal` | Bus communication failed |
| `MaxIterationsExceeded` | `feedbackLoop` | Loop exhausted all iterations |

```typescript
import { GateRejection, MaxIterationsExceeded } from "boltwork";

try {
  await feedbackLoop({ ... });
} catch (err) {
  if (err instanceof GateRejection) {
    console.log("Hard failure:", err.reason);
  } else if (err instanceof MaxIterationsExceeded) {
    console.log("Gave up after", err.maxIterations, "attempts");
  }
}
```

## Full Example: Supervised Agent Pipeline

```typescript
import {
  startBus,
  llmCall,
  spawnSession,
  feedbackLoop,
  waitForSignal,
} from "boltwork";

async function implement(taskDescription: string) {
  const bus = await startBus();

  try {
    // Spawn a coding agent
    const drone = await spawnSession({
      brief: taskDescription,
      worktree: true,
      signalChannel: "my-pipeline",
    });

    // Feedback loop: check work, send corrections, retry
    await feedbackLoop({
      name: "implementation-review",
      maxIterations: 3,
      session: drone,

      async check() {
        await waitForSignal("my-pipeline", "HOOK_Stop");

        const tests = Bun.spawnSync(["bun", "test"], { cwd: drone.cwd });
        const diff = Bun.spawnSync(["git", "diff", "HEAD~1"], { cwd: drone.cwd });
        const review = await llmCall(
          `Review this diff for correctness:\n${diff.stdout.toString()}`
        );

        return {
          testsPass: tests.exitCode === 0,
          reviewApproved: review.includes("APPROVED"),
          testOutput: tests.stderr.toString(),
          reviewText: review,
        };
      },

      passed(result) {
        if (!result.testsPass) return false;
        return result.reviewApproved;
      },

      feedback(result) {
        const parts: string[] = [];
        if (!result.testsPass) parts.push(`Tests failed:\n${result.testOutput}`);
        if (!result.reviewApproved) parts.push(`Review:\n${result.reviewText}`);
        return parts.join("\n\n");
      },
    });

    // Passed — merge and clean up
    Bun.spawnSync(["git", "merge", drone.branch!], { cwd: process.cwd() });
    await drone.cleanupWorktree();

  } finally {
    bus.stop();
  }
}

await implement("Add rate limiting to the /api/users endpoint");
```

## Design Philosophy

**If it CAN be code, it SHOULD be code.** LLMs are good at judgment, bad at mechanical work. boltwork makes the mechanical parts deterministic and testable. The LLM only gets called when you need judgment.

**No framework, no DSL.** Pipelines are regular TypeScript async functions. You compose primitives with normal language features — function calls, loops, if/else, try/catch. Nothing to learn except the primitives themselves.

**Each primitive does one thing.** `llmCall` sends a prompt. `gate` checks a boolean. `spawnSession` opens a tmux pane. They don't know about each other. You compose them.

## License

Apache 2.0
