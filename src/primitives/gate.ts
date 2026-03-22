/**
 * Primitive: Gate / Force-Override
 *
 * Deterministic boolean check. If it fails, throws GateRejection.
 * No LLM can override it. This is the hard safety boundary.
 */

import { GateRejection } from "../errors.ts";

/**
 * Assert a condition is true. Throws GateRejection if false.
 *
 * ```ts
 * gate(tests.passed, "Tests must pass");
 * gate(boundary.clean, "No boundary violations");
 * gate(response.includes("APPROVED"), "Review must approve");
 * ```
 */
export function gate(condition: boolean, reason: string): void {
  if (!condition) {
    throw new GateRejection(reason);
  }
}

/**
 * Async gate for checks that require awaiting.
 *
 * ```ts
 * await gateAsync(async () => {
 *   const proc = Bun.spawn(["bun", "test"]);
 *   return (await proc.exited) === 0;
 * }, "Tests must pass");
 * ```
 */
export async function gateAsync(
  check: () => boolean | Promise<boolean>,
  reason: string,
): Promise<void> {
  const ok = await check();
  if (!ok) {
    throw new GateRejection(reason);
  }
}
