/**
 * boltwork — Composable primitives for AI agent pipelines.
 *
 * import { llmCall, gate, spawnSession, feedbackLoop } from "boltwork";
 */

// Primitives
export { llmCall, type LLMCallOptions } from "./primitives/llm-call.ts";
export { gate, gateAsync } from "./primitives/gate.ts";
export { spawnSession, type SpawnOptions, type SessionHandle } from "./primitives/session.ts";
export { publish, waitForSignal, type SignalOptions } from "./primitives/signal.ts";
export { registryRead, registryAppend } from "./primitives/registry.ts";
export { remember, recall, type MemoryEntry } from "./primitives/memory.ts";
export { feedbackLoop, type FeedbackLoopOptions } from "./primitives/feedback-loop.ts";
export { install, type InstallManifest, type InstallResult } from "./primitives/installer.ts";

// Errors
export {
  GateRejection,
  LLMCallError,
  SessionSpawnError,
  SignalTimeout,
  SignalError,
  MaxIterationsExceeded,
  InstallerError,
} from "./errors.ts";

// Bus
export { startBus, type BusHandle, type StartBusOptions } from "./bus/lifecycle.ts";
export { busPublish, busSubscribe, type BusEvent, type BusClientOptions } from "./bus/client.ts";
