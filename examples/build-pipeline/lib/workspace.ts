/**
 * Workspace Loading
 *
 * Find and load minds-workspace.json, resolve repo paths to absolute.
 * Single-repo fallback when no workspace manifest exists.
 *
 * Search order:
 * 1. MINDS_WORKSPACE env var (explicit path)
 * 2. <startDir>/minds-workspace.json
 * 3. <startDir>/../minds-workspace.json
 */

import { existsSync, readFileSync } from "fs";
import { dirname, resolve } from "path";
import type { WorkspaceManifest, WorkspaceRepo } from "../types.ts";

const MANIFEST_FILENAME = "minds-workspace.json";

/** Alias must be alphanumeric, hyphens, or underscores. */
const ALIAS_PATTERN = /^[\w-]+$/;

// ---- Types ----

export interface ResolvedWorkspace {
  manifest: WorkspaceManifest | null;
  /** Alias -> absolute path */
  repoPaths: Map<string, string>;
  /** Absolute path to the orchestrator repo */
  orchestratorRoot: string;
  isMultiRepo: boolean;
}

// ---- Loader ----

/**
 * Load and resolve the workspace manifest.
 * Returns a single-repo fallback when no manifest is found.
 */
export function loadWorkspace(startDir: string): ResolvedWorkspace {
  const manifestPath = findManifest(startDir);

  if (!manifestPath) {
    return {
      manifest: null,
      repoPaths: new Map(),
      orchestratorRoot: startDir,
      isMultiRepo: false,
    };
  }

  // Parse
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(manifestPath, "utf-8"));
  } catch (err) {
    throw new Error(
      `Failed to parse ${manifestPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Validate
  const errors = validateManifest(raw);
  if (errors.length > 0) {
    throw new Error(
      `Invalid workspace manifest at ${manifestPath}:\n  - ${errors.join("\n  - ")}`,
    );
  }

  const manifest = raw as WorkspaceManifest;
  const manifestDir = dirname(manifestPath);

  // Resolve repo paths to absolute
  const repoPaths = resolveRepoPaths(manifest, manifestDir);

  const orchestratorRoot = repoPaths.get(manifest.orchestratorRepo)!;

  return {
    manifest,
    repoPaths,
    orchestratorRoot,
    isMultiRepo: manifest.repos.length > 1,
  };
}

/**
 * Resolve relative repo paths in the manifest to absolute filesystem paths.
 * Validates that each path exists and is a git repo.
 */
export function resolveRepoPaths(
  manifest: WorkspaceManifest,
  manifestDir: string,
): Map<string, string> {
  const repoPaths = new Map<string, string>();

  for (const repo of manifest.repos) {
    const resolved = resolve(manifestDir, repo.path);

    if (!existsSync(resolved)) {
      throw new Error(`Repo "${repo.alias}" path does not exist: ${resolved}`);
    }

    if (!isGitRepo(resolved)) {
      throw new Error(`Repo "${repo.alias}" at ${resolved} is not a git repository`);
    }

    repoPaths.set(repo.alias, resolved);
  }

  return repoPaths;
}

// ---- Manifest Discovery ----

function findManifest(startDir: string): string | null {
  // 1. Env var override
  const envPath = process.env.MINDS_WORKSPACE;
  if (envPath) {
    const resolved = resolve(envPath);
    if (existsSync(resolved)) return resolved;
    throw new Error(`MINDS_WORKSPACE env var points to non-existent file: ${resolved}`);
  }

  // 2. In startDir
  const inRoot = resolve(startDir, MANIFEST_FILENAME);
  if (existsSync(inRoot)) return inRoot;

  // 3. One level up
  const inParent = resolve(startDir, "..", MANIFEST_FILENAME);
  if (existsSync(inParent)) return inParent;

  return null;
}

// ---- Validation ----

function validateManifest(value: unknown): string[] {
  const errors: string[] = [];

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return ["Manifest must be a JSON object"];
  }

  const obj = value as Record<string, unknown>;

  if (obj.version !== 1) {
    errors.push(`"version" must be 1, got ${JSON.stringify(obj.version)}`);
  }

  if (typeof obj.orchestratorRepo !== "string" || obj.orchestratorRepo.length === 0) {
    errors.push(`"orchestratorRepo" must be a non-empty string`);
  }

  if (!Array.isArray(obj.repos) || obj.repos.length === 0) {
    errors.push(`"repos" must be a non-empty array`);
    return errors;
  }

  const seenAliases = new Set<string>();
  let orchestratorFound = false;

  for (let i = 0; i < obj.repos.length; i++) {
    const repo = obj.repos[i];
    if (typeof repo !== "object" || repo === null || Array.isArray(repo)) {
      errors.push(`repos[${i}] must be an object`);
      continue;
    }

    const r = repo as Record<string, unknown>;

    if (typeof r.alias !== "string" || r.alias.length === 0) {
      errors.push(`repos[${i}].alias must be a non-empty string`);
    } else if (!ALIAS_PATTERN.test(r.alias)) {
      errors.push(`repos[${i}].alias "${r.alias}" has invalid characters`);
    } else if (seenAliases.has(r.alias)) {
      errors.push(`Duplicate alias "${r.alias}"`);
    } else {
      seenAliases.add(r.alias);
      if (r.alias === obj.orchestratorRepo) orchestratorFound = true;
    }

    if (typeof r.path !== "string" || r.path.length === 0) {
      errors.push(`repos[${i}].path must be a non-empty string`);
    } else if ((r.path as string).includes("..")) {
      errors.push(`Repo "${r.alias}" path contains ".." — path traversal not allowed`);
    }

    if (r.testCommand !== undefined && typeof r.testCommand !== "string") {
      errors.push(`repos[${i}].testCommand must be a string`);
    }
  }

  if (typeof obj.orchestratorRepo === "string" && obj.orchestratorRepo.length > 0 && !orchestratorFound) {
    errors.push(`"orchestratorRepo" value "${obj.orchestratorRepo}" does not match any repo alias`);
  }

  return errors;
}

// ---- Helpers ----

function isGitRepo(dirPath: string): boolean {
  const result = Bun.spawnSync(
    ["git", "-C", dirPath, "rev-parse", "--is-inside-work-tree"],
    { stdout: "pipe", stderr: "pipe" },
  );
  return result.exitCode === 0;
}
