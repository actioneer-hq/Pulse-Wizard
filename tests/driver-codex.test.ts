import { describe, expect, it, vi } from "vitest";

const calls: { cmd: string; args: string[] }[] = [];

vi.mock("../src/util/exec.js", () => ({
  commandExists: vi.fn(async () => true),
  exec: vi.fn(async (cmd: string, args: string[], opts: { onStdout?: (c: string) => void }) => {
    calls.push({ cmd, args });
    const lines = `${[
      JSON.stringify({ type: "thread.started", thread_id: "t1" }),
      JSON.stringify({
        type: "item.completed",
        item: {
          details: {
            type: "file_change",
            changes: [{ path: "/repo/.pulse/artifacts/otlp/mapping.jsonata", kind: "add" }],
          },
        },
      }),
      JSON.stringify({
        type: "item.completed",
        item: { details: { type: "agent_message", text: "mapping written" } },
      }),
    ].join("\n")}\n`;
    opts.onStdout?.(lines.slice(0, 55));
    opts.onStdout?.(lines.slice(55));
    return { code: 0, stdout: lines, stderr: "" };
  }),
}));

const { CodexDriver } = await import("../src/drivers/codex.js");

describe("CodexDriver.run", () => {
  it("parses ThreadEvent JSONL into final text + file changes, with the exec argv", async () => {
    const res = await new CodexDriver().run("map it", { repo: "/repo" });
    expect(res.text).toBe("mapping written");
    expect(res.filesEdited).toEqual(["/repo/.pulse/artifacts/otlp/mapping.jsonata"]);

    const { cmd, args } = calls[0]!;
    expect(cmd).toBe("codex");
    expect(args).toEqual(["exec", "--json", "--sandbox", "workspace-write", "map it"]);
  });
});
