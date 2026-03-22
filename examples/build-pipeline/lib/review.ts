/**
 * Review
 *
 * Structured LLM code review with force-rejection logic.
 * Builds the review prompt, calls the LLM, parses the verdict,
 * then applies deterministic overrides.
 */

import { llmCall } from "boltwork";
import type { CheckResults, ReviewVerdict, Finding } from "../types.ts";
import { extractJson } from "./utils.ts";

export interface ReviewOptions {
  /** The diff to review */
  diff: string;
  /** Test output (for context) */
  testOutput: string;
  /** The tasks that were assigned */
  tasks: string;
  /** Standards to check against (optional) */
  standards?: string;
  /** Memory rules to enforce (optional) */
  memory?: string;
  /** Feedback from prior iterations (optional) */
  previousFeedback?: string;
  /** Model for the review LLM call */
  model?: string;
}

/**
 * Run a structured LLM code review and return a verdict with findings.
 */
export async function runReview(options: ReviewOptions): Promise<ReviewVerdict> {
  const prompt = buildReviewPrompt(options);

  const response = await llmCall(prompt, {
    model: options.model ?? "sonnet",
    timeout: 300_000,
  });

  return parseVerdict(response);
}

/**
 * Apply force-rejections: deterministic checks override LLM approval.
 * Returns a new verdict — does not mutate the original.
 */
export function applyForceRejections(
  verdict: ReviewVerdict,
  checks: CheckResults,
): ReviewVerdict {
  const findings = [...verdict.findings];
  let approved = verdict.approved;

  // Tests fail → reject, even if LLM approved
  if (!checks.testsPass && approved) {
    approved = false;
    findings.push({
      severity: "error",
      message: "Tests failing — deterministic rejection (overrides LLM approval)",
    });
  }

  // Boundary violation → reject, even if LLM approved
  if (!checks.boundaryPass && approved) {
    approved = false;
    findings.push(...checks.boundaryFindings);
  }

  // Contract violation → reject, even if LLM approved
  if (!checks.contractsPass && approved) {
    approved = false;
    findings.push({
      severity: "error",
      message: "Contract verification failed — deterministic rejection (overrides LLM approval)",
    });
    findings.push(...checks.contractFindings);
  }

  return { approved, findings };
}

/** Build the review prompt from all available context. */
function buildReviewPrompt(options: ReviewOptions): string {
  const sections: string[] = [];

  sections.push("You are reviewing a code change. Be thorough but fair.");

  sections.push(`## Tasks Assigned\n${options.tasks}`);

  sections.push(`## Diff\n\`\`\`\n${options.diff.slice(0, 30_000)}\n\`\`\``);

  if (options.testOutput) {
    sections.push(`## Test Output\n\`\`\`\n${options.testOutput.slice(-5_000)}\n\`\`\``);
  }

  if (options.standards) {
    sections.push(`## Standards\n${options.standards}`);
  }

  if (options.memory) {
    sections.push(options.memory);
  }

  if (options.previousFeedback) {
    sections.push(`## Previous Feedback (must be addressed)\n${options.previousFeedback}`);
  }

  sections.push(`## Review Checklist
1. All assigned tasks implemented
2. No duplicated logic
3. All tests pass
4. No dead code or unused imports
5. Code follows existing codebase patterns
6. Error messages include context`);

  sections.push(`## Response Format
Return ONLY a JSON object (no markdown, no backticks):
{
  "approved": true or false,
  "findings": [
    {
      "file": "path/to/file.ts",
      "line": 42,
      "severity": "error" or "warning",
      "message": "what's wrong",
      "suggestion": "how to fix it"
    }
  ]
}

If everything looks good, return: {"approved": true, "findings": []}`);

  return sections.join("\n\n");
}

/** Parse the LLM response into a ReviewVerdict. */
function parseVerdict(response: string): ReviewVerdict {
  try {
    const parsed = JSON.parse(extractJson(response));
    return {
      approved: Boolean(parsed.approved),
      findings: Array.isArray(parsed.findings) ? parsed.findings : [],
    };
  } catch {
    // If we can't parse, treat as rejection with the raw response as a finding
    return {
      approved: false,
      findings: [{
        severity: "error",
        message: `Review response was not valid JSON: ${response.slice(0, 200)}`,
      }],
    };
  }
}
