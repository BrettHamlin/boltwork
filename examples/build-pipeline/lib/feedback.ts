/**
 * Feedback
 *
 * Build structured feedback files from review findings.
 * Written to the drone's worktree so it can read them on the next iteration.
 */

import { writeFile } from "fs/promises";
import { join } from "path";
import type { ReviewVerdict } from "../types.ts";

/**
 * Write a feedback file to the drone's worktree.
 * Files are named REVIEW-FEEDBACK-{iteration}.md so they accumulate.
 */
export async function writeFeedback(
  worktree: string,
  iteration: number,
  verdict: ReviewVerdict,
  testOutput?: string,
): Promise<string> {
  const content = buildFeedbackContent(iteration, verdict, testOutput);
  const filename = `REVIEW-FEEDBACK-${iteration}.md`;
  const path = join(worktree, filename);

  await writeFile(path, content);
  return path;
}

/**
 * Load all previous feedback files from a worktree.
 * Returns concatenated content for injection into the review prompt.
 */
export async function loadPreviousFeedback(
  worktree: string,
  currentIteration: number,
): Promise<string> {
  const parts: string[] = [];

  for (let i = 1; i < currentIteration; i++) {
    const path = join(worktree, `REVIEW-FEEDBACK-${i}.md`);
    try {
      const content = await Bun.file(path).text();
      parts.push(content);
    } catch {
      // feedback file doesn't exist for this iteration
    }
  }

  return parts.join("\n---\n");
}

/** Build the markdown content for a feedback file. */
function buildFeedbackContent(
  iteration: number,
  verdict: ReviewVerdict,
  testOutput?: string,
): string {
  const sections: string[] = [];

  sections.push(`# Review Feedback — Iteration ${iteration}`);
  sections.push(`## Issues Found (${verdict.findings.length})`);

  for (const finding of verdict.findings) {
    const location = finding.file
      ? `${finding.file}${finding.line ? `:${finding.line}` : ""}`
      : "(general)";
    sections.push(`- **${finding.severity}**: ${location} — ${finding.message}`);
    if (finding.suggestion) {
      sections.push(`  Fix: ${finding.suggestion}`);
    }
  }

  if (testOutput) {
    sections.push(`## Test Output\n\`\`\`\n${testOutput.slice(-5_000)}\n\`\`\``);
  }

  return sections.join("\n\n");
}
