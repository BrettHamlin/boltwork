/**
 * Merge
 *
 * Sequential branch merging after wave approval.
 * Merges each drone's branch into the base branch in order.
 */

import type { SessionHandle } from "boltwork";

export interface MergeResult {
  mind: string;
  branch: string;
  success: boolean;
  error?: string;
}

/**
 * Merge a drone's branch into the current branch.
 */
export function mergeBranch(
  repoRoot: string,
  branch: string,
  mind: string,
  waveId: string,
): MergeResult {
  const result = Bun.spawnSync(
    ["git", "merge", "--no-ff", branch, "-m", `merge: ${mind} (${waveId})`],
    { cwd: repoRoot },
  );

  if (result.exitCode !== 0) {
    return {
      mind,
      branch,
      success: false,
      error: result.stderr.toString().trim(),
    };
  }

  return { mind, branch, success: true };
}

/**
 * Clean up a drone's worktree and branch.
 */
export async function cleanupDrone(
  repoRoot: string,
  session: SessionHandle,
): Promise<void> {
  await session.kill();
  await session.cleanupWorktree();
}
