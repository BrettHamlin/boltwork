/**
 * Primitive: Memory / Knowledge
 *
 * Persistent knowledge store using markdown files.
 * Append entries to a MEMORY.md file, recall entries by searching content.
 * Committed to git so knowledge survives resets.
 */

import { readFile, appendFile, mkdir } from "fs/promises";
import { dirname } from "path";

export interface MemoryEntry {
  content: string;
  timestamp: number;
}

/**
 * Append a learning to a memory file. Creates the file if it doesn't exist.
 *
 * ```ts
 * await remember(
 *   ".minds/auth/memory/MEMORY.md",
 *   "New modules MUST be registered in din.config.ts",
 * );
 * ```
 */
export async function remember(
  path: string,
  content: string,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });

  const timestamp = new Date().toISOString();
  const entry = `\n- [${timestamp}] ${content}\n`;

  await appendFile(path, entry);
}

/**
 * Read all entries from a memory file. Returns empty array if file doesn't exist.
 * Optionally filter by a search string (case-insensitive substring match).
 *
 * ```ts
 * const rules = await recall(".minds/auth/memory/MEMORY.md");
 * const configRules = await recall(".minds/auth/memory/MEMORY.md", "config");
 * ```
 */
export async function recall(
  path: string,
  search?: string,
): Promise<MemoryEntry[]> {
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch {
    return [];
  }

  const entries: MemoryEntry[] = [];
  const lines = raw.split("\n");

  for (const line of lines) {
    const match = line.match(/^- \[(\d{4}-\d{2}-\d{2}T[\d:.]+Z?)\] (.+)$/);
    if (!match) continue;

    const timestamp = new Date(match[1]!).getTime();
    const content = match[2]!;

    if (search && !content.toLowerCase().includes(search.toLowerCase())) {
      continue;
    }

    entries.push({ content, timestamp });
  }

  return entries;
}
