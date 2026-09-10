import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { WizardError } from "../util/errors.js";
import { commandExists } from "../util/exec.js";
import { type RpcConnection, RpcPeer, StdioConnection } from "./acp-rpc.js";
import type { Driver, DriverId, DriverResult, RunOptions } from "./types.js";

/** Any ACP-native agent (opencode, Grok, …), driven as an ACP client over JSON-RPC/stdio. One client
 * covers the whole ACP family. Defaults to launching `opencode acp` (also the fallback), but the
 * launch command is configurable. */
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

  async run(prompt: string, opts: RunOptions): Promise<DriverResult> {
    const child = spawn(this.launchCmd, this.launchArgs, {
      cwd: opts.repo,
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stderr.setEncoding("utf8");
    let stderr = "";
    child.stderr.on("data", (c: string) => {
      stderr += c;
    });
    try {
      return await runAcpSession(new StdioConnection(child), prompt, opts);
    } catch (e) {
      throw new WizardError(`${this.label} failed: ${(e as Error).message} ${stderr.slice(-300)}`);
    } finally {
      child.kill();
    }
  }
}

/** Drive one ACP prompt turn over any connection (real stdio or an in-memory test double). The agent
 * reads/writes files THROUGH us (client-served fs), which is how deliverables land on disk. */
export async function runAcpSession(
  conn: RpcConnection,
  prompt: string,
  opts: RunOptions,
): Promise<DriverResult> {
  const peer = new RpcPeer(conn);
  const filesEdited = new Set<string>();
  let text = "";

  // client-served filesystem: the agent asks us to read/write; we do the disk IO.
  peer.on("fs/read_text_file", async (p) => {
    const content = await readFile(String(p.path), "utf8");
    return { content };
  });
  peer.on("fs/write_text_file", async (p) => {
    const path = String(p.path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, String(p.content ?? ""));
    filesEdited.add(path);
    return null;
  });
  // streamed progress + the agent's message text
  peer.on("session/update", (p) => {
    const update = (p.update ?? {}) as Record<string, unknown>;
    const kind = update.sessionUpdate as string | undefined;
    if (kind === "agent_message_chunk") {
      const content = (update.content ?? {}) as { text?: string };
      if (typeof content.text === "string") {
        text += content.text;
        opts.onEvent?.({ kind: "text", message: content.text });
      }
    } else if (kind === "tool_call" || kind === "tool_call_update") {
      // Prefer the agent's own human title; else compose "kind path" (like the other drivers) from
      // the reported file locations / rawInput; else fall back to the id or the update kind.
      const locs = (update.locations ?? []) as Array<{ path?: string }>;
      const path =
        locs.find((l) => typeof l.path === "string")?.path ??
        (update.rawInput as { path?: string } | undefined)?.path;
      const composed = [update.kind, path].filter(Boolean).join(" ").trim();
      const message = update.title ?? (composed || update.toolCallId) ?? kind;
      opts.onEvent?.({ kind: "tool", message: String(message) });
    }
  });

  await peer.request("initialize", {
    protocolVersion: 1,
    clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
  });
  const session = (await peer.request("session/new", {
    cwd: opts.repo,
    mcpServers: [],
  })) as { sessionId: string };
  const result = (await peer.request("session/prompt", {
    sessionId: session.sessionId,
    prompt: [{ type: "text", text: prompt }],
  })) as { stopReason?: string };

  if (result.stopReason && result.stopReason !== "end_turn") {
    throw new WizardError(`agent stopped: ${result.stopReason}`);
  }
  return { text, filesEdited: [...filesEdited] };
}
