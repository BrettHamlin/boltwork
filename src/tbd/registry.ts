/**
 * Primitive: Registry
 *
 * JSON file that accumulates entries over time.
 * Stages read it, filter by scope, process matches.
 * Append-only from the pipeline's perspective.
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { dirname } from "path";

/**
 * Read entries from a JSON registry file, optionally filtered.
 * Returns empty array if the file doesn't exist.
 *
 * ```ts
 * const tests = await registryRead<TestEntry>(
 *   "tests/e2e/registry.json",
 *   (e) => e.mind === "@auth",
 * );
 * ```
 */
export async function registryRead<T>(
  path: string,
  filter?: (entry: T) => boolean,
): Promise<T[]> {
  try {
    const raw = JSON.parse(await readFile(path, "utf-8"));
    const entries: T[] = Array.isArray(raw) ? raw : (raw.entries ?? []);
    return filter ? entries.filter(filter) : entries;
  } catch {
    return [];
  }
}

/**
 * Append an entry to a JSON registry file.
 * Creates the file and parent directories if they don't exist.
 *
 * ```ts
 * await registryAppend("tests/e2e/registry.json", {
 *   mind: "@auth",
 *   file: "tests/e2e/auth.test.ts",
 *   type: "unit",
 * });
 * ```
 */
export async function registryAppend<T>(
  path: string,
  entry: T,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });

  let entries: T[] = [];
  try {
    const raw = JSON.parse(await readFile(path, "utf-8"));
    entries = Array.isArray(raw) ? raw : (raw.entries ?? []);
  } catch {
    // file doesn't exist — start fresh
  }

  entries.push(entry);
  await writeFile(path, JSON.stringify(entries, null, 2) + "\n");
}
