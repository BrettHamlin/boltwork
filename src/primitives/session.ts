/**
 * Primitive: Spawn Session
 *
 * Starts an isolated Claude Code session in a tmux pane.
 * Optionally creates a git worktree for branch isolation.
 * Optionally wires a Stop hook to publish a signal when the session ends.
 * Returns a handle for monitoring, feedback, and lifecycle.
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { SessionSpawnError } from "../errors.ts";

export interface SpawnOptions {
  /** Instructions/brief for the session — passed as the initial prompt. */
  brief: string;
  /** Create a git worktree for isolation. Default: false */
  worktree?: boolean;
  /** Branch name for the worktree. Auto-generated if not provided. */
  branch?: string;
  /** Working directory. Default: process.cwd() */
  cwd?: string;
  /** Model to use. Default: "sonnet" */
  model?: string;
  /** Files to write before launching. Relative paths resolved from cwd. */
  files?: Record<string, string>;
  /** Skip permission prompts. Default: true */
  skipPermissions?: boolean;
  /**
   * If set, wires a Claude Code Stop hook that publishes a signal
   * to this channel when the session finishes. The signal type is "HOOK_Stop".
   * Requires the bus to be running.
   */
  signalChannel?: string;
  /** Bus URL for the Stop hook signal. Default: http://localhost:8080 */
  busUrl?: string;
}

export interface SessionHandle {
  /** Unique session identifier */
  id: string;
  /** tmux pane ID (e.g., %42) */
  paneId: string;
  /** Working directory of the session */
  cwd: string;
  /** Branch name, if worktree was created */
  branch?: string;
  /** Check if the tmux pane is still alive */
  alive(): Promise<boolean>;
  /** Send a message into the running session via tmux send-keys */
  sendFeedback(message: string): Promise<void>;
  /** Kill the tmux pane */
  kill(): Promise<void>;
  /** Remove the git worktree and branch. No-op if no worktree was created. */
  cleanupWorktree(): Promise<void>;
}

let counter = 0;

/**
 * Spawn a new Claude Code session in a tmux pane.
 *
 * ```ts
 * const drone = await spawnSession({
 *   brief: "Implement the login page. Run tests when done.",
 *   worktree: true,
 *   branch: "feat/login",
 *   signalChannel: "ticket-123",  // wires Stop hook → bus signal
 * });
 *
 * // Wait for the drone to signal completion:
 * const event = await waitForSignal("ticket-123", "HOOK_Stop");
 *
 * // Send feedback to the same session (preserves context):
 * await drone.sendFeedback("Tests failed on line 42. Fix the null check.");
 *
 * // Clean up worktree when done:
 * await drone.cleanupWorktree();
 * ```
 */
