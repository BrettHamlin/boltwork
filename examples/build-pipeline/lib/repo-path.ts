/**
 * Repo-Qualified Path Utilities
 *
 * Pure string functions for parsing and formatting paths with optional
 * repo alias prefixes (e.g., "api:src/routes/**").
 *
 * No filesystem access — all operations are string-based.
 */

// ---- Types ----

export interface ParsedRepoPath {
  repo: string | undefined;
  path: string;
}

// ---- Functions ----

/**
 * Parse a repo-qualified path into its components.
 * "api:src/routes/**" -> { repo: "api", path: "src/routes/**" }
 * "src/routes/**"     -> { repo: undefined, path: "src/routes/**" }
 */
export function parseRepoPath(qualifiedPath: string): ParsedRepoPath {
  const colonIdx = qualifiedPath.indexOf(":");
  if (colonIdx === -1) {
    return { repo: undefined, path: qualifiedPath };
  }

  const repo = qualifiedPath.slice(0, colonIdx);
  const path = qualifiedPath.slice(colonIdx + 1);

  // Empty alias means no repo prefix (e.g., ":src/api" is a bare path)
  if (repo.length === 0) {
    return { repo: undefined, path };
  }

  return { repo, path };
}

/**
 * Format a repo alias and path back into a qualified path string.
 * ("api", "src/routes/**") -> "api:src/routes/**"
 * (undefined, "src/routes/**") -> "src/routes/**"
 */
export function formatRepoPath(repo: string | undefined, path: string): string {
  return repo ? `${repo}:${path}` : path;
}

/**
 * Strip the repo prefix, returning just the path portion.
 * "api:src/routes/**" -> "src/routes/**"
 * "src/routes/**"     -> "src/routes/**"
 */
export function stripRepoPrefix(qualifiedPath: string): string {
  return parseRepoPath(qualifiedPath).path;
}

/**
 * Get the repo alias from a qualified path, or undefined for bare paths.
 * "api:src/routes/**" -> "api"
 * "src/routes/**"     -> undefined
 */
export function getRepoAlias(qualifiedPath: string): string | undefined {
  return parseRepoPath(qualifiedPath).repo;
}
