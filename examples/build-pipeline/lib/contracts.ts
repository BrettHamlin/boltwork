/**
 * Contracts
 *
 * Deterministic contract verification for inter-mind dependencies.
 * Parses `produces:` and `consumes:` annotations from task descriptions,
 * then verifies the actual source files match the contract.
 *
 * Ported from Gravitas minds/lib/check-contracts-core.ts — single-repo only.
 */

import { existsSync, readFileSync, readdirSync } from "fs";
import { resolve } from "path";
import type { Finding } from "../types.ts";
import { escapeRegExp } from "./utils.ts";

// ── Types ──────────────────────────────────────────────────────────────────

export interface ContractAnnotation {
  type: "produces" | "consumes";
  /** The symbol name (e.g., "getRecentRequests" or "MindsBusMessage") */
  name: string;
  /** The file path (e.g., "packages/core/index.ts") */
  filePath: string;
  /** The task ID (e.g., "T001") */
  taskId: string;
}

// ── Parse annotations from task descriptions ────────────────────────────────

/**
 * Extract produces/consumes annotations from tasks.md content for a given mind.
 *
 * Format:
 *   - [ ] T001 @server-core Add getRecentRequests (produces: getRecentRequests at packages/core/index.ts)
 *   - [ ] T003 @config-module Import getRecentRequests (consumes: getRecentRequests from packages/core/index.ts)
 */
export function parseAnnotations(tasksText: string, mindName: string): ContractAnnotation[] {
  const annotations: ContractAnnotation[] = [];
  const lines = tasksText.split("\n");

  for (const line of lines) {
    // Only process task lines for this mind
    const taskMatch = line.match(/^-\s*\[.\]\s*(T\d+)\s+@([\w-]+)/);
    if (!taskMatch) continue;

    const [, taskId, taskMind] = taskMatch;
    if (taskMind !== mindName) continue;

    // Parse produces: annotations — handle both backticked and non-backticked forms
    const producesMatch = line.match(/produces:\s*`([^`]+)`\s+at\s+(\S+)/)
      ?? line.match(/produces:\s+(.+?)\s+at\s+(\S+)/);
    if (producesMatch) {
      annotations.push({
        type: "produces",
        name: producesMatch[1]!.replace(/[()]/g, "").replace(/^`+|`+$/g, ""),
        filePath: producesMatch[2]!,
        taskId: taskId!,
      });
    }

    // Parse consumes: annotations — handle both backticked and non-backticked forms
    const consumesMatch = line.match(/consumes:\s*`([^`]+)`\s+from\s+(\S+)/)
      ?? line.match(/consumes:\s+(.+?)\s+from\s+(\S+)/);
    if (consumesMatch) {
      annotations.push({
        type: "consumes",
        name: consumesMatch[1]!.replace(/[()]/g, "").replace(/^`+|`+$/g, ""),
        filePath: consumesMatch[2]!,
        taskId: taskId!,
      });
    }
  }

  return annotations;
}

// ── Verify contracts ────────────────────────────────────────────────────────

/**
 * Verify contract annotations against the actual filesystem.
 * - produces: checks that the symbol is exported from the file
 * - consumes: checks that at least one file in the mind imports the symbol
 *
 * Returns findings (errors) for each violation.
 */
export function verifyContracts(
  annotations: ContractAnnotation[],
  repoRoot: string,
  mindOwns?: string[],
): Finding[] {
  const findings: Finding[] = [];

  for (const ann of annotations) {
    if (ann.type === "produces") {
      verifyProduces(ann, repoRoot, findings);
    } else {
      verifyConsumes(ann, repoRoot, mindOwns ?? [], findings);
    }
  }

  return findings;
}

// ── Internal helpers ────────────────────────────────────────────────────────

