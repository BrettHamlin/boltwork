/**
 * Checks
 *
 * Run deterministic checks on a drone's work: tests, boundary, diff.
 * All checks are subprocess calls — no LLM involved.
 */

import type { Mind, CheckResults, Finding } from "../types.ts";
import { DEFAULT_NEVER_MODIFY } from "../types.ts";
import { matchesGlob } from "./utils.ts";

/**
 * Run all deterministic checks on a drone's worktree.
 */
export async function runChecks(
  worktree: string,
  baseBranch: string,
  mind: Mind,
  testCommand: string,
  neverModify?: string[],
): Promise<CheckResults> {
  const diff = getDiff(worktree, baseBranch);
  // Scope tests to the mind's owned paths — don't run the full suite
  const scopedCommand = scopeTestCommand(testCommand, mind);
  const testResult = runTests(worktree, scopedCommand);
  const boundaryResult = checkBoundary(worktree, baseBranch, mind, neverModify);

  return {
    diff,
    testsPass: testResult.passed,
    testOutput: testResult.output,
    boundaryPass: boundaryResult.passed,
    boundaryFindings: boundaryResult.findings,
  };
}

/** Get the git diff between the drone's branch and the base branch. */
function getDiff(worktree: string, baseBranch: string): string {
  const result = Bun.spawnSync(
    ["git", "diff", `${baseBranch}...HEAD`],
    { cwd: worktree },
  );
  const diff = result.stdout.toString();
  // Truncate to 50KB to avoid overwhelming the LLM review
  return diff.length > 50_000 ? diff.slice(0, 50_000) + "\n... (truncated)" : diff;
}

/** Run tests scoped to the drone's worktree. */
function runTests(
  worktree: string,
  testCommand: string,
): { passed: boolean; output: string } {
  const parts = testCommand.split(" ");
  const result = Bun.spawnSync(parts, { cwd: worktree });

  return {
    passed: result.exitCode === 0,
    output: result.stderr.toString().slice(-20_000), // last 20KB
  };
}

/** Check that the drone only modified files within its boundary and didn't touch never-modify files. */
function checkBoundary(
  worktree: string,
  baseBranch: string,
  mind: Mind,
  extraNeverModify?: string[],
): { passed: boolean; findings: Finding[] } {
  const neverModify = [...DEFAULT_NEVER_MODIFY, ...(extraNeverModify ?? [])];

  // Get files the drone modified
  const logResult = Bun.spawnSync(
    ["git", "log", "--name-only", "--pretty=format:", `${baseBranch}..HEAD`],
    { cwd: worktree },
  );
  // Filter out boltwork infrastructure files — these are written by the pipeline, not the drone
  const BOLTWORK_FILES = ["BOLTWORK-BRIEF.md", "BOLTWORK-FEEDBACK.md", ".claude/settings.local.json"];

  const modifiedFiles = logResult.stdout
    .toString()
    .split("\n")
    .map((f) => f.trim())
    .filter((f) => f && !BOLTWORK_FILES.includes(f));

  if (modifiedFiles.length === 0) {
    return { passed: true, findings: [] };
  }

  const findings: Finding[] = [];

  for (const file of modifiedFiles) {
    // Check never-modify list first (higher priority)
    if (neverModify.some((nm) => file === nm || file.endsWith(`/${nm}`))) {
      findings.push({
        file,
        severity: "error",
        message: `Protected file modified: "${file}" is on the never-modify list`,
      });
      continue;
    }

    // Check boundary ownership
    const owned = mind.owns.some((pattern) => matchesGlob(file, pattern));
    if (!owned) {
      findings.push({
        file,
        severity: "error",
        message: `File outside boundary: "${file}" is not in ${mind.name}'s owns patterns`,
      });
    }
  }

  return {
    passed: findings.length === 0,
    findings,
  };
}

/**
 * Scope the test command to the mind's owned directories.
 * "bun test" + owns ["packages/core/**"] → "bun test packages/core/"
 */
function scopeTestCommand(testCommand: string, mind: Mind): string {
  // Extract directory prefixes from owns patterns (strip trailing ** and *)
  const dirs = mind.owns
    .map((pattern) => pattern.replace(/\/?\*+$/, ""))
    .filter(Boolean);

  if (dirs.length === 0) return testCommand;

  // Append scoped directories to the test command
  return `${testCommand} ${dirs.join(" ")}`;
}

