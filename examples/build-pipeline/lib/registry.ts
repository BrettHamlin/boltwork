/**
 * Mind Registry
 *
 * Load and query the mind registry (minds.json).
 * The registry defines how the codebase is partitioned into owned domains.
 */

import { readFile } from "fs/promises";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { Mind } from "../types.ts";

/**
 * Load minds from a registry file.
 *
 * ```json
 * // minds.json
 * {
 *   "minds": [
 *     { "name": "@auth", "domain": "Authentication", "owns": ["src/auth/**"] },
 *     { "name": "@api", "domain": "API routes", "owns": ["src/routes/**"] }
 *   ]
 * }
 * ```
 */
export async function loadRegistry(path: string): Promise<Mind[]> {
  const raw = JSON.parse(await readFile(path, "utf-8"));
  const minds: Mind[] = raw.minds ?? raw;

  if (!Array.isArray(minds) || minds.length === 0) {
    throw new Error(`Registry at ${path} has no minds`);
  }

  // Validate required fields
  for (const mind of minds) {
    if (!mind.name) throw new Error(`Mind missing name in ${path}`);
    if (!mind.owns || mind.owns.length === 0) {
      throw new Error(`Mind "${mind.name}" has no owns patterns in ${path}`);
    }
  }

  return minds;
}

/** Find a mind by name. */
export function findMind(minds: Mind[], name: string): Mind | undefined {
  // Normalize: accept with or without @ prefix
  const normalized = name.startsWith("@") ? name : `@${name}`;
  return minds.find((m) => m.name === normalized || m.name === name);
}

/**
 * Load mind registries from each repo in a multi-repo workspace.
 * Tags each mind with its repo alias. Throws on name collisions.
 * Silently skips repos without a minds.json.
 */
export function loadMultiRepoRegistry(repoPaths: Map<string, string>): Mind[] {
  const merged: Mind[] = [];

  for (const [alias, repoPath] of repoPaths) {
    // Check both .minds/minds.json and minds.json (root level)
    let jsonPath = join(repoPath, ".minds", "minds.json");
    if (!existsSync(jsonPath)) {
      jsonPath = join(repoPath, "minds.json");
    }
    if (!existsSync(jsonPath)) continue;

    const raw = JSON.parse(readFileSync(jsonPath, "utf-8"));
    const minds: Mind[] = raw.minds ?? raw;

    if (!Array.isArray(minds)) continue;

    for (const mind of minds) {
      if (!mind.name) throw new Error(`Mind missing name in ${jsonPath}`);
      if (!mind.owns || mind.owns.length === 0) {
        throw new Error(`Mind "${mind.name}" has no owns patterns in ${jsonPath}`);
      }

      const existing = merged.find((m) => m.name === mind.name);
      if (existing) {
        throw new Error(
          `Mind name collision: ${mind.name} exists in both "${existing.repo ?? "unknown"}" and "${alias}"`,
        );
      }

      merged.push({ ...mind, repo: alias });
    }
  }

  if (merged.length === 0) {
    throw new Error("No minds found in any repo. Ensure at least one repo has a minds.json.");
  }

  return merged;
}