export async function spawnSession(options: SpawnOptions): Promise<SessionHandle> {
  const id = `bw-${++counter}-${Date.now()}`;
  const originalCwd = options.cwd ?? process.cwd();
  let cwd = originalCwd;
  let worktreeBranch: string | undefined;

  // Create worktree if requested
  if (options.worktree) {
    worktreeBranch = options.branch ?? `boltwork/${id}`;
    const worktreePath = `${originalCwd}/../${worktreeBranch.replace(/\//g, "-")}`;

    const result = Bun.spawnSync(
      ["git", "worktree", "add", "-b", worktreeBranch, worktreePath],
      { cwd: originalCwd },
    );
    if (result.exitCode !== 0) {
      throw new SessionSpawnError(
        `Failed to create worktree: ${result.stderr.toString().trim()}`,
      );
    }
    cwd = worktreePath;
  }

  // Wire Stop hook if signalChannel is provided
  if (options.signalChannel) {
    const busUrl = options.busUrl ?? "http://localhost:8080";
    const hookCommand = `curl -s -X POST ${busUrl}/publish -H 'Content-Type: application/json' -d '{"channel":"${options.signalChannel}","type":"HOOK_Stop","payload":{"source":"${id}"}}'`;

    writeSettingsHook(cwd, hookCommand);
  }

  // Write pre-session files
  if (options.files) {
    for (const [relativePath, content] of Object.entries(options.files)) {
      const fullPath = relativePath.startsWith("/")
        ? relativePath
        : `${cwd}/${relativePath}`;
      mkdirSync(dirname(fullPath), { recursive: true });
      writeFileSync(fullPath, content);
    }
  }

  // Split a new tmux pane
  const split = Bun.spawnSync([
    "tmux", "split-window", "-h", "-d", "-P", "-F", "#{pane_id}", "-c", cwd,
  ]);
  if (split.exitCode !== 0) {
    throw new SessionSpawnError(
      `Failed to create tmux pane: ${split.stderr.toString().trim()}`,
    );
  }
  const paneId = split.stdout.toString().trim();

  // Write the brief to a file — avoids shell escaping issues with long briefs
  const briefPath = join(cwd, "BOLTWORK-BRIEF.md");
  writeFileSync(briefPath, options.brief);

  // Build and send the claude command — reads brief from file
  const model = options.model ?? "sonnet";
  const skipPerms = options.skipPermissions !== false;

  let cmd = `claude --model ${model}`;
  if (skipPerms) cmd += " --dangerously-skip-permissions";
  cmd += ` 'Read BOLTWORK-BRIEF.md and complete all tasks described in it. When done, commit your changes.'`;

  Bun.spawnSync(["tmux", "send-keys", "-t", paneId, cmd, "Enter"]);

  const worktreeCwd = cwd;

  return {
    id,
    paneId,
    cwd,
    branch: worktreeBranch,

    async alive() {
      const check = Bun.spawnSync([
        "tmux", "display-message", "-t", paneId, "-p", "#{pane_pid}",
      ]);
      return check.exitCode === 0 && check.stdout.toString().trim() !== "";
    },

    async sendFeedback(message: string) {
      const escaped = message.replace(/'/g, "'\\''");
      Bun.spawnSync(["tmux", "send-keys", "-t", paneId, escaped, "Enter"]);
    },

    async kill() {
      Bun.spawnSync(["tmux", "kill-pane", "-t", paneId]);
    },

    async cleanupWorktree() {
      if (!worktreeBranch) return;

      // Remove the worktree
      Bun.spawnSync(
        ["git", "worktree", "remove", "--force", worktreeCwd],
        { cwd: originalCwd },
      );

      // Delete the branch
      Bun.spawnSync(
        ["git", "branch", "-D", worktreeBranch],
        { cwd: originalCwd },
      );
    },
  };
}

/**
 * Write a Stop hook into the session's .claude/settings.local.json.
 * Uses the Claude Code hooks format: matcher + hooks array.
 * See: https://code.claude.com/docs/en/hooks
 * Merges with existing settings if present.
 */
function writeSettingsHook(sessionCwd: string, hookCommand: string): void {
  const settingsDir = join(sessionCwd, ".claude");
  const settingsPath = join(settingsDir, "settings.local.json");

  mkdirSync(settingsDir, { recursive: true });

  let settings: Record<string, unknown> = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    } catch {
      // malformed file — overwrite
    }
  }

  // Claude Code hooks format:
  // { "hooks": { "Stop": [{ "matcher": "", "hooks": [{ "type": "command", "command": "..." }] }] } }
  const hooks = (settings.hooks ?? {}) as Record<string, unknown>;
  const stopEntries = Array.isArray(hooks.Stop) ? hooks.Stop : [];

  // Don't add duplicate
  const alreadyWired = stopEntries.some(
    (entry: any) =>
      Array.isArray(entry?.hooks) &&
      entry.hooks.some((h: any) => h.command?.includes("boltwork")),
  );

  if (!alreadyWired) {
    stopEntries.push({
      matcher: "",
      hooks: [{ type: "command", command: hookCommand }],
    });
  }

  hooks.Stop = stopEntries;
  settings.hooks = hooks;

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}
