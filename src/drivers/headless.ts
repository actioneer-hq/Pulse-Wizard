import { NotImplementedError } from "../util/errors.js";
import { commandExists } from "../util/exec.js";
import type { Driver, DriverId, DriverResult, RunOptions } from "./types.js";

/** Base for agents driven via a one-shot headless CLI (Claude Code `claude -p`, Codex `codex exec`).
 * Subclasses provide the binary name and the flag/argv shape; this base handles detection and
 * (later) the spawn + stdout-parse. In P0 `run()` is a stub. */
export abstract class HeadlessDriver implements Driver {
  abstract readonly id: DriverId;
  abstract readonly label: string;
  /** The CLI binary this driver shells out to. */
  protected abstract readonly bin: string;

  async detect(): Promise<boolean> {
    return commandExists(this.bin);
  }

  async authed(): Promise<boolean> {
    // TODO: cheap probe (e.g. a trivial `-p "reply ok"` run). Assume usable if installed for now.
    return this.detect();
  }

  async run(_prompt: string, _opts: RunOptions): Promise<DriverResult> {
    // TODO: build argv (subclass), spawn in opts.repo via util/exec, parse the tool's JSON event
    // stream for progress, collect final text + edited files.
    throw new NotImplementedError(`${this.id} headless run`);
  }
}
