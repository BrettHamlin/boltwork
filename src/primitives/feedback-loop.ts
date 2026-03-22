/**
 * Primitive: Feedback Loop
 *
 * Run → Check → Feedback → Run again.
 * The session stays alive between iterations (context preservation).
 * Exits on pass or max iterations.
 *
 * This primitive depends on the SessionHandle interface but does NOT
 * import the session module. It takes a SessionHandle as a parameter.
 */

import { MaxIterationsExceeded } from "../errors.ts";
import type { SessionHandle } from "./session.ts";

export interface FeedbackLoopOptions<CheckResult> {
  /** Name for logging/error messages. */
  name: string;
  /** Maximum iterations before giving up. */
  maxIterations: number;
  /** The session to send feedback to. */
  session: SessionHandle;
  /** Run checks on the session's work. Called each iteration. */
  check: (iteration: number) => Promise<CheckResult>;
  /** Does the check result pass? */
  passed: (result: CheckResult) => boolean;
  /** Build a feedback message from a failing check result. */
  feedback: (result: CheckResult) => string | Promise<string>;
}

/**
 * Run a feedback loop: check the session's work, send feedback if it fails,
 * repeat until it passes or max iterations is reached.
 *
 * ```ts
 * await feedbackLoop({
 *   name: "code-review",
 *   maxIterations: 3,
 *   session: drone,
 *
 *   async check(iteration) {
 *     await waitForSignal("ticket-123", "HOOK_Stop");
 *     const tests = Bun.spawnSync(["bun", "test"], { cwd: drone.cwd });
 *     return { passed: tests.exitCode === 0, output: tests.stderr.toString() };
 *   },
 *
 *   passed(result) { return result.passed; },
 *
 *   feedback(result) { return `Tests failed:\n${result.output}`; },
 * });
 * ```
 *
 * Returns the final passing check result, or throws MaxIterationsExceeded.
 */
export async function feedbackLoop<CheckResult>(
  options: FeedbackLoopOptions<CheckResult>,
): Promise<CheckResult> {
  for (let i = 1; i <= options.maxIterations; i++) {
    const result = await options.check(i);

    if (options.passed(result)) {
      return result;
    }

    // Last iteration — don't send feedback, just fail
    if (i === options.maxIterations) {
      throw new MaxIterationsExceeded(options.name, options.maxIterations);
    }

    // Send feedback to the same session (preserves context)
    const message = await options.feedback(result);
    await options.session.sendFeedback(message);
  }

  // Unreachable, but satisfies TypeScript
  throw new MaxIterationsExceeded(options.name, options.maxIterations);
}
