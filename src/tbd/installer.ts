/**
 * Primitive: Installer / Scaffold
 *
 * Copy infrastructure files into a target project.
 * Idempotent — safe to re-run.
 * Never overwrites paths marked as preserved (project-specific data).
 */

import { readFile, writeFile, mkdir, access } from "fs/promises";
import { dirname } from "path";
import { InstallerError } from "../errors.ts";

export interface InstallManifest {
  /** Files to install. Key = destination path, value = source path or content string. */
  files: Record<string, string>;
  /** Paths to never overwrite, even if source is newer. */
  preserve?: string[];
}

/**
 * Install files from a manifest. Skips preserved paths that already exist.
 *
 * ```ts
 * await install({
 *   files: {
 *     ".pipeline/review.ts": reviewStageSource,
 *     ".pipeline/gate.ts": gateStageSource,
 *     "tests/e2e/registry.json": "[]",
 *   },
 *   preserve: [
 *     "tests/e2e/registry.json",  // don't overwrite existing test entries
 *     ".pipeline/memory/",        // don't touch project-specific memory
 *   ],
 * });
 * ```
 */
export async function install(manifest: InstallManifest): Promise<InstallResult> {
  const result: InstallResult = { installed: [], skipped: [], errors: [] };

  for (const [dest, content] of Object.entries(manifest.files)) {
    // Check if this path should be preserved
    if (manifest.preserve?.some((p) => dest === p || dest.startsWith(p))) {
      try {
        await access(dest);
        // File exists and is preserved — skip
        result.skipped.push(dest);
        continue;
      } catch {
        // File doesn't exist yet — safe to create even if preserved
      }
    }

    try {
      await mkdir(dirname(dest), { recursive: true });

      // If content looks like a file path, try to read it as source
      let fileContent: string;
      if (content.includes("\n") || content.length < 260) {
        // Could be inline content or a path — try as path first if it doesn't contain newlines
        if (!content.includes("\n")) {
          try {
            fileContent = await readFile(content, "utf-8");
          } catch {
            fileContent = content; // not a valid path — treat as inline content
          }
        } else {
          fileContent = content;
        }
      } else {
        fileContent = content;
      }

      await writeFile(dest, fileContent);
      result.installed.push(dest);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push({ path: dest, error: msg });
    }
  }

  if (result.errors.length > 0) {
    throw new InstallerError(
      `Failed to install ${result.errors.length} file(s): ${result.errors.map((e) => e.path).join(", ")}`,
    );
  }

  return result;
}

export interface InstallResult {
  installed: string[];
  skipped: string[];
  errors: Array<{ path: string; error: string }>;
}
