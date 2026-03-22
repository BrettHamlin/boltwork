/**
 * Review Loop
 *
 * Orchestrate the feedback loop for a single drone: wait for completion,
 * run checks, LLM review, force-rejections, send feedback, retry.
 * One responsibility: take a running drone and iterate until approved or max.
 */

import { waitForSignal, feedbackLoop, MaxIterationsExceeded } from "boltwork";
import type { PipelineConfig, Mind, TaskGroup, DroneInfo, DroneResult } from "../types.ts";
import { findMind } from "./registry.ts";
import { formatTasksForBrief } from "./tasks.ts";
import { formatMemoryForReview } from "./memory.ts";
import { runChecks } from "./checks.ts";
import { runReview, applyForceRejections } from "./review.ts";
import { writeFeedback, loadPreviousFeedback } from "./feedback.ts";

/**
 * Review a drone's work with the feedback loop.
 * Returns approved/failed result.
 */
export async function reviewDrone(
  drone: DroneInfo,
  config: PipelineConfig,
  minds: Mind[],
  taskGroups: TaskGroup[],
  busUrl: string,
  baseBranch: string,
  maxIterations: number,
  timeout: number,
  standards: string,
): Promise<DroneResult> {
  const mind = findMind(minds, drone.mind)!;
  const tasks = formatTasksForBrief(taskGroups, drone.mind);
  const memoryForReview = formatMemoryForReview(drone.memory);

  // Track last check results for approve-with-warnings decision
  const state = { lastTestsPass: true, lastBoundaryPass: true };

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
          config.neverModify,
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
          standards: standards || undefined,
          memory: memoryForReview || undefined,
          previousFeedback: previousFeedback || undefined,
          model: config.reviewModel,
        });

        // Force-rejections: deterministic overrides LLM
        const finalVerdict = applyForceRejections(verdict, checks);

        const status = finalVerdict.approved ? "APPROVED" : "REJECTED";
        console.log(`  [${drone.mind}] ${status} (${finalVerdict.findings.length} findings)`);

        // Log findings for debugging
        if (finalVerdict.findings.length > 0) {
          for (const f of finalVerdict.findings) {
            const loc = f.file ? ` (${f.file}${f.line ? `:${f.line}` : ""})` : "";
            console.log(`    ${f.severity}: ${f.message}${loc}`);
          }
        }

        if (!checks.testsPass) {
          console.log(`    [tests FAILED] ${checks.testOutput.slice(-200)}`);
        }

        // Track for approve-with-warnings
        state.lastTestsPass = checks.testsPass;
        state.lastBoundaryPass = checks.boundaryPass;

        return { verdict: finalVerdict, checks, iteration };
      },

      passed(result) {
        return result.verdict.approved;
      },

      async feedback(result) {
        await writeFeedback(
          drone.session.cwd,
          result.iteration,
          result.verdict,
          result.checks.testOutput,
        );

        // Exponential backoff: 5s → 15s → 45s (capped at 60s)
        const backoff = Math.min(5_000 * Math.pow(3, result.iteration - 1), 60_000);
        console.log(`  [${drone.mind}] Backoff ${backoff / 1000}s before sending feedback`);
        await Bun.sleep(backoff);

        const findings = result.verdict.findings
          .map((f) => `- ${f.severity}: ${f.message}`)
          .join("\n");
        return `Your work was reviewed and needs changes:\n\n${findings}\n\nSee REVIEW-FEEDBACK-${result.iteration}.md for details. Fix these issues and commit again.`;
      },
    });

    return { mind: drone.mind, session: drone.session, approved: true };
  } catch (err) {
    if (err instanceof MaxIterationsExceeded) {
      if (state.lastTestsPass && state.lastBoundaryPass) {
        console.log(`  [${drone.mind}] Max iterations — approving with warnings (soft failures only)`);
        return { mind: drone.mind, session: drone.session, approved: true };
      }
      return {
        mind: drone.mind,
        session: drone.session,
        approved: false,
        error: `Max iterations with hard failures: ${err.message}`,
      };
    }
    return {
      mind: drone.mind,
      session: drone.session,
      approved: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
