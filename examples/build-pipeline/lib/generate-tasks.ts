/**
 * Task Generation
 *
 * Generate tasks.md from a spec using one LLM call + deterministic assembly.
 * The LLM decides WHAT to do (which minds, what tasks). Everything else is code:
 * assembly, dependency inference, lint, auto-fix.
 *
 * Ported from Gravitas minds/cli/commands/tasks.ts
 */

import { writeFile, mkdir } from "fs/promises";
import { dirname } from "path";
import { llmCall } from "boltwork";
import type { Mind, TaskGroup } from "../types.ts";
import { parseTaskContent } from "./tasks.ts";
import { extractJson, matchesGlob, normalizeMindName, escapeRegExp } from "./utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LlmTasksResult {
  minds: Array<{
    name: string;
    isNew: boolean;
    ownsFiles?: string[];
    dependsOn: string[];
    tasks: Array<{
      description: string;
      parallel: boolean;
    }>;
  }>;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Generate tasks.md from a spec and mind registry.
 * One LLM call for creative decisions, everything else deterministic.
 */
export async function generateTasks(
  ticketId: string,
  spec: string,
  minds: Mind[],
  outputPath: string,
  options?: { model?: string; timeout?: number },
): Promise<TaskGroup[]> {
  console.log(`  Generating tasks for ${ticketId}...`);

  // ── Step 1: Ask LLM which minds and what tasks (the only LLM call) ──
  const prompt = buildTaskPrompt(ticketId, spec, minds);
  const raw = await llmCall(prompt, {
    model: options?.model ?? "sonnet",
    timeout: options?.timeout ?? 180_000,
  });

  let result: LlmTasksResult;
  try {
    result = JSON.parse(extractJson(raw));
  } catch {
    throw new Error(`Failed to parse LLM task response: ${raw.slice(0, 200)}`);
  }

  // ── Step 2: Normalize mind names ──
  for (const mind of result.minds) {
    mind.name = normalizeMindName(mind.name);
    mind.dependsOn = mind.dependsOn.map((d) => normalizeMindName(d));

    if (!mind.isNew && !minds.some((m) => m.name === `@${mind.name}` || m.name === mind.name)) {
      console.log(`  Warning: LLM referenced non-existent mind @${mind.name}. Marking as new.`);
      mind.isNew = true;
    }
  }

  // ── Step 3: Assemble tasks.md (deterministic) ──
  let content = assembleTasksMd(ticketId, result);

  // ── Step 4: Infer implicit dependencies (deterministic) ──
  content = inferImplicitDependencies(content, result, minds);

  // ── Step 5: Lint and auto-fix (deterministic) ──
  const lintErrors = lintTaskContent(content, minds);
  if (lintErrors.length > 0) {
    console.log(`  Lint found ${lintErrors.length} error(s), auto-fixing...`);
    content = autoFixLintErrors(content, lintErrors);
  }

  // ── Step 6: Write output ──
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, content);
  console.log(`  Wrote ${outputPath}`);

  // ── Step 7: Parse and return ──
  const groups = parseTaskContent(content);
  const totalTasks = groups.reduce((s, g) => s + g.tasks.length, 0);
  console.log(`  ${totalTasks} task(s) across ${groups.length} mind(s)`);

  return groups;
}

// ---------------------------------------------------------------------------
// LLM Prompt
// ---------------------------------------------------------------------------

function buildTaskPrompt(ticketId: string, spec: string, minds: Mind[]): string {
  const registrySummary = minds
    .map((m) => `  ${m.name}: domain="${m.domain}", owns=[${m.owns.join(", ")}]`)
    .join("\n");

  return `You are generating implementation tasks for ticket ${ticketId}.

## Spec

${spec}

## Available Minds (from minds.json)

${registrySummary}

## Your Job

Return a JSON object. Each mind gets high-level implementation tasks.

DO include:
- Which minds are involved (existing or new)
- What implementation work each mind needs
- Unit test tasks (the drone handles test file placement)
- Dependencies between minds (dependsOn)
- For new minds: ownsFiles declaring what directories they own
- Contract annotations for cross-mind dependencies (see below)

DO NOT include:
- File path specifications for tests
- Test framework instructions (detected automatically)

## Contract Annotations

When a task creates a new export that other minds will use, add a produces annotation:
  "description": "Add getRecentRequests function (produces: getRecentRequests at packages/core/index.ts)"

When a task imports something from another mind, add a consumes annotation:
  "description": "Import getRecentRequests (consumes: getRecentRequests from packages/core/index.ts)"

These are verified deterministically after the drone finishes — if a produces annotation says a symbol is exported from a file and it isn't, the build fails.

Return ONLY this JSON structure:
{
  "minds": [
    {
      "name": "mind-name",
      "isNew": false,
      "dependsOn": [],
      "tasks": [
        { "description": "High-level task description", "parallel": false }
      ]
    }
  ]
}

Rules:
- Each task stays within ONE mind's owns boundary
- Do NOT put specific file paths in task descriptions (EXCEPT in produces/consumes annotations)
- dependsOn lists minds whose work this mind depends on
- Use produces/consumes annotations when tasks create or import cross-mind interfaces
- Return ONLY the JSON. No explanation.`;
}

