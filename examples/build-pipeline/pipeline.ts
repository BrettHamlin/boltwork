/**
 * Build Pipeline
 *
 * Opinionated build pipeline built on boltwork primitives.
 * Implements the full Gravitas flow: tasks → waves → parallel drones → review → merge.
 *
 * Usage:
 *   bun run pipeline.ts --ticket BRE-700 --spec specs/BRE-700/spec.md
 */

import {
  startBus,
  gate,
  spawnSession,
  waitForSignal,
  feedbackLoop,
  type SessionHandle,
} from "boltwork";

import type { PipelineConfig, Mind, TaskGroup } from "./types.ts";
import { loadRegistry, findMind } from "./lib/registry.ts";
import { loadMemory, formatMemoryForBrief, formatMemoryForReview } from "./lib/memory.ts";
import { parseTasks, formatTasksForBrief } from "./lib/tasks.ts";
import { computeWaves } from "./lib/waves.ts";
import { runChecks } from "./lib/checks.ts";
import { runReview, applyForceRejections } from "./lib/review.ts";
import { writeFeedback, loadPreviousFeedback } from "./lib/feedback.ts";
import { mergeBranch, cleanupDrone } from "./lib/merge.ts";

/**
 * Run the full build pipeline.
 */
export async function runPipeline(config: PipelineConfig): Promise<PipelineResult> {
  const maxIterations = config.maxIterations ?? 3;
  const busPort = config.busPort ?? 8080;
  const droneModel = config.droneModel ?? "sonnet";
  const droneTimeout = config.droneTimeout ?? 300_000;

  // Load inputs
  const minds = await loadRegistry(config.registryPath);
  const taskGroups = await parseTasks(
    `specs/${config.ticketId}/tasks.md`,
  );
  const waves = computeWaves(taskGroups);

  console.log(`Pipeline: ${config.ticketId}`);
  console.log(`  Minds: ${minds.map((m) => m.name).join(", ")}`);
  console.log(`  Waves: ${waves.length}`);

  // Start infrastructure
  const bus = await startBus({ port: busPort });
  const baseBranch = getCurrentBranch();
  const results: WaveResult[] = [];

  try {
    for (const wave of waves) {
      console.log(`\n--- ${wave.id}: [${wave.minds.join(", ")}] ---`);

      // Spawn drones in parallel for this wave
      const drones = await Promise.all(
        wave.minds.map((mindName) =>
          spawnDrone(mindName, config, minds, taskGroups, bus.url, droneModel),
        ),
      );

      // Review each drone with feedback loop (parallel)
      const waveResults = await Promise.all(
        drones.map((drone) =>
          reviewDrone(drone, config, minds, taskGroups, bus.url, baseBranch, maxIterations, droneTimeout),
        ),
      );

      // Merge approved drones sequentially
      for (const result of waveResults) {
        if (result.approved) {
          const mergeResult = mergeBranch(
            process.cwd(),
            result.session.branch!,
            result.mind,
            wave.id,
          );
          gate(mergeResult.success, `Merge failed for ${result.mind}: ${mergeResult.error}`);
          console.log(`  Merged: ${result.mind}`);
        } else {
          console.log(`  FAILED: ${result.mind} (${result.error})`);
        }
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

  return { config, waves: results, approved: allApproved };
}

/** Spawn a drone for a specific mind. */
async function spawnDrone(
  mindName: string,
  config: PipelineConfig,
  minds: Mind[],
  taskGroups: TaskGroup[],
  busUrl: string,
  model: string,
): Promise<DroneInfo> {
  const mind = findMind(minds, mindName);
  if (!mind) throw new Error(`Mind "${mindName}" not found in registry`);

  // Build the brief
  const taskSection = formatTasksForBrief(taskGroups, mindName);
  const memory = config.memoryDir
    ? await loadMemory(config.memoryDir, mindName)
    : "";
  const memorySection = formatMemoryForBrief(memory);

  const boundary = mind.owns.map((p) => `  - ${p}`).join("\n");

  const brief = [
    `# ${config.ticketId} — ${mind.name}`,
    "",
    taskSection,
    "",
    `## File Boundary`,
    `You may ONLY create or modify files within these paths:`,
    boundary,
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

/** Review a drone's work with the feedback loop. */
async function reviewDrone(
  drone: DroneInfo,
  config: PipelineConfig,
  minds: Mind[],
  taskGroups: TaskGroup[],
  busUrl: string,
  baseBranch: string,
  maxIterations: number,
  timeout: number,
): Promise<DroneResult> {
  const mind = findMind(minds, drone.mind)!;
  const tasks = formatTasksForBrief(taskGroups, drone.mind);
  const memoryForReview = formatMemoryForReview(drone.memory);

  try {
    await feedbackLoop({
      name: `review-${drone.mind}`,
      maxIterations,
      session: drone.session,

      async check(iteration) {
        console.log(`  [${drone.mind}] Iteration ${iteration}: waiting...`);

        await waitForSignal(drone.channel, "HOOK_Stop", {
          busUrl,
          timeout,
        });
        console.log(`  [${drone.mind}] Done — running checks`);

        // Deterministic checks
        const checks = await runChecks(
          drone.session.cwd,
          baseBranch,
          mind,
          config.testCommand,
        );

        // LLM review
        const previousFeedback = await loadPreviousFeedback(
          drone.session.cwd,
          iteration,
        );

        const verdict = await runReview({
          diff: checks.diff,
          testOutput: checks.testOutput,
          tasks,
          memory: memoryForReview || undefined,
          previousFeedback: previousFeedback || undefined,
          model: config.reviewModel,
        });

        // Force-rejections: deterministic overrides LLM
        const finalVerdict = applyForceRejections(verdict, checks);

        const status = finalVerdict.approved ? "APPROVED" : "REJECTED";
        console.log(`  [${drone.mind}] ${status} (${finalVerdict.findings.length} findings)`);

        return { verdict: finalVerdict, checks, iteration };
      },

      passed(result) {
        return result.verdict.approved;
      },

      async feedback(result) {
        // Write feedback file to worktree
        await writeFeedback(
          drone.session.cwd,
          result.iteration,
          result.verdict,
          result.checks.testOutput,
        );

        // Build the message sent to the session
        const findings = result.verdict.findings
          .map((f) => `- ${f.severity}: ${f.message}`)
          .join("\n");
        return `Your work was reviewed and needs changes:\n\n${findings}\n\nSee REVIEW-FEEDBACK-${result.iteration}.md for details. Fix these issues and commit again.`;
      },
    });

    return { mind: drone.mind, session: drone.session, approved: true };
  } catch (err) {
    return {
      mind: drone.mind,
      session: drone.session,
      approved: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Get the current git branch name. */
function getCurrentBranch(): string {
  const result = Bun.spawnSync(["git", "branch", "--show-current"]);
  return result.stdout.toString().trim();
}

// --- Internal types ---

interface DroneInfo {
  mind: string;
  session: SessionHandle;
  channel: string;
  memory: string;
}

interface DroneResult {
  mind: string;
  session: SessionHandle;
  approved: boolean;
  error?: string;
}

interface WaveResult {
  wave: string;
  drones: DroneResult[];
}

export interface PipelineResult {
  config: PipelineConfig;
  waves: WaveResult[];
  approved: boolean;
}
