/**
 * Report
 *
 * Generate a post-pipeline change report.
 * The LLM produces structured JSON mapping spec criteria to code evidence.
 * The HTML template renders it as an interactive report with expandable diffs.
 */

import { llmCall } from "boltwork";
import { readFile, writeFile } from "fs/promises";
import { resolve, dirname } from "path";
import { extractJson } from "./utils.ts";

export interface ReportOptions {
  model?: string;
  outputPath?: string;
  open?: boolean;
}

export interface ReportData {
  ticketId: string;
  summary: string;
  stats: { files: number; added: number; removed: number; created: number; modified: number };
  criteria: Array<{
    requirement: string;
    status: "pass" | "partial" | "missing";
    evidence: Array<{
      file: string;
      diff: string;
      explanation: string;
    }>;
  }>;
  flow: string; // Mermaid diagram
  notes: string[];
}

/**
 * Generate a change report, render as interactive HTML, and open in browser.
 */
export async function generateReport(
  baseBranch: string,
  ticketId: string,
  specPath: string,
  options?: ReportOptions,
): Promise<ReportData> {
  const spec = await Bun.file(specPath).text();
  const stat = Bun.spawnSync(["git", "diff", "--stat", `${baseBranch}..HEAD`]);
  const diff = Bun.spawnSync(["git", "diff", `${baseBranch}..HEAD`]);
  const nameOnly = Bun.spawnSync(["git", "diff", "--name-only", `${baseBranch}..HEAD`]);

  const diffText = diff.stdout.toString();
  const statText = stat.stdout.toString();
  const filesText = nameOnly.stdout.toString();

  // Parse stats from git output
  const statsMatch = statText.match(/(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/);
  const filesList = filesText.trim().split("\n").filter(Boolean);
  const stats = {
    files: statsMatch ? parseInt(statsMatch[1]!) : filesList.length,
    added: statsMatch?.[2] ? parseInt(statsMatch[2]) : 0,
    removed: statsMatch?.[3] ? parseInt(statsMatch[3]) : 0,
    created: 0,
    modified: 0,
  };

  // Detect created vs modified from diff
  for (const file of filesList) {
    const isNew = diffText.includes(`--- /dev/null\n+++ b/${file}`);
    if (isNew) stats.created++;
    else stats.modified++;
  }

  // Ask LLM for structured analysis
  const prompt = buildPrompt(ticketId, spec, diffText, filesList);
  const raw = await llmCall(prompt, {
    model: options?.model ?? "sonnet",
    timeout: 300_000,
  });

  let parsed: Omit<ReportData, "ticketId" | "stats">;
  try {
    parsed = JSON.parse(extractJson(raw));
  } catch {
    throw new Error(`Failed to parse report JSON: ${raw.slice(0, 300)}`);
  }

  const data: ReportData = { ticketId, stats, ...parsed };

  // Render HTML
  const templatePath = resolve(dirname(import.meta.path), "report-template.html");
  const template = await readFile(templatePath, "utf-8");
  const html = template
    .replace("{{TICKET_ID}}", ticketId)
    .replace("{{REPORT_DATA}}", JSON.stringify(data))
    .replace("{{TIMESTAMP}}", new Date().toLocaleString());

  const outputPath = options?.outputPath ?? `/tmp/boltwork-report-${ticketId}.html`;
  await writeFile(outputPath, html);

  if (options?.open !== false) {
    Bun.spawnSync(["open", outputPath]);
  }

  console.log(`  Report: ${outputPath}`);
  return data;
}

function buildPrompt(ticketId: string, spec: string, diff: string, files: string[]): string {
  return `You are generating a structured change report for ticket ${ticketId}.

## Spec (what was requested)
${spec}

## Files changed
${files.join("\n")}

## Full diff
${diff.slice(0, 40_000)}

## Your task

Map each acceptance criterion from the spec to the actual code that implements it.
For each criterion, extract the SPECIFIC diff hunks (just the relevant lines, not the whole file) that serve as evidence.

Also generate a Mermaid flowchart (graph TD) showing how the new code connects.
- NEW nodes: style with fill:#12261e,stroke:#3fb950,color:#3fb950
- MODIFIED nodes: style with fill:#2d1f0e,stroke:#d29922,color:#d29922
- 5-10 nodes max, show data flow
- IMPORTANT: Node labels must be simple text only — NO colons, brackets, parentheses, or special characters in labels. Use simple names like "logStore" not "logStore: RequestLogEntry[]". Use hyphens instead of spaces in labels.
- Use square brackets for node shapes: A[simple-label]
- Edge labels use |text| syntax: A -->|calls| B

Return ONLY this JSON (no markdown, no backticks wrapping it):

{
  "summary": "2-3 sentence plain English summary of what was built",
  "criteria": [
    {
      "requirement": "the spec requirement in plain English",
      "status": "pass" or "partial" or "missing",
      "evidence": [
        {
          "file": "path/to/file.ts",
          "diff": "the relevant diff lines (include + and - prefixes, keep it short — just the key lines, max 15 lines per evidence block)",
          "explanation": "one sentence explaining how this code satisfies the requirement"
        }
      ]
    }
  ],
  "flow": "graph TD\\n    A[Node] --> B[Node]\\n    style A fill:#12261e,stroke:#3fb950,color:#3fb950",
  "notes": [
    "plain English observation for the reviewer (not a critique, just something to be aware of)"
  ]
}

Rules:
- Extract requirements from the spec's acceptance criteria section
- Each criterion maps to 1-3 evidence blocks showing the actual diff
- Keep diff snippets SHORT — just the lines that prove the requirement is met
- The flow diagram should use actual module/function names from the code
- Notes are observations, not suggestions`;
}
