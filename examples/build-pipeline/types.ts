/**
 * Shared types for the build pipeline.
 */

/** A domain partition of the codebase. */
export interface Mind {
  /** Unique name (e.g., "@auth", "@api") */
  name: string;
  /** What this mind is responsible for */
  domain: string;
  /** Glob patterns for files this mind owns */
  owns: string[];
  /** Pipeline template name. Default: "code" */
  pipeline?: string;
  /** Whether this mind can modify infra files (package.json, etc.) */
  infraAllowed?: boolean;
  /** Repo alias this mind belongs to (set by multi-repo registry loader) */
  repo?: string;
}

/** A repo entry in the workspace manifest. */
export interface WorkspaceRepo {
  alias: string;
  path: string;
  testCommand?: string;
}

/** The minds-workspace.json manifest format. */
export interface WorkspaceManifest {
  version: 1;
  orchestratorRepo: string;
  repos: WorkspaceRepo[];
}

/** A task assigned to a specific mind. */
export interface Task {
  /** Task ID (e.g., "T001") */
  id: string;
  /** Which mind owns this task */
  mind: string;
  /** What to do */
  description: string;
  /** Can run in parallel with other tasks in the same mind */
  parallel?: boolean;
  /** Depends on tasks from other minds */
  dependsOn?: string[];
}

/** A group of tasks for one mind. */
export interface TaskGroup {
  mind: string;
  tasks: Task[];
  /** Minds this group depends on (all their tasks must complete first) */
  dependsOn: string[];
}

/** A wave of minds that can execute in parallel. */
export interface Wave {
  id: string;
  minds: string[];
}

/** Result of running checks on a drone's work. */
export interface CheckResults {
  /** Git diff of the drone's changes */
  diff: string;
  /** Whether scoped tests passed */
  testsPass: boolean;
  /** Test output (stdout + stderr) */
  testOutput: string;
  /** Whether all modified files are within the mind's boundary */
  boundaryPass: boolean;
  /** Specific boundary violations */
  boundaryFindings: Finding[];
  /** Whether contract annotations (produces/consumes) are satisfied */
  contractsPass: boolean;
  /** Contract violation findings */
  contractFindings: Finding[];
}

/** A single finding from a review or check. */
export interface Finding {
  file?: string;
  line?: number;
  severity: "error" | "warning";
  message: string;
  suggestion?: string;
}

/** The LLM review verdict. */
export interface ReviewVerdict {
  approved: boolean;
  findings: Finding[];
}

/** Configuration for a pipeline run. */
export interface PipelineConfig {
  /** Ticket ID (e.g., "BRE-702") */
  ticketId: string;
  /** Path to the spec file */
  specPath: string;
  /** Path to the mind registry (minds.json) */
  registryPath: string;
  /** Path to the memory directory */
  memoryDir?: string;
  /** Test command (e.g., "bun test") */
  testCommand: string;
  /** Max review iterations per drone. Default: 3 */
  maxIterations?: number;
  /** Bus port. Default: 8080 */
  busPort?: number;
  /** Model for drone sessions. Default: "sonnet" */
  droneModel?: string;
  /** Model for LLM review. Default: "sonnet" */
  reviewModel?: string;
  /** Drone timeout in ms. Default: 300_000 (5 min) */
  droneTimeout?: number;
  /** Path to pre-existing tasks.md. If not set, tasks are auto-generated from spec. */
  tasksPath?: string;
  /** Model for task generation LLM call. Default: "sonnet" */
  taskModel?: string;
  /** Additional files that drones should never modify. Added to the default list. */
  neverModify?: string[];
  /** Path to a coding standards file. Injected into the review prompt. */
  standardsPath?: string;
  /** Path to a directory containing minds-workspace.json. Enables multi-repo mode. */
  workspacePath?: string;
}

/** Info about a spawned drone — used to track it through the review loop. */
export interface DroneInfo {
  mind: string;
  session: import("boltwork").SessionHandle;
  channel: string;
  memory: string;
  /** Repo alias (multi-repo only). Undefined for single-repo. */
  repo?: string;
}

/** Result of reviewing a drone's work. */
export interface DroneResult {
  mind: string;
  session: import("boltwork").SessionHandle;
  approved: boolean;
  error?: string;
  /** Repo alias (multi-repo only). */
  repo?: string;
}

/** Result of a full pipeline run. */
export interface PipelineResult {
  config: PipelineConfig;
  waves: WaveResult[];
  approved: boolean;
}

export interface WaveResult {
  wave: string;
  drones: DroneResult[];
}

/**
 * Default files that drones must never modify.
 * These are infrastructure files that should only be changed by humans.
 */
export const DEFAULT_NEVER_MODIFY = [
  ".claude/settings.json",
  ".claude/settings.local.json",
  "CLAUDE.md",
  ".claude/CLAUDE.md",
  "package.json",
  "bun.lock",
  "tsconfig.json",
];
