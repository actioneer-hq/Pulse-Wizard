import { NotImplementedError } from "../util/errors.js";
import { commandExists } from "../util/exec.js";
import type { Driver, DriverId, DriverResult, RunOptions } from "./types.js";

/** Any ACP-native agent (opencode, Grok, future tools), driven as an ACP client over JSON-RPC/stdio.
 * One implementation covers the whole ACP family. In P0 this is a stub; the wire protocol
 * (initialize / session/new / session/prompt / fs.* callbacks / session/update stream) lands later.
 *
 * Defaults to launching opencode — also the bundled no-agent fallback — but the launch command is
 * configurable so any ACP agent can be plugged in. */
export class AcpDriver implements Driver {
  readonly id: DriverId = "acp";
  readonly label = "ACP agent (opencode / Grok / …)";

  constructor(
    private readonly launchCmd = "opencode",
    private readonly launchArgs: string[] = ["acp"],
  ) {}

  async detect(): Promise<boolean> {
    return commandExists(this.launchCmd);
  }

  async authed(): Promise<boolean> {
    return this.detect();
  }

  async run(_prompt: string, _opts: RunOptions): Promise<DriverResult> {
    // TODO: spawn `${launchCmd} ${launchArgs}`, speak ACP JSON-RPC over stdio: initialize →
    // session/new {cwd: repo} → session/prompt (text + resource blocks) → stream session/update,
    // answer fs read/write requests, collect final text + written files.
    throw new NotImplementedError("acp session run");
  }
}
