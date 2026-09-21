import type { Driver } from "../drivers/types.js";
import type { PulseApi } from "../pulse/client.js";

/** CLI flags parsed at entry; pre-seed the context so steps can skip prompts when provided. */
export interface CliFlags {
  repo?: string;
  pulseUrl?: string;
  token?: string;
  org?: string; // Pulse org slug (default "default")
  agent?: string; // driver id
  verbose?: boolean;
  dev?: boolean;
  notify?: boolean;
  reconfigure?: boolean;
}

/** Mutable session threaded through every step. Steps read what earlier steps set and fill in more. */
export interface WizardContext {
  repoPath: string;
  flags: CliFlags;
  driver?: Driver;
  pulse?: PulseApi;
  closePulse?: () => Promise<void>;
  pulseUrl?: string;
  token?: string;
  /** Free-form bag for artifacts later steps produce (samples, generated mapping, etc.). */
  artifacts: Record<string, unknown>;
}

export function newContext(repoPath: string, flags: CliFlags): WizardContext {
  return { repoPath, flags, artifacts: {} };
}
