# boltwork

Composable primitives for AI agent pipelines. Built around [Claude Code](https://docs.anthropic.com/en/docs/claude-code).

**Spawn autonomous Claude Code sessions, coordinate them with an event bus, review their work, send feedback, and enforce hard safety gates — all from a TypeScript script.**

```
┌─────────────────────────────────────────────────────────────────┐
│  Your pipeline script (TypeScript)                              │
│                                                                 │
│  1. llmCall      → Ask Claude Code to analyze a task            │
│  2. spawnSession → Launch Claude Code in an isolated worktree   │
│  3. waitForSignal → Session signals "done" via the event bus    │
│  4. llmCall      → Review the diff for correctness              │
│  5. gate         → Tests must pass (deterministic, no override) │
│  6. feedbackLoop → If rejected, send feedback to SAME session   │
│                    Session fixes → signals again → re-review    │
└─────────────────────────────────────────────────────────────────┘
```

### What this looks like at runtime

```
┌─────────────────────────────────────────────────────────────────┐
│ tmux                                                            │
│                                                                 │
│  pane 1: bun run pipeline.ts          ← your script             │
│          (orchestrates everything)       starts bus, spawns      │
│                                          sessions, reviews work  │
│                                                                 │
│  pane 2: claude (session A)           ← isolated worktree       │
│          working on task A...            writes code, runs tests │
│          signals "done" ──────────────→  bus event               │
│                                                                 │
│  pane 3: claude (session B)           ← another worktree        │
│          working on task B...            runs in parallel        │
│          signals "done" ──────────────→  bus event               │
│                                                                 │
│  pane 1: both done → reviewing...                               │
│          session A: tests fail → send feedback to pane 2        │
│          session B: approved                                    │
│                                                                 │
│  pane 2: received feedback, fixing...                           │
│          signals "done" ──────────────→  bus event               │
│                                                                 │
│  pane 1: session A: tests pass → approved                       │
│          pipeline complete                                      │
└─────────────────────────────────────────────────────────────────┘
```

### Why boltwork?

- **Spawn isolated Claude Code sessions** in their own git worktrees — multiple agents work in parallel without conflicts
- **Event-driven coordination** — sessions signal completion via an HTTP event bus, no polling
- **Feedback loops that preserve context** — send corrections to the same session, it remembers everything it already did
- **Deterministic safety gates** — if tests fail, the pipeline rejects. No LLM can override a gate.
- **One-shot LLM calls** for judgment — review code, analyze specs, compare screenshots. Deterministic code handles everything else.
- **Just TypeScript** — no framework, no config files, no DSL. Compose primitives with async/await.

## Install

```bash
bun add boltwork
```

Or install from a local clone:

```bash
git clone https://github.com/BrettHamlin/boltwork.git
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

Send a one-shot prompt to Claude Code, get a response. No conversation, no tools. One prompt in, one string out. Your code builds the prompt, the LLM provides judgment, your code parses the response.

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

Deterministic boolean check. If it fails, the pipeline stops. No LLM can override it. This is what makes autonomous pipelines safe — hard boundaries that code enforces.

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

Start an isolated Claude Code session in a new tmux pane. Optionally creates a git worktree so the session works on its own branch without interfering with other sessions or your main codebase.

When you pass `signalChannel`, boltwork automatically wires a Claude Code Stop hook that publishes an event to the bus when the session finishes. Your pipeline script listens for that event with `waitForSignal`.

```typescript
import { spawnSession } from "boltwork";

const drone = await spawnSession({
  brief: "Implement the login page. Run tests when done.",
  worktree: true,                  // isolated git branch
  branch: "feat/login",
  signalChannel: "ticket-123",     // wires Stop hook → bus event
  model: "sonnet",
  files: {                         // write files before launch
    "INSTRUCTIONS.md": briefContent,
  },
});

// Check if alive
if (await drone.alive()) { /* still running */ }

// Send feedback to the SAME session (preserves full context)
await drone.sendFeedback("Tests failed. Fix the auth handler.");

// Clean up when done
await drone.kill();
await drone.cleanupWorktree();
```

### publish / waitForSignal — Signal Bus

Event-driven communication between your pipeline script and Claude Code sessions. Sessions publish events when they finish work. Your script waits for those events. No polling — the bus pushes events via Server-Sent Events (SSE).

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

The review cycle. Your script checks the session's work (run tests, LLM review, whatever). If it fails, boltwork sends your feedback message into the same Claude Code session via `tmux send-keys`. The session reads the feedback, has full context of everything it already did, fixes the issues, and signals "done" again. Your script re-checks. Repeat until approved or max iterations.

```typescript
import { feedbackLoop, waitForSignal } from "boltwork";

const result = await feedbackLoop({
  name: "code-review",
  maxIterations: 3,
  session: drone,

  async check(iteration) {
    // Wait for the session to signal it's done
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

The session stays alive between iterations — no context is lost. This is critical for fix quality. A new session would have to re-read every file and re-discover every decision. The same session already knows what it did and can make targeted fixes.

## Event Bus

The bus is an HTTP SSE server that routes events between your pipeline script and Claude Code sessions. Start it before spawning sessions that use signals.

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

A pipeline that spawns a Claude Code session to implement a feature, reviews its work, and sends feedback if needed:

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
    // Spawn a Claude Code session in an isolated worktree.
    // signalChannel wires a Stop hook — when the session finishes,
    // it publishes "HOOK_Stop" to the bus automatically.
    const session = await spawnSession({
      brief: taskDescription,
      worktree: true,
      signalChannel: "my-pipeline",
    });

    // Feedback loop: wait for the session to finish, check its work,
    // send feedback if needed. The session stays alive between
    // iterations — full context preserved.
    await feedbackLoop({
      name: "implementation-review",
      maxIterations: 3,
      session,

      async check() {
        // Block until the session signals "done"
        await waitForSignal("my-pipeline", "HOOK_Stop");

        // Run tests in the session's worktree
        const tests = Bun.spawnSync(["bun", "test"], { cwd: session.cwd });

        // Ask Claude Code to review the diff
        const diff = Bun.spawnSync(["git", "diff", "HEAD~1"], { cwd: session.cwd });
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
        // Gate: tests override LLM judgment
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

    // Approved — merge the session's branch and clean up
    Bun.spawnSync(["git", "merge", session.branch!], { cwd: process.cwd() });
    await session.cleanupWorktree();

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
