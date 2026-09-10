import { describe, expect, it, vi } from "vitest";

const calls: { cmd: string; args: string[] }[] = [];

vi.mock("../src/util/exec.js", () => ({
  commandExists: vi.fn(async () => true),
  exec: vi.fn(async (cmd: string, args: string[], opts: { onStdout?: (c: string) => void }) => {
    calls.push({ cmd, args });
    const lines = `${[
      JSON.stringify({ type: "system", subtype: "init" }),
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "Write",
              input: { file_path: "/repo/.pulse/artifacts/otlp/mapping.jsonata" },
            },
          ],
        },
      }),
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "working" }] },
      }),
      JSON.stringify({ type: "result", subtype: "success", result: "all done" }),
    ].join("\n")}\n`;
    // deliver in two chunks to exercise the line buffer across chunk boundaries
    opts.onStdout?.(lines.slice(0, 40));
    opts.onStdout?.(lines.slice(40));
    return { code: 0, stdout: lines, stderr: "" };
  }),
}));

const { ClaudeCodeDriver } = await import("../src/drivers/claudeCode.js");

describe("ClaudeCodeDriver.run", () => {
  it("parses stream-json into final text + edited files, and builds the right argv", async () => {
    const events: string[] = [];
    const res = await new ClaudeCodeDriver().run("do it", {
      repo: "/repo",
      onEvent: (e) => events.push(`${e.kind}:${e.message}`),
    });

    expect(res.text).toBe("all done");
    expect(res.filesEdited).toEqual(["/repo/.pulse/artifacts/otlp/mapping.jsonata"]);
    expect(events).toContain("tool:Write");
    expect(events).toContain("text:working");

    const { cmd, args } = calls[0]!;
    expect(cmd).toBe("claude");
    expect(args.slice(0, 4)).toEqual(["-p", "do it", "--output-format", "stream-json"]);
    expect(args).toContain("--add-dir");
  });
});
