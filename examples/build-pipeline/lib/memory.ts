/**
 * Memory
 *
 * Load project-specific rules for a mind and format them
 * for injection into drone briefs and review prompts.
 */

import { readFile } from "fs/promises";
import { join } from "path";
import { normalizeMindName } from "./utils.ts";

/**
 * Load memory entries for a mind. Returns empty string if no memory file exists.
 *
 * Memory files live at: {memoryDir}/{mindName}/MEMORY.md
 */
export async function loadMemory(memoryDir: string, mindName: string): Promise<string> {
  const name = normalizeMindName(mindName);
  const path = join(memoryDir, name, "MEMORY.md");

  try {
    return await readFile(path, "utf-8");
  } catch {
    return "";
  }
}

/**
 * Format memory for injection into a drone brief.
 * Returns empty string if no memory exists.
 */
export function formatMemoryForBrief(memory: string): string {
  if (!memory.trim()) return "";

  return [
    "## Memory (MANDATORY)",
    "",
    "These are mandatory rules learned from previous runs.",
    "The reviewer WILL REJECT your work if any are violated.",
    "",
    memory.trim(),
  ].join("\n");
}

/**
 * Format memory for injection into a review prompt.
 * Returns empty string if no memory exists.
 */
export function formatMemoryForReview(memory: string): string {
  if (!memory.trim()) return "";

  return [
    "## Mind Memory (MANDATORY — reject if violated)",
    "",
    "If any instruction below was not followed in the diff, you MUST reject",
    "and list which memory item was violated.",
    "",
    memory.trim(),
  ].join("\n");
}
