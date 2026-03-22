/**
 * Drone
 *
 * Build the brief and spawn a Claude Code session for a specific mind.
 * One responsibility: turn a mind + tasks + config into a running session.
 */

import { spawnSession } from "boltwork";
import type { PipelineConfig, Mind, TaskGroup, DroneInfo } from "../types.ts";
import { DEFAULT_NEVER_MODIFY } from "../types.ts";
import { findMind } from "./registry.ts";
import { loadMemory, formatMemoryForBrief } from "./memory.ts";
import { formatTasksForBrief } from "./tasks.ts";

/**
 * Spawn a drone for a specific mind.
 * Builds the brief from tasks + boundary + memory, then launches the session.
 */
export async function spawnDrone(
  mindName: string,
  config: PipelineConfig,
  minds: Mind[],
  taskGroups: TaskGroup[],
  busUrl: string,
  model: string,
): Promise<DroneInfo> {
  const mind = findMind(minds, mindName);
  if (!mind) throw new Error(`Mind "${mindName}" not found in registry`);

  const taskSection = formatTasksForBrief(taskGroups, mindName);
  const memory = config.memoryDir
    ? await loadMemory(config.memoryDir, mindName)
    : "";
  const memorySection = formatMemoryForBrief(memory);

  const boundary = mind.owns.map((p) => `  - ${p}`).join("\n");
  const neverModify = [...DEFAULT_NEVER_MODIFY, ...(config.neverModify ?? [])];
  const neverModifyList = neverModify.map((f) => `  - ${f}`).join("\n");

  const brief = [
    `# ${config.ticketId} — ${mind.name}`,
    "",
    taskSection,
    "",
    `## File Boundary`,
    `You may ONLY create or modify files within these paths:`,
    boundary,
    "",
    `**NEVER modify these files** (changes will always be rejected):`,
    neverModifyList,
    "",
    memorySection,
    "",
    `When done, commit your changes with message: "feat: ${config.ticketId} ${mind.name} — <summary>"`,
  ]
    .filter(Boolean)
    .join("\n");

  const channel = `boltwork-${config.ticketId}-${mindName.replace("@", "")}`;

  const session = await spawnSession({
    brief,
    worktree: true,
    branch: `boltwork/${config.ticketId}-${mindName.replace("@", "")}`,
    signalChannel: channel,
    busUrl,
    model,
  });

  console.log(`  Spawned: ${mind.name} → ${session.branch}`);

  return { mind: mindName, session, channel, memory };
}
