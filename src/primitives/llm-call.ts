/**
 * Primitive: One-Shot LLM Call
 *
 * Sends a prompt to `claude -p` and returns the response.
 * No conversation, no tools — one prompt in, one string out.
 * The caller builds the prompt deterministically and parses the response deterministically.
 */

import { LLMCallError } from "../errors.ts";

export interface LLMCallOptions {
  /** Model to use. Default: "sonnet" */
  model?: string;
  /** Max tokens for the response. */
  maxTokens?: number;
  /** Timeout in ms. Default: 120_000 (2 min) */
  timeout?: number;
}

/**
 * Send a prompt to `claude -p` and return the raw response string.
 *
 * ```ts
 * const review = await llmCall("Review this code for bugs:\n" + code);
 * const tasks = await llmCall("Return JSON: which modules are affected?", { model: "opus" });
 * ```
 */
export async function llmCall(
  prompt: string,
  options?: LLMCallOptions,
): Promise<string> {
  const model = options?.model ?? "sonnet";
  const timeout = options?.timeout ?? 120_000;

  const args = ["claude", "-p", "--model", model];
  if (options?.maxTokens) {
    args.push("--max-tokens", String(options.maxTokens));
  }

  const proc = Bun.spawn(args, {
    stdin: new Response(prompt),
    stdout: "pipe",
    stderr: "pipe",
  });

  const timer = setTimeout(() => proc.kill(), timeout);

  try {
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();

    if (exitCode !== 0) {
      throw new LLMCallError(
        `claude -p exited with code ${exitCode}: ${stderr.trim()}`,
        exitCode,
      );
    }

    return stdout.trim();
  } finally {
    clearTimeout(timer);
  }
}
