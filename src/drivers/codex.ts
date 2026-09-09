import { HeadlessDriver } from "./headless.js";
import type { DriverId } from "./types.js";

/** OpenAI Codex CLI, driven headlessly via `codex exec --json --sandbox workspace-write "<prompt>"`.
 * Uses the user's own Codex auth (ChatGPT subscription or OPENAI_API_KEY). */
export class CodexDriver extends HeadlessDriver {
  readonly id: DriverId = "codex";
  readonly label = "Codex";
  protected readonly bin = "codex";
}
