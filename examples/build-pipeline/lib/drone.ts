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
import { normalizeMindName } from "./utils.ts";

/**
 * Spawn a drone for a specific mind.
 * Builds the brief from tasks + boundary + memory, then launches the session.
 *
 * In multi-repo mode, the drone's cwd is set to the repo the mind belongs to.
 */
export async function spawnDrone(
  mindName: string,
  config: PipelineConfig,
  minds: Mind[],
  taskGroups: TaskGroup[],
  busUrl: string,
  model: string,
  repoPaths?: Map<string, string>,
): Promise<DroneInfo> {
  const mind = findMind(minds, mindName);
  if (!mind) throw new Error(`Mind "${mindName}" not found in registry`);

  // Resolve the working directory — use repo path in multi-repo, cwd otherwise
  const cwd = resolveDroneCwd(mind, repoPaths);

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

  const channel = `boltwork-${config.ticketId}-${normalizeMindName(mindName)}`;

  const session = await spawnSession({
    brief,
    worktree: true,
    branch: `boltwork/${config.ticketId}-${normalizeMindName(mindName)}`,
    signalChannel: channel,
    busUrl,
    model,
    cwd,
  });

  console.log(`  Spawned: ${mind.name} → ${session.branch}${mind.repo ? ` (repo: ${mind.repo})` : ""}`);

  return { mind: mindName, session, channel, memory, repo: mind.repo };
}

/**
 * Resolve the cwd for a drone. In multi-repo mode, uses the repo path.
 * Returns undefined for single-repo (spawnSession defaults to process.cwd).
 */
function resolveDroneCwd(
  mind: Mind,
  repoPaths?: Map<string, string>,
): string | undefined {
  if (!mind.repo || !repoPaths) return undefined;

  const repoRoot = repoPaths.get(mind.repo);
  if (!repoRoot) {
    throw new Error(`Mind "${mind.name}" references repo "${mind.repo}" but it is not in the workspace`);
  }

  return repoRoot;
}
