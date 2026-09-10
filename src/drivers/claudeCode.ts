import { WizardError } from "../util/errors.js";
import { exec } from "../util/exec.js";
import { HeadlessDriver } from "./headless.js";
import type { DriverId, DriverResult, RunOptions } from "./types.js";

/** Claude Code, driven headlessly. Uses the user's own Claude auth (subscription or
 * ANTHROPIC_API_KEY). Emits newline-delimited JSON events (`--output-format stream-json`) which we
 * parse for progress, the final text, and the files it wrote/edited. */
export class ClaudeCodeDriver extends HeadlessDriver {
  readonly id: DriverId = "claude-code";
  readonly label = "Claude Code";
  protected readonly bin = "claude";

  private args(prompt: string, opts: RunOptions): string[] {
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

  override async run(prompt: string, opts: RunOptions): Promise<DriverResult> {
    let text = "";
    const filesEdited = new Set<string>();
    let buf = "";

    const drain = (flush: boolean) => {
      const parts = buf.split("\n");
      buf = flush ? "" : (parts.pop() ?? ""); // keep the trailing partial line unless flushing
      for (const raw of parts) {
        const line = raw.trim();
        if (!line) continue;
        const final = this.consume(line, opts, filesEdited);
        if (final !== null) text = final;
      }
    };

    const { code, stderr } = await exec(this.bin, this.args(prompt, opts), {
      cwd: opts.repo,
      onStdout: (chunk) => {
        buf += chunk;
        drain(false);
      },
    });
    drain(true);
    if (code !== 0) {
      throw new WizardError(`Claude Code exited ${code}: ${stderr.slice(-500) || "(no output)"}`);
    }
    return { text, filesEdited: [...filesEdited] };
  }

  /** Parse one stream-json event line. Returns the final answer text on a `result` event, else null.
   * Best-effort — a malformed line is skipped, not fatal. */
  private consume(line: string, opts: RunOptions, filesEdited: Set<string>): string | null {
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(line);
    } catch {
      return null;
    }
    const type = ev.type as string | undefined;

    if (type === "assistant") {
      const msg = ev.message as { content?: Array<Record<string, unknown>> } | undefined;
      for (const part of msg?.content ?? []) {
        if (part.type === "text" && typeof part.text === "string") {
          opts.onEvent?.({ kind: "text", message: part.text });
        } else if (part.type === "tool_use") {
          const name = part.name as string;
          opts.onEvent?.({ kind: "tool", message: name });
          const input = part.input as { file_path?: string } | undefined;
          if ((name === "Write" || name === "Edit") && input?.file_path) {
            filesEdited.add(input.file_path);
          }
        }
      }
    } else if (type === "result" && typeof ev.result === "string") {
      return ev.result; // terminal event: the agent's final answer
    }
    return null;
  }
}
