# boltwork

Composable primitives for AI agent pipelines. Built around Claude Code.

## Architecture

```
src/
  index.ts              — public API (re-exports only)
  errors.ts             — all error types (centralized)
  bus/
    server.ts           — HTTP SSE bus server (standalone process)
    client.ts           — bus publish/subscribe (HTTP client)
  primitives/
    llm-call.ts         — one-shot claude -p call
    gate.ts             — boolean assertion, throws on false
    session.ts          — spawn Claude Code in tmux pane + worktree
    signal.ts           — publish/wait for bus events
    registry.ts         — read/append JSON file
    memory.ts           — read/write MEMORY.md files
    feedback-loop.ts    — check → feedback → retry cycle
    installer.ts        — copy files, preserve project data
```

## Principles

- **Each primitive is one file, one concern.** No primitive imports another primitive.
- **No shared state.** No singletons, no global context. Functions take what they need as args.
- **Errors are centralized.** All error types live in errors.ts.
- **index.ts is the only public API.** It decides what's exported.
- **TypeScript + Bun.** All code runs with bun. Use Bun APIs over Node APIs where possible.
- **No external dependencies.** Zero npm deps beyond @types/bun.

## Commands

```bash
bun test                           # run tests
bun run src/bus/server.ts          # start the event bus
```

## Tests

Tests live in `src/__tests__/`. One test file per primitive.
Run with: `bun test`
