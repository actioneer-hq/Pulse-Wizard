import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { RpcConnection } from "../src/drivers/acp-rpc.js";
import { runAcpSession } from "../src/drivers/acp.js";

/** A scripted in-memory ACP agent: answers the handshake, and on session/prompt asks the client to
 * write a file, streams a message chunk, then ends the turn. */
class FakeAgent implements RpcConnection {
  private cb: (m: Record<string, unknown>) => void = () => {};
  private agentId = 1000;
  private clientResponses = new Map<number, (v: unknown) => void>();

  constructor(private readonly writePath: string) {}

  onMessage(cb: (m: Record<string, unknown>) => void): void {
    this.cb = cb;
  }
  close(): void {}

  send(raw: unknown): void {
    const msg = raw as Record<string, unknown>;
    queueMicrotask(async () => {
      const method = msg.method as string | undefined;
      if (method === "initialize") return this.reply(msg.id, { protocolVersion: 1 });
      if (method === "session/new") return this.reply(msg.id, { sessionId: "s1" });
      if (method === "session/prompt") {
        await this.callClient("fs/write_text_file", {
          sessionId: "s1",
          path: this.writePath,
          content: "EXPR",
        });
        this.notify("session/update", {
          sessionId: "s1",
          update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "done" } },
        });
        return this.reply(msg.id, { stopReason: "end_turn" });
      }
      if (msg.id !== undefined && !method) {
        // the client's response to one of our agent→client requests
        const p = this.clientResponses.get(msg.id as number);
        if (p) {
          this.clientResponses.delete(msg.id as number);
          p(msg.result);
        }
      }
    });
  }

  private reply(id: unknown, result: unknown): void {
    this.cb({ jsonrpc: "2.0", id, result });
  }
  private notify(method: string, params: unknown): void {
    this.cb({ jsonrpc: "2.0", method, params });
  }
  private callClient(method: string, params: unknown): Promise<unknown> {
    const id = this.agentId++;
    return new Promise((res) => {
      this.clientResponses.set(id, res);
      this.cb({ jsonrpc: "2.0", id, method, params });
    });
  }
}

describe("runAcpSession", () => {
  it("runs the handshake, serves the agent's file write, and collects the result", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pw-acp-"));
    const path = join(dir, "mapping.jsonata");

    const res = await runAcpSession(new FakeAgent(path), "map it", { repo: dir });

    expect(res.text).toBe("done");
    expect(res.filesEdited).toEqual([path]);
    expect(existsSync(path)).toBe(true);
    expect(await readFile(path, "utf8")).toBe("EXPR");
  });
});
