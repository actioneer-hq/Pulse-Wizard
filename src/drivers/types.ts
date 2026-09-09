/** A coding agent the wizard can drive. The whole wizard reduces to one primitive:
 * run(prompt, {repo}) -> { text, filesEdited }. "Generate the JSONata mapping" takes `text`;
 * "add the exporter" reads `filesEdited`. Auth is always the agent's own — the wizard never
 * handles model keys. */

export type DriverId = "claude-code" | "codex" | "acp" | "opencode";

export interface DriverEvent {
  kind: "text" | "tool" | "file" | "status";
  message: string;
}

export interface RunOptions {
  /** Working directory the agent operates in (the user's repo). The agent reads it with its own tools. */
  repo: string;
  /** Ask the agent to emit structured/JSON output (for the blob-config path). */
  json?: boolean;
  /** Repo-relative context files the agent should read (spec, samples) — injected by later steps. */
  contextFiles?: string[];
  /** Progress callback (streamed agent output / tool activity). */
  onEvent?: (e: DriverEvent) => void;
}

export interface DriverResult {
  /** The agent's final textual answer (e.g. a JSONata expression, or JSON when `json` was set). */
  text: string;
  /** Repo-relative paths the agent created or edited. */
  filesEdited: string[];
}

export interface Driver {
  readonly id: DriverId;
  readonly label: string;
  /** Is the underlying CLI/agent installed on this machine? */
  detect(): Promise<boolean>;
  /** Is it logged in / usable? (uses the agent's own credential store) */
  authed(): Promise<boolean>;
  /** Run one task against the repo and return its output + any file edits. */
  run(prompt: string, opts: RunOptions): Promise<DriverResult>;
}
