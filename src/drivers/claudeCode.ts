import { HeadlessDriver } from "./headless.js";
import type { DriverId } from "./types.js";

/** Claude Code, driven headlessly via `claude -p "<prompt>" --output-format stream-json
 * --allowedTools Read,Grep,Write,Edit --add-dir <repo>`. Uses the user's own Claude auth
 * (subscription or ANTHROPIC_API_KEY). */
export class ClaudeCodeDriver extends HeadlessDriver {
  readonly id: DriverId = "claude-code";
  readonly label = "Claude Code";
  protected readonly bin = "claude";
}
