/**
 * Checks
 *
 * Run deterministic checks on a drone's work: tests, boundary, diff.
 * All checks are subprocess calls — no LLM involved.
 */

import type { Mind, CheckResults, Finding } from "../types.ts";
import { DEFAULT_NEVER_MODIFY } from "../types.ts";
import { matchesGlob } from "./utils.ts";
import { parseAnnotations, verifyContracts } from "./contracts.ts";

/**
 * Run all deterministic checks on a drone's worktree.
 */
export async function runChecks(
  worktree: string,
  baseBranch: string,
  mind: Mind,
  testCommand: string,
  neverModify?: string[],
  tasksContent?: string,
): Promise<CheckResults> {
  const diff = getDiff(worktree, baseBranch);
  // Scope tests to the mind's owned paths — don't run the full suite
  const scopedCommand = scopeTestCommand(testCommand, mind);
  const testResult = runTests(worktree, scopedCommand);
  const boundaryResult = checkBoundary(worktree, baseBranch, mind, neverModify);

  // Contract verification: check produces/consumes annotations against the filesystem
  let contractFindings: Finding[] = [];
  if (tasksContent) {
    const mindName = mind.name.replace(/^@/, "");
    const annotations = parseAnnotations(tasksContent, mindName);
    if (annotations.length > 0) {
      contractFindings = verifyContracts(annotations, worktree, mind.owns);
    }
  }

  return {
    diff,
    testsPass: testResult.passed,
    testOutput: testResult.output,
    boundaryPass: boundaryResult.passed,
    boundaryFindings: boundaryResult.findings,
    contractsPass: contractFindings.filter((f) => f.severity === "error").length === 0,
    contractFindings,
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
 * Extracts unique parent directories from owns patterns.
 * "bun test" + owns ["src/store.ts", "src/types.ts"] → "bun test src/"
 * "bun test" + owns ["packages/core/**"] → "bun test packages/core/"
 */
function scopeTestCommand(testCommand: string, mind: Mind): string {
  const dirs = new Set<string>();

  for (const pattern of mind.owns) {
    // Strip glob suffixes
    let dir = pattern.replace(/\/?\*+$/, "");
    // If it's a file path (has extension), use the parent directory
    if (dir.includes(".")) {
      const lastSlash = dir.lastIndexOf("/");
      dir = lastSlash >= 0 ? dir.slice(0, lastSlash) : "";
    }
    // Ensure trailing slash for directory
    if (dir && !dir.endsWith("/")) dir += "/";
    if (dir) dirs.add(dir);
  }

  if (dirs.size === 0) return testCommand;

  return `${testCommand} ${[...dirs].join(" ")}`;
}