// ---------------------------------------------------------------------------
// Assembly — LLM JSON → tasks.md
// ---------------------------------------------------------------------------

function assembleTasksMd(ticketId: string, result: LlmTasksResult): string {
  const lines: string[] = [];
  lines.push(`# ${ticketId} Tasks\n`);

  let taskCounter = 0;

  for (const mind of result.minds) {
    const headerParts: string[] = [];
    if (mind.isNew && mind.ownsFiles?.length) {
      headerParts.push(`owns: ${mind.ownsFiles.join(", ")}`);
    }
    if (mind.dependsOn.length > 0) {
      headerParts.push(`depends on: ${mind.dependsOn.map((d) => `@${d}`).join(", ")}`);
    }
    const suffix = headerParts.length > 0 ? ` (${headerParts.join(", ")})` : "";
    lines.push(`## @${mind.name} Tasks${suffix}\n`);

    for (const task of mind.tasks) {
      taskCounter++;
      const id = `T${String(taskCounter).padStart(3, "0")}`;
      const pTag = task.parallel ? " [P]" : "";
      lines.push(`- [ ] ${id} @${mind.name}${pTag} ${task.description}`);
    }

    lines.push("");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------

/** Add depends on annotation to a mind's section header. */
function addDependsOnToHeader(content: string, mindName: string, depName: string): string {
  const eMind = escapeRegExp(mindName);
  const headerRe = new RegExp(`(## @${eMind} Tasks[^\\n]*)`);
  const headerMatch = content.match(headerRe);
  if (!headerMatch) return content;

  const header = headerMatch[1]!;
  if (header.includes(depName)) return content;

  if (header.includes("depends on:")) {
    return content.replace(header, header.replace(/depends on:([^)]+)/, `depends on:$1, @${depName}`));
  } else if (header.includes("(")) {
    return content.replace(header, header.replace(/\)\s*$/, `, depends on: @${depName})`));
  } else {
    return content.replace(header, `${header} (depends on: @${depName})`);
  }
}

/** Infer implicit dependencies from file paths in task descriptions. */
function inferImplicitDependencies(
  content: string,
  result: LlmTasksResult,
  minds: Mind[],
): string {
  let fixed = content;

  for (const mind of result.minds) {
    const allDescs = mind.tasks.map((t) => t.description).join(" ");
    const pathRe = /\b([a-zA-Z_.][\w.\-]*(?:\/[a-zA-Z_][\w.\-]*)+)\b/g;
    let pathMatch;
    const implicitDeps = new Set<string>();

    while ((pathMatch = pathRe.exec(allDescs)) !== null) {
      const path = pathMatch[1]!;
      for (const regMind of minds) {
        const regName = normalizeMindName(regMind.name);
        if (regName === mind.name) continue;
        if (regMind.owns.some((pattern) => matchesGlob(path, pattern))) {
          implicitDeps.add(regName);
          break;
        }
      }
    }

    for (const dep of implicitDeps) {
      if (!mind.dependsOn.includes(dep)) {
        fixed = addDependsOnToHeader(fixed, mind.name, dep);
      }
    }
  }

  return fixed;
}


// ---------------------------------------------------------------------------
// Lint + auto-fix
// ---------------------------------------------------------------------------

interface LintError {
  type: string;
  task: string;
  message: string;
}

/** Lint tasks.md for common issues. */
function lintTaskContent(content: string, minds: Mind[]): LintError[] {
  const errors: LintError[] = [];
  const lines = content.split("\n");

  for (const line of lines) {
    const taskMatch = line.match(/^- \[ \] (T\d+) (@[\w-]+)/);
    if (!taskMatch) continue;

    const [, taskId, mindRef] = taskMatch;

    // Check: mind exists in registry
    const mindName = normalizeMindName(mindRef!);
    if (!minds.some((m) => m.name === `@${mindName}` || m.name === mindName)) {
      errors.push({
        type: "unknown_mind",
        task: taskId!,
        message: `Task ${taskId} references unknown mind ${mindRef}`,
      });
    }
  }

  return errors;
}

/** Auto-fix lint errors. */
function autoFixLintErrors(content: string, errors: LintError[]): string {
  let fixed = content;

  for (const err of errors) {
    if (err.type === "implicit_cross_mind_dep") {
      const depMatch = err.message.match(/@(\w[\w-]*)\) references.*owned by @(\w[\w-]*)/);
      if (depMatch) {
        fixed = addDependsOnToHeader(fixed, depMatch[1]!, depMatch[2]!);
      }
    }
  }

  return fixed;
}