function verifyProduces(
  ann: ContractAnnotation,
  repoRoot: string,
  findings: Finding[],
): void {
  const fullPath = resolve(repoRoot, ann.filePath);
  if (!existsSync(fullPath)) {
    findings.push({
      file: ann.filePath,
      severity: "error",
      message: `[${ann.taskId}] produces: file does not exist: ${ann.filePath}`,
    });
    return;
  }

  const content = readFileSync(fullPath, "utf-8");
  if (!checkExportExists(content, ann.name)) {
    findings.push({
      file: ann.filePath,
      severity: "error",
      message: `[${ann.taskId}] produces: '${ann.name}' is NOT exported from ${ann.filePath}`,
    });
  }
}

function verifyConsumes(
  ann: ContractAnnotation,
  repoRoot: string,
  mindOwns: string[],
  findings: Finding[],
): void {
  // Collect source files from the mind's owned directories
  const tsFiles: string[] = [];
  for (const pattern of mindOwns) {
    const dirPath = resolve(repoRoot, pattern.replace(/\*+$/, "").replace(/\/+$/, ""));
    if (existsSync(dirPath)) {
      tsFiles.push(...findTsFiles(dirPath));
    }
  }

  if (tsFiles.length === 0) {
    findings.push({
      file: ann.filePath,
      severity: "error",
      message: `[${ann.taskId}] consumes: no source files found to scan for import of '${ann.name}'`,
    });
    return;
  }

  // Check that at least one file imports the symbol
  let foundImport = false;
  for (const tsFile of tsFiles) {
    if (tsFile.includes("__tests__") || tsFile.includes(".test.")) continue;
    const content = readFileSync(tsFile, "utf-8");

    const importPatterns = [
      new RegExp(`import\\s*\\{[^}]*\\b${escapeRegExp(ann.name)}\\b[^}]*\\}\\s*from`),
      new RegExp(`import\\s+type\\s*\\{[^}]*\\b${escapeRegExp(ann.name)}\\b[^}]*\\}\\s*from`),
    ];

    if (importPatterns.some((p) => p.test(content))) {
      foundImport = true;
      break;
    }
  }

  if (!foundImport) {
    findings.push({
      file: ann.filePath,
      severity: "error",
      message: `[${ann.taskId}] consumes: '${ann.name}' is not imported anywhere in the mind's source files`,
    });
  }
}

/**
 * Check whether file content exports a given symbol name.
 * Scans for all common TypeScript/JavaScript export forms.
 */
export function checkExportExists(content: string, name: string): boolean {
  // Dotted names like "Store.addNode" — verify parent is exported and member exists
  if (name.includes(".")) {
    const [parent, member] = name.split(".", 2);
    if (!checkExportExists(content, parent!)) return false;
    return new RegExp(`\\b${escapeRegExp(member!)}\\b`).test(content);
  }

  const exportPatterns = [
    new RegExp(`export\\s+(async\\s+)?function\\s+${escapeRegExp(name)}\\b`),
    new RegExp(`export\\s+const\\s+${escapeRegExp(name)}\\b`),
    new RegExp(`export\\s+type\\s+${escapeRegExp(name)}\\b`),
    new RegExp(`export\\s+interface\\s+${escapeRegExp(name)}\\b`),
    new RegExp(`export\\s+(abstract\\s+)?class\\s+${escapeRegExp(name)}\\b`),
    new RegExp(`export\\s+enum\\s+${escapeRegExp(name)}\\b`),
    new RegExp(`export\\s+(default\\s+)?(async\\s+)?function\\s+${escapeRegExp(name)}\\b`),
    new RegExp(`export\\s*(type\\s+)?\\{[^}]*\\b${escapeRegExp(name)}\\b[^}]*\\}`),
  ];
  return exportPatterns.some((p) => p.test(content));
}

function findTsFiles(dir: string): string[] {
  const results: string[] = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = resolve(dir, entry.name);
      if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== "dist") {
        results.push(...findTsFiles(fullPath));
      } else if (
        (entry.name.endsWith(".ts") || entry.name.endsWith(".js") || entry.name.endsWith(".tsx") || entry.name.endsWith(".jsx"))
        && !entry.name.endsWith(".d.ts")
      ) {
        results.push(fullPath);
      }
    }
  } catch {
    // directory doesn't exist or can't be read
  }
  return results;
}
