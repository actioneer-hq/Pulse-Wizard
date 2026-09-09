import type { Driver } from "../drivers/types.js";
import type { PulseClient } from "../pulse/client.js";

export type JobKind = "otlp" | "blob";

/** CLI flags parsed at entry; pre-seed the context so steps can skip prompts when provided. */
export interface CliFlags {
  repo?: string;
  pulseUrl?: string;
  token?: string;
  agent?: string; // driver id
  job?: JobKind;
  verbose?: boolean;
}

/** Mutable session threaded through every step. Steps read what earlier steps set and fill in more. */
export interface WizardContext {
  repoPath: string;
  flags: CliFlags;
  driver?: Driver;
  pulse?: PulseClient;
  pulseUrl?: string;
  token?: string;
  job?: JobKind;
  /** Free-form bag for artifacts later steps produce (samples, generated mapping, etc.). */
  artifacts: Record<string, unknown>;
}

export function newContext(repoPath: string, flags: CliFlags): WizardContext {
  return { repoPath, flags, artifacts: {} };
}
