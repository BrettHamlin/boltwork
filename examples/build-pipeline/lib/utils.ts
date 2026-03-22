/**
 * Utils
 *
 * Shared utilities used across the build pipeline.
 * Each function solves one small, common problem.
 */

/**
 * Simple glob matching for file paths.
 * `**` matches any number of path segments, `*` matches within one segment.
 */
export function matchesGlob(filePath: string, pattern: string): boolean {
  const regex = pattern
    .replace(/\*\*/g, "___DOUBLESTAR___")
    .replace(/\*/g, "[^/]*")
    .replace(/___DOUBLESTAR___/g, ".*");
  return new RegExp(`^${regex}$`).test(filePath);
}

/**
 * Strip the @ prefix from a mind name.
 * Idempotent — safe to call on names with or without @.
 */
export function normalizeMindName(name: string): string {
  return name.replace(/^@/, "");
}

/**
 * Extract JSON from LLM output that may be wrapped in prose or code fences.
 * Handles: raw JSON, ```json fenced, prose + fenced, trailing explanation.
 */
export function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*\n([\s\S]*?)\n\s*```/);
  if (fenced) return fenced[1]!.trim();
  const braceStart = raw.indexOf("{");
  const braceEnd = raw.lastIndexOf("}");
  if (braceStart !== -1 && braceEnd > braceStart) {
    return raw.slice(braceStart, braceEnd + 1);
  }
  return raw.trim();
}

/**
 * Escape a string for use in a RegExp.
 */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
