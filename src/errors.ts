/**
 * Centralized error types for all boltwork primitives.
 * Each primitive throws from this set — no primitive defines its own errors.
 */

/** Gate check failed. The pipeline should stop. */
export class GateRejection extends Error {
  override readonly name = "GateRejection";
  constructor(public readonly reason: string) {
    super(`Gate rejected: ${reason}`);
  }
}

/** LLM call (claude -p) failed. */
export class LLMCallError extends Error {
  override readonly name = "LLMCallError";
  constructor(
    message: string,
    public readonly exitCode?: number,
  ) {
    super(message);
  }
}

/** Spawning a Claude Code session failed. */
export class SessionSpawnError extends Error {
  override readonly name = "SessionSpawnError";
  constructor(message: string) {
    super(message);
  }
}

/** Signal timed out waiting for an event. */
export class SignalTimeout extends Error {
  override readonly name = "SignalTimeout";
  constructor(
    public readonly channel: string,
    public readonly signalType: string,
    public readonly timeoutMs: number,
  ) {
    super(`Timed out waiting for "${signalType}" on "${channel}" after ${timeoutMs}ms`);
  }
}

/** Signal bus communication failed. */
export class SignalError extends Error {
  override readonly name = "SignalError";
  constructor(message: string) {
    super(message);
  }
}

/** Feedback loop exhausted all iterations without passing. */
export class MaxIterationsExceeded extends Error {
  override readonly name = "MaxIterationsExceeded";
  constructor(
    public readonly loopName: string,
    public readonly maxIterations: number,
  ) {
    super(`Loop "${loopName}" exceeded ${maxIterations} iterations without passing`);
  }
}

/** Installer failed to copy files. */
export class InstallerError extends Error {
  override readonly name = "InstallerError";
  constructor(message: string) {
    super(message);
  }
}
