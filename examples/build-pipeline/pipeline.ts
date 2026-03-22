/**
 * Build Pipeline
 *
 * Opinionated build pipeline built on boltwork primitives.
 * Orchestrates: tasks -> waves -> parallel drones -> review -> merge.
 *
 * Supports both single-repo and multi-repo workspaces.
 *
 * Usage:
 *   bun run pipeline.ts --ticket BRE-700 --spec specs/BRE-700/spec.md
 */

import { startBus, gate } from "boltwork";
import type { PipelineConfig, PipelineResult, WaveResult } from "./types.ts";
import { loadRegistry, loadMultiRepoRegistry } from "./lib/registry.ts";
import { parseTasks } from "./lib/tasks.ts";
import { generateTasks } from "./lib/generate-tasks.ts";
import { computeWaves } from "./lib/waves.ts";
import { spawnDrone } from "./lib/drone.ts";
import { reviewDrone } from "./lib/review-loop.ts";
import { mergeBranch, cleanupDrone, resolveMergeDir } from "./lib/merge.ts";
import { generateReport } from "./lib/report.ts";
import { loadWorkspace } from "./lib/workspace.ts";

/**
 * Run the full build pipeline.
 */
export async function runPipeline(config: PipelineConfig): Promise<PipelineResult> {
  const maxIterations = config.maxIterations ?? 3;
  const busPort = config.busPort ?? 8080;
  const droneModel = config.droneModel ?? "sonnet";
  const droneTimeout = config.droneTimeout ?? 300_000;

  // Resolve workspace — multi-repo or single-repo
  const workspace = config.workspacePath
    ? loadWorkspace(config.workspacePath)
    : null;

  // Load minds from registry
  let minds;
  if (workspace?.isMultiRepo) {
    minds = loadMultiRepoRegistry(workspace.repoPaths);
    console.log(`Workspace: multi-repo (${workspace.repoPaths.size} repos)`);
    for (const [alias, path] of workspace.repoPaths) {
      console.log(`  ${alias}: ${path}`);
    }
  } else {
    minds = await loadRegistry(config.registryPath);
  }

  const standards = config.standardsPath
    ? await Bun.file(config.standardsPath).text().catch(() => "")
    : "";

  // Generate or load tasks
  let taskGroups;
  if (config.tasksPath) {
    taskGroups = await parseTasks(config.tasksPath);
  } else {
    const spec = await Bun.file(config.specPath).text();
    const outputPath = `specs/${config.ticketId}/tasks.md`;
    taskGroups = await generateTasks(config.ticketId, spec, minds, outputPath, {
      model: config.taskModel,
    });
  }

  const waves = computeWaves(taskGroups);

  console.log(`Pipeline: ${config.ticketId}`);
  console.log(`  Minds: ${minds.map((m) => m.name).join(", ")}`);
  console.log(`  Waves: ${waves.length}`);

  // Start infrastructure
  const bus = await startBus({ port: busPort });
  const baseBranch = getCurrentBranch();
  const baseCommit = getCurrentCommit();
  const results: WaveResult[] = [];

  // Pass repoPaths to drone spawning for multi-repo cwd resolution
  const repoPaths = workspace?.isMultiRepo ? workspace.repoPaths : undefined;

  try {
    for (const wave of waves) {
      console.log(`\n--- ${wave.id}: [${wave.minds.join(", ")}] ---`);

      // Spawn drones in parallel for this wave
      const drones = await Promise.all(
        wave.minds.map((mindName) =>
          spawnDrone(mindName, config, minds, taskGroups, bus.url, droneModel, repoPaths),
        ),
      );

      // Review each drone with feedback loop (parallel)
      const waveResults = await Promise.all(
        drones.map((drone) =>
          reviewDrone(drone, config, minds, taskGroups, bus.url, baseBranch, maxIterations, droneTimeout, standards),
        ),
      );

      // Check for failures — abort pipeline if any drone in a wave failed
      const failed = waveResults.filter((r) => !r.approved);
      if (failed.length > 0) {
        for (const f of failed) {
          console.log(`  FAILED: ${f.mind} (${f.error})`);
        }
        for (const result of waveResults) {
          await cleanupDrone(process.cwd(), result.session);
        }
        results.push({ wave: wave.id, drones: waveResults });
        console.log(`\n  Wave ${wave.id} failed — aborting pipeline`);
        break;
      }

      // All approved — merge sequentially, routing to correct repo
      for (const result of waveResults) {
        const mergeDir = resolveMergeDir(process.cwd(), result, repoPaths);
        const mergeResult = mergeBranch(
          mergeDir,
          result.session.branch!,
          result.mind,
          wave.id,
        );
        gate(mergeResult.success, `Merge failed for ${result.mind}: ${mergeResult.error}`);
        console.log(`  Merged: ${result.mind}${result.repo ? ` (${result.repo})` : ""}`);
      }

      // Clean up drones
      for (const result of waveResults) {
        await cleanupDrone(process.cwd(), result.session);
      }

      results.push({ wave: wave.id, drones: waveResults });
    }
  } finally {
    bus.stop();
  }

  const allApproved = results.every((w) =>
    w.drones.every((d) => d.approved),
  );

  // Generate change report if pipeline passed
  if (allApproved) {
    console.log("\n--- Generating change report ---");
    await generateReport(baseCommit, config.ticketId, config.specPath, {
      model: config.reviewModel,
    });
  }

  return { config, waves: results, approved: allApproved };
}

/** Get the current git branch name. */
function getCurrentBranch(): string {
  const result = Bun.spawnSync(["git", "branch", "--show-current"]);
  return result.stdout.toString().trim();
}

/** Get the current commit SHA. Used to anchor the report diff before merges move HEAD. */
function getCurrentCommit(): string {
  const result = Bun.spawnSync(["git", "rev-parse", "HEAD"]);
  return result.stdout.toString().trim();
}
