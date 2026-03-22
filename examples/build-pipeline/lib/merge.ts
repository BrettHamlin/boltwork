/**
 * Merge
 *
 * Sequential branch merging after wave approval.
 * Merges each drone's branch into the base branch in order.
 * In multi-repo mode, merges happen in the correct repo directory.
 */

import type { SessionHandle } from "boltwork";
import type { DroneResult } from "../types.ts";

export interface MergeResult {
  mind: string;
  branch: string;
  success: boolean;
  error?: string;
}

/**
 * Merge a drone's branch into the current branch.
 * Uses repoRoot as the cwd — in multi-repo, this should be the repo the drone worked in.
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
 * Group drone results by repo alias for multi-repo merging.
 * Single-repo drones (no repo field) are grouped under the key "".
 */
export function groupDronesByRepo(drones: DroneResult[]): Map<string, DroneResult[]> {
  const groups = new Map<string, DroneResult[]>();

  for (const drone of drones) {
    const key = drone.repo ?? "";
    const group = groups.get(key);
    if (group) {
      group.push(drone);
    } else {
      groups.set(key, [drone]);
    }
  }

  return groups;
}

/**
 * Resolve the merge directory for a drone result.
 * In multi-repo: uses repoPaths to find the repo root.
 * In single-repo: uses the default repo root.
 */
export function resolveMergeDir(
  defaultRoot: string,
  drone: DroneResult,
  repoPaths?: Map<string, string>,
): string {
  if (!drone.repo || !repoPaths) return defaultRoot;

  const repoRoot = repoPaths.get(drone.repo);
  if (!repoRoot) {
    throw new Error(`Drone "${drone.mind}" references repo "${drone.repo}" but it is not in the workspace`);
  }

  return repoRoot;
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
