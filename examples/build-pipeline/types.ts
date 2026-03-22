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
}
