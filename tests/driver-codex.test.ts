import { describe, expect, it, vi } from "vitest";

const calls: { cmd: string; args: string[] }[] = [];

vi.mock("../src/util/exec.js", () => ({
  commandExists: vi.fn(async () => true),
  exec: vi.fn(async (cmd: string, args: string[], opts: { onStdout?: (c: string) => void }) => {
    calls.push({ cmd, args });
    const lines = `${[
      // real codex exec --json shape: item fields sit directly on `item` (no `details` nesting)
      JSON.stringify({ type: "thread.started", thread_id: "t1" }),
      JSON.stringify({
        type: "item.started",
        item: {
          id: "i1",
          type: "command_execution",
          command: "node validate.mjs",
          status: "in_progress",
        },
      }),
      JSON.stringify({
        type: "item.completed",
        item: {
          id: "i2",
          type: "file_change",
          changes: [{ path: "/repo/.pulse/artifacts/otlp/mapping.jsonata", kind: "add" }],
        },
      }),
      JSON.stringify({
        type: "item.completed",
        item: { id: "i3", type: "agent_message", text: "mapping written" },
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
    const events: string[] = [];
    const res = await new CodexDriver().run("map it", {
      repo: "/repo",
      onEvent: (e) => events.push(`${e.kind}:${e.message}`),
    });
    expect(res.text).toBe("mapping written");
    expect(res.filesEdited).toEqual(["/repo/.pulse/artifacts/otlp/mapping.jsonata"]);
    // progress peek: command + file-change items surface as "verb target" tool events
    expect(events).toContain("tool:run node validate.mjs");
    expect(events).toContain("tool:edit /repo/.pulse/artifacts/otlp/mapping.jsonata");

    const { cmd, args } = calls[0]!;
    expect(cmd).toBe("codex");
    expect(args).toEqual([
      "exec",
      "--json",
      "--skip-git-repo-check",
      "--sandbox",
      "workspace-write",
      "map it",
    ]);
  });
});
