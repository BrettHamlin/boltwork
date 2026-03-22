/**
 * Mind Registry
 *
 * Load and query the mind registry (minds.json).
 * The registry defines how the codebase is partitioned into owned domains.
 */

import { readFile } from "fs/promises";
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
