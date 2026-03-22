/**
 * Tasks
 *
 * Parse a tasks.md file into structured task groups.
 * Task generation (spec → tasks.md) is left to the user's pipeline script
 * since it depends on the project and LLM prompting strategy.
 */

import { readFile } from "fs/promises";
import type { TaskGroup, Task } from "../types.ts";

/**
 * Parse a tasks.md file into task groups.
 *
 * Expected format:
 * ```
 * ## @mind-name Tasks
 * - [ ] T001 @mind-name description
 * - [ ] T002 @mind-name [P] parallel task
 *
 * ## @other-mind Tasks (depends on: @mind-name)
 * - [ ] T003 @other-mind description
 * ```
 */
export async function parseTasks(path: string): Promise<TaskGroup[]> {
  const content = await readFile(path, "utf-8");
  return parseTaskContent(content);
}

/** Parse task content string into task groups. */
export function parseTaskContent(content: string): TaskGroup[] {
  const groups: TaskGroup[] = [];
  let currentGroup: TaskGroup | null = null;
  let taskCounter = 0;

  for (const line of content.split("\n")) {
    // Section header: ## @mind-name Tasks (depends on: @other)
    const headerMatch = line.match(
      /^##\s+(@[\w-]+)\s+Tasks(?:\s*\(depends on:\s*(.+?)\))?/,
    );
    if (headerMatch) {
      const mind = headerMatch[1]!;
      const deps = headerMatch[2]
        ? headerMatch[2].split(",").map((d) => d.trim())
        : [];
      currentGroup = { mind, tasks: [], dependsOn: deps };
      groups.push(currentGroup);
      continue;
    }

    // Task line: - [ ] T001 @mind-name [P] description
    const taskMatch = line.match(
      /^-\s+\[[ x]\]\s+(T\d+)\s+(@[\w-]+)\s+(?:\[P\]\s+)?(.+)$/,
    );
    if (taskMatch && currentGroup) {
      taskCounter++;
      const task: Task = {
        id: taskMatch[1]!,
        mind: taskMatch[2]!,
        description: taskMatch[3]!,
        parallel: line.includes("[P]"),
      };
      currentGroup.tasks.push(task);
    }
  }

  return groups;
}

/**
 * Format task groups for a specific mind into a brief section.
 * Used when building the drone's instructions.
 */
export function formatTasksForBrief(groups: TaskGroup[], mind: string): string {
  const group = groups.find((g) => g.mind === mind);
  if (!group) return "";

  const lines = [`## Tasks for ${mind}\n`];
  for (const task of group.tasks) {
    lines.push(`- [ ] ${task.id}: ${task.description}`);
  }
  return lines.join("\n");
}
