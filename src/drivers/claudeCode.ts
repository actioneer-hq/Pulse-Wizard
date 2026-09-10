import { HeadlessDriver, type Sink } from "./headless.js";
import type { DriverId, RunOptions } from "./types.js";

/** Claude Code, driven headlessly (`claude -p ... --output-format stream-json`). Uses the user's own
 * Claude auth (subscription or ANTHROPIC_API_KEY). */
export class ClaudeCodeDriver extends HeadlessDriver {
  readonly id: DriverId = "claude-code";
  readonly label = "Claude Code";
  protected readonly bin = "claude";

  protected buildArgs(prompt: string, opts: RunOptions): string[] {
    const a = [
      "-p",
      prompt,
      "--output-format",
      "stream-json",
      "--verbose", // required alongside stream-json in -p mode
      "--permission-mode",
      "acceptEdits", // let it write without interactive prompts (headless)
      "--allowedTools",
      "Read,Grep,Glob,Write,Edit,Bash",
      "--add-dir",
      opts.repo,
    ];
    for (const dir of opts.contextFiles ?? []) a.push("--add-dir", dir);
    return a;
  }

  protected parseLine(ev: Record<string, unknown>, sink: Sink): void {
    const type = ev.type as string | undefined;
    if (type === "assistant") {
      const msg = ev.message as { content?: Array<Record<string, unknown>> } | undefined;
      for (const part of msg?.content ?? []) {
        if (part.type === "text" && typeof part.text === "string") {
          sink.emit("text", part.text);
        } else if (part.type === "tool_use") {
          const name = part.name as string;
          const input = (part.input ?? {}) as Record<string, unknown>;
          const target = input.file_path ?? input.pattern ?? input.command ?? input.path ?? "";
          sink.emit("tool", `${name} ${String(target)}`.trim());
          if ((name === "Write" || name === "Edit") && typeof input.file_path === "string") {
            sink.filesEdited.add(input.file_path);
          }
        }
      }
    } else if (type === "result" && typeof ev.result === "string") {
      sink.text = ev.result; // terminal event: the agent's final answer
    }
  }
}
