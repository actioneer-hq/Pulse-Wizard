import { WizardError } from "../util/errors.js";
import { commandExists, exec } from "../util/exec.js";
import type { Driver, DriverId, DriverResult, RunOptions } from "./types.js";

/** Accumulator a subclass's line parser writes into. */
export interface Sink {
  text: string; // final answer (last write wins)
  readonly filesEdited: Set<string>;
  emit(kind: "text" | "tool" | "status", message: string): void;
}

/** Base for agents driven via a one-shot headless CLI that streams newline-delimited JSON
 * (Claude Code `claude -p`, Codex `codex exec`). This base owns detection, the spawn, the
 * chunk-safe NDJSON drain, and exit handling; a subclass supplies the argv and the per-line parse. */
export abstract class HeadlessDriver implements Driver {
  abstract readonly id: DriverId;
  abstract readonly label: string;
  protected abstract readonly bin: string;

  /** argv after the binary (prompt + flags). */
  protected abstract buildArgs(prompt: string, opts: RunOptions): string[];
  /** interpret one JSON event line into the sink. Best-effort; a malformed line is skipped upstream. */
  protected abstract parseLine(ev: Record<string, unknown>, sink: Sink, opts: RunOptions): void;

  async detect(): Promise<boolean> {
    return commandExists(this.bin);
  }

  async authed(): Promise<boolean> {
    // TODO: cheap probe. Assume usable if installed for now.
    return this.detect();
  }

  async run(prompt: string, opts: RunOptions): Promise<DriverResult> {
    const sink: Sink = {
      text: "",
      filesEdited: new Set<string>(),
      emit: (kind, message) => opts.onEvent?.({ kind, message }),
    };
    let buf = "";

    const drain = (flush: boolean) => {
      const parts = buf.split("\n");
      buf = flush ? "" : (parts.pop() ?? ""); // keep the trailing partial line unless flushing
      for (const raw of parts) {
        const line = raw.trim();
        if (!line) continue;
        let ev: Record<string, unknown>;
        try {
          ev = JSON.parse(line);
        } catch {
          continue; // non-JSON line (banner, log) — skip
        }
        this.parseLine(ev, sink, opts);
      }
    };

    const { code, stderr } = await exec(this.bin, this.buildArgs(prompt, opts), {
      cwd: opts.repo,
      onStdout: (chunk) => {
        buf += chunk;
        drain(false);
      },
    });
    drain(true);
    if (code !== 0) {
      throw new WizardError(`${this.label} exited ${code}: ${stderr.slice(-500) || "(no output)"}`);
    }
    return { text: sink.text, filesEdited: [...sink.filesEdited] };
  }
}
